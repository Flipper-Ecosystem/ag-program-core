use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint, TokenAccount, TokenInterface,
    transfer_checked, TransferChecked
};
use crate::adapters::adapter_connector_module::AdapterContext;
use crate::errors::ErrorCode;
use crate::state::*;
use crate::instructions::route_validator_module;
use crate::instructions::route_executor_module;
use crate::instructions::vault_manager_module::{VaultAuthority, get_vault_authority_address};

/// Trigger type for limit order execution
#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum TriggerType {
    /// Take Profit: execute when price increased by X% (sell higher)
    TakeProfit = 0,
    /// Stop Loss: execute when price decreased by X% (sell lower to minimize losses)
    StopLoss = 1,
}

/// Order execution status
#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderStatus {
    /// Order is active and waiting for execution
    Open = 0,
    /// Order has been executed
    Filled = 1,
    /// Order has been cancelled by creator
    Cancelled = 2,
}

/// Limit order with trigger price mechanism
#[account]
pub struct LimitOrder {
    /// Order creator's public key
    pub creator: Pubkey,
    /// Input token mint (tokens to swap from)
    pub input_mint: Pubkey,
    /// Output token mint (tokens to swap to)
    pub output_mint: Pubkey,
    /// Vault holding input tokens
    pub input_vault: Pubkey,
    /// User's destination account for output tokens
    pub user_destination_account: Pubkey,
    /// Amount of input tokens to swap
    pub input_amount: u64,
    /// Minimum output amount (baseline for trigger calculation)
    pub min_output_amount: u64,
    /// Trigger price deviation from min_output_amount in basis points (1000 = 10%)
    pub trigger_price_bps: u16,
    /// Type of trigger (TakeProfit or StopLoss)
    pub trigger_type: TriggerType,
    /// Order expiration timestamp
    pub expiry: i64,
    /// Current order status
    pub status: OrderStatus,

    pub slippage_bps: u16,
    /// PDA bump seed
    pub bump: u8,
}

impl LimitOrder {

    pub const SPACE: usize = 8 + 191;
    /// Checks if order should be executed based on current price
    ///
    /// # Arguments
    /// * `current_output_amount` - Current output amount from quote
    ///
    /// # Returns
    /// * `Result<bool>` - True if trigger condition is met
    pub fn should_execute(&self, current_output_amount: u64) -> Result<bool> {
        // Calculate current price ratio relative to min_output_amount
        // price_ratio shows how much current output differs from minimum
        let price_ratio = (current_output_amount as u128)
            .checked_mul(10_000) // for basis points precision
            .ok_or(ErrorCode::InvalidCalculation)?
            .checked_div(self.min_output_amount as u128)
            .ok_or(ErrorCode::InvalidCalculation)? as u64;

        match self.trigger_type {
            TriggerType::TakeProfit => {
                // Take Profit: current output should be >= min_output_amount * (1 + trigger_price_bps/10000)
                // Or price_ratio >= 10000 + trigger_price_bps
                let trigger_ratio = 10_000_u64
                    .checked_add(self.trigger_price_bps as u64)
                    .ok_or(ErrorCode::InvalidCalculation)?;

                Ok(price_ratio >= trigger_ratio)
            },
            TriggerType::StopLoss => {
                // Stop Loss: current output should be <= min_output_amount * (1 - trigger_price_bps/10000)
                // Or price_ratio <= 10000 - trigger_price_bps
                let trigger_ratio = 10_000_u64
                    .checked_sub(self.trigger_price_bps as u64)
                    .ok_or(ErrorCode::InvalidCalculation)?;

                Ok(price_ratio <= trigger_ratio)
            }
        }
    }

    pub fn calculate_min_acceptable_output(&self, quoted_amount: u64) -> Result<u64> {
        let min_output = (quoted_amount as u128)
            .checked_mul((10_000u128).checked_sub(self.slippage_bps as u128).unwrap())
            .unwrap()
            .checked_div(10_000)
            .unwrap() as u64;
        Ok(min_output)
    }
}

/// Create limit order instruction accounts
#[event_cpi]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateLimitOrder<'info> {
    /// Vault authority PDA controlling all vaults
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Limit order account to be created
    #[account(
        init,
        payer = creator,
        space = LimitOrder::SPACE,
        seeds = [b"limit_order", creator.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// Vault to hold input tokens until order execution
    #[account(
        init,
        payer = creator,
        seeds = [b"order_vault", limit_order.key().as_ref()],
        bump,
        token::mint = input_mint,
        token::authority = vault_authority,
        token::token_program = input_token_program,
    )]
    pub input_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's source account for input tokens
    #[account(
        mut,
        constraint = user_input_token_account.mint == input_mint.key(),
        constraint = user_input_token_account.owner == creator.key()
    )]
    pub user_input_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's destination account for output tokens
    #[account(
        constraint = user_destination_token_account.mint == output_mint.key(),
        constraint = user_destination_token_account.owner == creator.key()
    )]
    pub user_destination_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Input token mint
    pub input_mint: Box<InterfaceAccount<'info, Mint>>,
    /// Output token mint
    pub output_mint: Box<InterfaceAccount<'info, Mint>>,
    /// Token program for input tokens
    pub input_token_program: Interface<'info, TokenInterface>,
    /// Token program for output tokens
    pub output_token_program: Interface<'info, TokenInterface>,

    /// Order creator (must sign)
    #[account(mut, signer)]
    pub creator: Signer<'info>,
    /// System program for account creation
    pub system_program: Program<'info, System>,
}

/// Creates a new limit order
///
/// # Arguments
/// * `nonce` - Unique identifier for order creation
/// * `input_amount` - Amount of input tokens to swap
/// * `min_output_amount` - Minimum output amount (baseline for trigger)
/// * `trigger_price_bps` - Trigger deviation percentage in basis points
/// * `trigger_type` - Type of trigger (TakeProfit or StopLoss)
/// * `expiry` - Order expiration timestamp
pub fn create_limit_order(
    ctx: Context<CreateLimitOrder>,
    nonce: u64,
    input_amount: u64,
    min_output_amount: u64,
    trigger_price_bps: u16,
    trigger_type: TriggerType,
    expiry: i64,
    slippage_bps: u16
) -> Result<()> {
    // Validate input parameters
    if input_amount == 0 {
        return Err(ErrorCode::InvalidAmount.into());
    }
    if min_output_amount == 0 {
        return Err(ErrorCode::InvalidAmount.into());
    }
    if trigger_price_bps == 0 {
        return Err(ErrorCode::InvalidTriggerPrice.into());
    }
    if expiry <= Clock::get()?.unix_timestamp {
        return Err(ErrorCode::InvalidExpiry.into());
    }

    require!(
        slippage_bps <= 1000,
        ErrorCode::InvalidSlippage
    );

    // Transfer input tokens to order vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.input_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_input_token_account.to_account_info(),
                to: ctx.accounts.input_vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
                mint: ctx.accounts.input_mint.to_account_info(),
            },
        ),
        input_amount,
        ctx.accounts.input_mint.decimals,
    )?;

    // Initialize order account
    let order = &mut ctx.accounts.limit_order;
    order.creator = ctx.accounts.creator.key();
    order.input_mint = ctx.accounts.input_mint.key();
    order.output_mint = ctx.accounts.output_mint.key();
    order.input_vault = ctx.accounts.input_vault.key();
    order.user_destination_account = ctx.accounts.user_destination_token_account.key();
    order.input_amount = input_amount;
    order.min_output_amount = min_output_amount;
    order.trigger_price_bps = trigger_price_bps;
    order.trigger_type = trigger_type;
    order.expiry = expiry;
    order.status = OrderStatus::Open;
    order.slippage_bps = slippage_bps;
    order.bump = ctx.bumps.limit_order;

    // Emit order creation event
    emit_cpi!(LimitOrderCreated {
        order: order.key(),
        creator: order.creator,
        input_mint: order.input_mint,
        output_mint: order.output_mint,
        input_amount: order.input_amount,
        min_output_amount: order.min_output_amount,
        trigger_price_bps: order.trigger_price_bps,
        trigger_type: order.trigger_type as u8,
        expiry: order.expiry,
    });

    Ok(())
}

/// Execute limit order instruction accounts
#[event_cpi]
#[derive(Accounts)]
#[instruction(route_plan: Vec<RoutePlanStep>)]
pub struct ExecuteLimitOrder<'info> {
    /// Adapter registry for routing validation
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,

    /// Vault authority controlling token transfers
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Limit order to execute (will be closed, rent goes to operator)
    #[account(
        mut,
        close = operator,
        constraint = limit_order.status == OrderStatus::Open @ ErrorCode::InvalidOrderStatus,
        constraint = limit_order.input_vault == input_vault.key() @ ErrorCode::InvalidVaultAddress
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// Vault holding input tokens
    #[account(mut)]
    pub input_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token program for input tokens
    pub input_token_program: Interface<'info, TokenInterface>,
    /// Token program for output tokens
    pub output_token_program: Interface<'info, TokenInterface>,

    /// User's destination account for output tokens
    #[account(
        mut,
        constraint = user_destination_token_account.key() == limit_order.user_destination_account,
        constraint = user_destination_token_account.mint == limit_order.output_mint,
        constraint = user_destination_token_account.owner == limit_order.creator
    )]
    pub user_destination_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Input token mint
    pub input_mint: InterfaceAccount<'info, Mint>,
    /// Output token mint
    pub output_mint: InterfaceAccount<'info, Mint>,

    /// Optional platform fee collection account
    #[account(mut)]
    pub platform_fee_account: Option<InterfaceAccount<'info, TokenAccount>>,

    /// Operator executing the order (must be registered, receives rent from closed order)
    #[account(
        mut,
        signer,
        constraint = adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Executes a limit order when trigger conditions are met
///
/// # Arguments
/// * `route_plan` - Swap route to execute
/// * `quoted_out_amount` - Expected output amount from quote
/// * `platform_fee_bps` - Platform fee in basis points
///
/// # Returns
/// * `Result<u64>` - Final output amount after fees
pub fn execute_limit_order<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteLimitOrder<'info>>,
    route_plan: Vec<RoutePlanStep>,
    quoted_out_amount: u64,
    platform_fee_bps: u8,
) -> Result<u64> {
    // Check if order has expired
    let now = Clock::get()?.unix_timestamp;
    if now >= ctx.accounts.limit_order.expiry {
        return Err(ErrorCode::OrderExpired.into());
    }

    // IMPORTANT: Check trigger price relative to min_output_amount
    if !ctx.accounts.limit_order.should_execute(quoted_out_amount)? {
        return Err(ErrorCode::TriggerPriceNotMet.into());
    }

    let in_amount = ctx.accounts.limit_order.input_amount;

    // Validate swap route
    route_validator_module::validate_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.output_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.input_mint.to_account_info(),
        &ctx.accounts.output_mint.to_account_info(),
        &route_plan,
        ctx.remaining_accounts,
        ctx.program_id,
        in_amount,
    )?;

    // Prepare PDA signer seeds
    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Find destination vault for output tokens
    let destination_vault = ctx.remaining_accounts
        .iter()
        .rev()
        .find(|acc| {
            if let Ok(account_data) = acc.try_borrow_data() {
                if let Ok(token_account) = TokenAccount::try_deserialize(&mut account_data.as_ref()) {
                    token_account.mint == ctx.accounts.output_mint.key()
                } else {
                    false
                }
            } else {
                false
            }
        })
        .ok_or(ErrorCode::VaultNotFound)?;

    // Execute swap route
    let (mut output_amount, event_data) = route_executor_module::execute_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.input_mint.to_account_info(),
        destination_vault,
        &route_plan,
        ctx.remaining_accounts,
        ctx.program_id,
        in_amount,
    )?;

    // Emit swap events
    for event in event_data {
        emit_cpi!(SwapEvent {
            amm: event.amm,
            input_mint: event.input_mint,
            input_amount: event.input_amount,
            output_mint: event.output_mint,
            output_amount: event.output_amount,
        });
    }

    // Verify actual output meets trigger condition
    if !ctx.accounts.limit_order.should_execute(output_amount)? {
        return Err(ErrorCode::TriggerPriceNotMet.into());
    }


    let min_acceptable = ctx.accounts.limit_order
        .calculate_min_acceptable_output(quoted_out_amount)?;

    if output_amount < min_acceptable {
        return Err(ErrorCode::SlippageToleranceExceeded.into());
    }

    // Collect platform fee if specified
    let mut fee_amount = 0;
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        if platform_fee_account.mint != ctx.accounts.output_mint.key() {
            return Err(ErrorCode::InvalidPlatformFeeMint.into());
        }

        fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.output_token_program.to_account_info(),
                    TransferChecked {
                        from: destination_vault.clone(),
                        to: platform_fee_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                        mint: ctx.accounts.output_mint.to_account_info(),
                    },
                    signer_seeds
                ),
                fee_amount,
                ctx.accounts.output_mint.decimals,
            )?;

            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.output_mint.key(),
                amount: fee_amount,
            });

            output_amount = output_amount.checked_sub(fee_amount).ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    // Transfer output tokens to user's destination account
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.output_token_program.to_account_info(),
            TransferChecked {
                from: destination_vault.clone(),
                to: ctx.accounts.user_destination_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
                mint: ctx.accounts.output_mint.to_account_info(),
            },
            signer_seeds
        ),
        output_amount,
        ctx.accounts.output_mint.decimals,
    )?;

    // Update order status to filled
    ctx.accounts.limit_order.status = OrderStatus::Filled;

    // Emit order execution event
    emit_cpi!(LimitOrderExecuted {
        order: ctx.accounts.limit_order.key(),
        executor: ctx.accounts.operator.key(),
        input_amount: in_amount,
        output_amount,
        fee_amount,
        trigger_type: ctx.accounts.limit_order.trigger_type as u8,
        min_output_amount: ctx.accounts.limit_order.min_output_amount,
    });

    Ok(output_amount)
}

/// Cancel limit order instruction accounts
#[event_cpi]
#[derive(Accounts)]
pub struct CancelLimitOrder<'info> {
    /// Vault authority controlling token transfers
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Limit order to cancel (status will be set to Cancelled, operator can close it later to collect rent)
    #[account(
        mut,
        constraint = limit_order.status == OrderStatus::Open @ ErrorCode::InvalidOrderStatus,
        constraint = limit_order.creator == creator.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// Vault holding input tokens
    #[account(mut)]
    pub input_vault: InterfaceAccount<'info, TokenAccount>,

    /// User's account to receive refunded tokens
    #[account(
        mut,
        constraint = user_input_token_account.mint == limit_order.input_mint,
        constraint = user_input_token_account.owner == creator.key()
    )]
    pub user_input_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Input token mint
    pub input_mint: InterfaceAccount<'info, Mint>,
    /// Token program for input tokens
    pub input_token_program: Interface<'info, TokenInterface>,

    /// Order creator (must sign)
    #[account(mut, signer)]
    pub creator: Signer<'info>,
}

/// Cancels an open limit order and refunds tokens to creator
pub fn cancel_limit_order(ctx: Context<CancelLimitOrder>) -> Result<()> {
    // Prepare PDA signer seeds
    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Refund input tokens to creator
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.input_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.input_vault.to_account_info(),
                to: ctx.accounts.user_input_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
                mint: ctx.accounts.input_mint.to_account_info(),
            },
            signer_seeds
        ),
        ctx.accounts.limit_order.input_amount,
        ctx.accounts.input_mint.decimals,
    )?;

    // Update order status to cancelled
    ctx.accounts.limit_order.status = OrderStatus::Cancelled;

    // Emit cancellation event
    emit_cpi!(LimitOrderCancelled {
        order: ctx.accounts.limit_order.key(),
        creator: ctx.accounts.creator.key(),
    });

    Ok(())
}

/// Close limit order by operator instruction accounts
#[event_cpi]
#[derive(Accounts)]
pub struct CloseLimitOrderByOperator<'info> {
    /// Adapter registry for operator validation
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,

    /// Limit order to close (must be filled or cancelled)
    #[account(
        mut,
        close = operator,
        constraint = limit_order.status == OrderStatus::Filled || limit_order.status == OrderStatus::Cancelled @ ErrorCode::InvalidOrderStatus
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// Operator closing the order (must be registered, receives rent)
    #[account(
        mut,
        signer,
        constraint = adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Closes a filled or cancelled limit order and collects rent for the operator
pub fn close_limit_order_by_operator(ctx: Context<CloseLimitOrderByOperator>) -> Result<()> {
    let order_key = ctx.accounts.limit_order.key();
    let operator_key = ctx.accounts.operator.key();
    let status = ctx.accounts.limit_order.status as u8;

    msg!("Closing limit order {} by operator {}, status: {}", order_key, operator_key, status);

    // Account is automatically closed by Anchor and rent is sent to operator
    Ok(())
}

/// Route and create order instruction accounts
#[event_cpi]
#[derive(Accounts)]
#[instruction(order_nonce: u64, route_plan: Vec<RoutePlanStep>)]
pub struct RouteAndCreateOrder<'info> {
    /// Adapter registry for routing validation
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,

    /// Vault authority PDA controlling all vaults
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Limit order account to be created
    #[account(
        init,
        payer = creator,
        space = LimitOrder::SPACE,
        seeds = [b"limit_order", creator.key().as_ref(), order_nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// Vault to hold output tokens from swap (becomes order's input vault)
    #[account(
        init,
        payer = creator,
        seeds = [b"order_vault", limit_order.key().as_ref()],
        bump,
        token::mint = output_mint,
        token::authority = vault_authority,
        token::token_program = output_token_program,
    )]
    pub input_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's source account for swap input tokens
    #[account(
        mut,
        constraint = user_input_account.mint == input_mint.key(),
        constraint = user_input_account.owner == creator.key()
    )]
    pub user_input_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's destination account for final order output tokens
    #[account(
        constraint = user_destination_account.mint == output_mint.key(),
        constraint = user_destination_account.owner == creator.key()
    )]
    pub user_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Swap input token mint
    pub input_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Swap output token mint (becomes order input/output mint)
    pub output_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token program for swap input tokens
    pub input_token_program: Interface<'info, TokenInterface>,

    /// Token program for swap/order output tokens
    pub output_token_program: Interface<'info, TokenInterface>,

    /// Optional platform fee collection account
    #[account(mut)]
    pub platform_fee_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// Order creator (must sign)
    #[account(mut, signer)]
    pub creator: Signer<'info>,

    /// System program for account creation
    pub system_program: Program<'info, System>,
}

/// Executes a swap and creates a limit order with the swapped tokens
///
/// # Arguments
/// * `order_nonce` - Unique identifier for order creation
/// * `route_plan` - Swap route to execute
/// * `in_amount` - Amount of input tokens to swap
/// * `quoted_out_amount` - Expected output amount from swap quote
/// * `slippage_bps` - Slippage tolerance for swap in basis points
/// * `platform_fee_bps` - Platform fee for swap in basis points
/// * `order_min_output_amount` - Minimum output amount for the limit order
/// * `order_trigger_price_bps` - Trigger deviation percentage in basis points
/// * `order_trigger_type` - Type of trigger (TakeProfit or StopLoss)
/// * `order_expiry` - Order expiration timestamp
/// * `order_slippage_bps` - Slippage tolerance for order execution
///
/// # Returns
/// * `Result<(u64, Pubkey)>` - (Swap output amount, Created order pubkey)
pub fn route_and_create_order<'info>(
    ctx: Context<'_, '_, 'info, 'info, RouteAndCreateOrder<'info>>,
    order_nonce: u64,
    route_plan: Vec<RoutePlanStep>,
    in_amount: u64,
    quoted_out_amount: u64,
    slippage_bps: u16,
    platform_fee_bps: u8,
    order_min_output_amount: u64,
    order_trigger_price_bps: u16,
    order_expiry: i64,
    order_slippage_bps: u16,
) -> Result<(u64, Pubkey)> {
    // ===== VALIDATION =====

    // Validate swap parameters
    require!(in_amount > 0, ErrorCode::InvalidAmount);
    require!(quoted_out_amount > 0, ErrorCode::InvalidAmount);
    require!(slippage_bps <= 1000, ErrorCode::InvalidSlippage);

    // Validate order parameters
    require!(order_min_output_amount > 0, ErrorCode::InvalidAmount);
    require!(
        order_trigger_price_bps > 0,
        ErrorCode::InvalidTriggerPrice
    );
    require!(
        order_expiry > Clock::get()?.unix_timestamp,
        ErrorCode::InvalidExpiry
    );
    require!(order_slippage_bps <= 1000, ErrorCode::InvalidSlippage);

    // ===== STEP 1: VALIDATE SWAP ROUTE =====

    route_validator_module::validate_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.output_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.input_mint.to_account_info(),
        &ctx.accounts.output_mint.to_account_info(),
        &route_plan,
        ctx.remaining_accounts,
        ctx.program_id,
        in_amount,
    )?;

    // ===== STEP 2: TRANSFER TOKENS FROM USER TO TEMP VAULT =====

    // Find or use first vault in remaining accounts as temporary swap source
    let input_vault = ctx.remaining_accounts
        .iter()
        .find(|acc| {
            if let Ok(account_data) = acc.try_borrow_data() {
                if let Ok(token_account) = TokenAccount::try_deserialize(&mut account_data.as_ref()) {
                    token_account.mint == ctx.accounts.input_mint.key()
                } else {
                    false
                }
            } else {
                false
            }
        })
        .ok_or(ErrorCode::VaultNotFound)?;

    // Transfer swap input tokens from user to vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.input_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_input_account.to_account_info(),
                to: input_vault.clone(),
                authority: ctx.accounts.creator.to_account_info(),
                mint: ctx.accounts.input_mint.to_account_info(),
            },
        ),
        in_amount,
        ctx.accounts.input_mint.decimals,
    )?;

    // ===== STEP 3: EXECUTE SWAP =====

    // Prepare PDA signer seeds
    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Execute swap route
    let (mut out_amount, event_data) = route_executor_module::execute_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.input_mint.to_account_info(),
        &ctx.accounts.input_vault.to_account_info(), // Output goes directly to order vault
        &route_plan,
        ctx.remaining_accounts,
        ctx.program_id,
        in_amount,
    )?;

    // Emit swap events
    for event in event_data {
        emit_cpi!(SwapEvent {
            amm: event.amm,
            input_mint: event.input_mint,
            input_amount: event.input_amount,
            output_mint: event.output_mint,
            output_amount: event.output_amount,
        });
    }

    // ===== STEP 4: VERIFY SLIPPAGE =====

    let min_out_amount = (quoted_out_amount as u128)
        .checked_mul((10_000u128).checked_sub(slippage_bps as u128).unwrap())
        .unwrap()
        .checked_div(10_000)
        .unwrap() as u64;

    require!(
        out_amount >= min_out_amount,
        ErrorCode::SlippageToleranceExceeded
    );

    // ===== STEP 5: COLLECT PLATFORM FEE FROM SWAP =====

    let mut fee_amount = 0u64;
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        require!(
            platform_fee_account.mint == ctx.accounts.output_mint.key(),
            ErrorCode::InvalidPlatformFeeMint
        );

        fee_amount = (out_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.output_token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.input_vault.to_account_info(),
                        to: platform_fee_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                        mint: ctx.accounts.output_mint.to_account_info(),
                    },
                    signer_seeds
                ),
                fee_amount,
                ctx.accounts.output_mint.decimals,
            )?;

            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.output_mint.key(),
                amount: fee_amount,
            });

            out_amount = out_amount
                .checked_sub(fee_amount)
                .ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    // ===== STEP 6: CREATE LIMIT ORDER =====

    let order = &mut ctx.accounts.limit_order;
    order.creator = ctx.accounts.creator.key();
    order.input_mint = ctx.accounts.output_mint.key(); // Order input is swap output
    order.output_mint = ctx.accounts.output_mint.key(); // Same token for order output
    order.input_vault = ctx.accounts.input_vault.key();
    order.user_destination_account = ctx.accounts.user_destination_account.key();
    order.input_amount = out_amount; // Amount after fee
    order.min_output_amount = order_min_output_amount;
    order.trigger_price_bps = order_trigger_price_bps;
    order.trigger_type = TriggerType::TakeProfit;
    order.expiry = order_expiry;
    order.status = OrderStatus::Open;
    order.slippage_bps = order_slippage_bps;
    order.bump = ctx.bumps.limit_order;

    let order_key = order.key();

    // ===== EMIT EVENTS =====

    emit_cpi!(LimitOrderCreated {
        order: order_key,
        creator: order.creator,
        input_mint: order.input_mint,
        output_mint: order.output_mint,
        input_amount: order.input_amount,
        min_output_amount: order.min_output_amount,
        trigger_price_bps: order.trigger_price_bps,
        trigger_type: order.trigger_type as u8,
        expiry: order.expiry,
    });

    emit_cpi!(RouteAndCreateOrderEvent {
        order: order_key,
        swap_input_mint: ctx.accounts.input_mint.key(),
        swap_input_amount: in_amount,
        swap_output_amount: out_amount,
        fee_amount,
        order_input_amount: out_amount,
    });

    Ok((out_amount, order_key))
}





