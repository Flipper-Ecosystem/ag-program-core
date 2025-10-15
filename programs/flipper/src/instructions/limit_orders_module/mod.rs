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
    /// PDA bump seed
    pub bump: u8,
}

impl LimitOrder {
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
        space = 8 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 2 + 1 + 8 + 1 + 1,
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
    pub input_vault: InterfaceAccount<'info, TokenAccount>,

    /// User's source account for input tokens
    #[account(
        mut,
        constraint = user_input_token_account.mint == input_mint.key(),
        constraint = user_input_token_account.owner == creator.key()
    )]
    pub user_input_token_account: InterfaceAccount<'info, TokenAccount>,

    /// User's destination account for output tokens
    #[account(
        constraint = user_destination_token_account.mint == output_mint.key(),
        constraint = user_destination_token_account.owner == creator.key()
    )]
    pub user_destination_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Input token mint
    pub input_mint: InterfaceAccount<'info, Mint>,
    /// Output token mint
    pub output_mint: InterfaceAccount<'info, Mint>,
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
) -> Result<()> {
    // Validate input parameters
    if input_amount == 0 {
        return Err(ErrorCode::InvalidAmount.into());
    }
    if min_output_amount == 0 {
        return Err(ErrorCode::InvalidAmount.into());
    }
    if trigger_price_bps == 0 || trigger_price_bps > 10_000 {
        return Err(ErrorCode::InvalidTriggerPrice.into());
    }
    if expiry <= Clock::get()?.unix_timestamp {
        return Err(ErrorCode::InvalidExpiry.into());
    }

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

    /// Limit order to execute
    #[account(
        mut,
        constraint = limit_order.status == OrderStatus::Open @ ErrorCode::InvalidOrderStatus,
        constraint = limit_order.input_vault == input_vault.key() @ ErrorCode::InvalidVaultAddress
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// Vault holding input tokens
    #[account(mut)]
    pub input_vault: InterfaceAccount<'info, TokenAccount>,

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
    pub user_destination_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Input token mint
    pub input_mint: InterfaceAccount<'info, Mint>,
    /// Output token mint
    pub output_mint: InterfaceAccount<'info, Mint>,

    /// Optional platform fee collection account
    #[account(mut)]
    pub platform_fee_account: Option<InterfaceAccount<'info, TokenAccount>>,

    /// Operator executing the order (must be registered)
    #[account(
        signer,
        constraint = adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub operator: Signer<'info>,
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

    // Additional validation based on order type
    match ctx.accounts.limit_order.trigger_type {
        TriggerType::TakeProfit => {
            // For Take Profit: quoted must be >= min_output (price increased)
            if quoted_out_amount < ctx.accounts.limit_order.min_output_amount {
                return Err(ErrorCode::InsufficientOutputAmount.into());
            }
        },
        TriggerType::StopLoss => {
            // For Stop Loss: quoted must be <= min_output (price decreased)
            if quoted_out_amount > ctx.accounts.limit_order.min_output_amount {
                return Err(ErrorCode::StopLossPriceNotReached.into());
            }
        }
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

    // Additional validation of actual output based on order type
    match ctx.accounts.limit_order.trigger_type {
        TriggerType::TakeProfit => {
            // For Take Profit: actual output must be >= min_output
            if output_amount < ctx.accounts.limit_order.min_output_amount {
                return Err(ErrorCode::InsufficientOutputAmount.into());
            }
        },
        TriggerType::StopLoss => {
            // For Stop Loss: actual output must be <= min_output
            if output_amount > ctx.accounts.limit_order.min_output_amount {
                return Err(ErrorCode::StopLossPriceNotReached.into());
            }
        }
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

    /// Limit order to cancel (will be closed)
    #[account(
        mut,
        close = creator,
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
    #[account(signer)]
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

/// Route and create order instruction accounts
/// This allows creating a limit order after executing an initial swap
#[event_cpi]
#[derive(Accounts)]
#[instruction(route_plan: Vec<RoutePlanStep>, nonce: u64)]
pub struct RouteAndCreateOrder<'info> {
    /// Adapter registry for routing validation
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,

    /// Vault authority controlling all vaults
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Token program for source tokens
    pub input_token_program: Interface<'info, TokenInterface>,
    /// Token program for intermediate tokens (result of first swap)
    pub intermediate_token_program: Interface<'info, TokenInterface>,

    /// User initiating the operation (must sign)
    #[account(mut, signer)]
    pub user_transfer_authority: Signer<'info>,

    /// User's source account for initial swap
    #[account(
        mut,
        constraint = user_source_token_account.mint == source_mint.key(),
        constraint = user_source_token_account.owner == user_transfer_authority.key()
    )]
    pub user_source_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Source token mint (input for first swap)
    pub source_mint: InterfaceAccount<'info, Mint>,
    /// Intermediate token mint (output of first swap, input for order)
    pub intermediate_mint: InterfaceAccount<'info, Mint>,

    /// Final output mint for limit order execution
    pub order_output_mint: InterfaceAccount<'info, Mint>,
    /// Token program for final output tokens
    pub order_output_token_program: Interface<'info, TokenInterface>,

    /// User's destination account for final output tokens
    #[account(
        constraint = user_final_destination_account.mint == order_output_mint.key(),
        constraint = user_final_destination_account.owner == user_transfer_authority.key()
    )]
    pub user_final_destination_account: InterfaceAccount<'info, TokenAccount>,

    /// Limit order account to be created
    #[account(
        init,
        payer = user_transfer_authority,
        space = 8 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 2 + 1 + 8 + 1 + 1,
        seeds = [b"limit_order", user_transfer_authority.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// Vault to hold intermediate tokens for order execution
    #[account(
        init,
        payer = user_transfer_authority,
        seeds = [b"order_vault", limit_order.key().as_ref()],
        bump,
        token::mint = intermediate_mint,
        token::authority = vault_authority,
        token::token_program = intermediate_token_program,
    )]
    pub order_vault: InterfaceAccount<'info, TokenAccount>,

    /// Optional platform fee collection account
    #[account(mut)]
    pub platform_fee_account: Option<InterfaceAccount<'info, TokenAccount>>,

    /// System program for account creation
    pub system_program: Program<'info, System>,
}

/// Executes a swap and creates a limit order with the output
/// This is useful for two-step trading strategies (e.g., SOL -> USDC -> BTC)
///
/// # Arguments
/// * `route_plan` - Swap route for initial swap
/// * `in_amount` - Amount of source tokens to swap
/// * `quoted_out_amount` - Expected output from initial swap
/// * `slippage_bps` - Slippage tolerance in basis points
/// * `platform_fee_bps` - Platform fee in basis points
/// * `nonce` - Unique identifier for order creation
/// * `min_order_output_amount` - Minimum output for limit order (baseline for trigger)
/// * `trigger_price_bps` - Trigger deviation percentage
/// * `trigger_type` - Type of trigger (TakeProfit or StopLoss)
/// * `expiry` - Order expiration timestamp
///
/// # Returns
/// * `Result<u64>` - Intermediate amount stored in order vault
pub fn route_and_create_order<'info>(
    ctx: Context<'_, '_, 'info, 'info, RouteAndCreateOrder<'info>>,
    route_plan: Vec<RoutePlanStep>,
    in_amount: u64,
    quoted_out_amount: u64,
    slippage_bps: u16,
    platform_fee_bps: u8,
    nonce: u64,
    min_order_output_amount: u64,
    trigger_price_bps: u16,
    trigger_type: TriggerType,
    expiry: i64,
) -> Result<u64> {
    // Validate input parameters
    if slippage_bps > 10_000 {
        return Err(ErrorCode::InvalidSlippage.into());
    }
    if trigger_price_bps == 0 || trigger_price_bps > 10_000 {
        return Err(ErrorCode::InvalidTriggerPrice.into());
    }
    if expiry <= Clock::get()?.unix_timestamp {
        return Err(ErrorCode::InvalidExpiry.into());
    }

    // Validate platform fee account
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        if platform_fee_account.owner != ctx.accounts.vault_authority.key() {
            return Err(ErrorCode::InvalidPlatformFeeOwner.into());
        }
        if platform_fee_account.mint != ctx.accounts.intermediate_mint.key() {
            return Err(ErrorCode::InvalidPlatformFeeMint.into());
        }
    }

    // Validate swap route: source -> intermediate
    route_validator_module::validate_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.intermediate_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.source_mint.to_account_info(),
        &ctx.accounts.intermediate_mint.to_account_info(),
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

    // Find input vault for initial swap
    let input_vault = ctx.remaining_accounts
        .iter()
        .find(|acc| {
            if let Ok(account_data) = acc.try_borrow_data() {
                if let Ok(token_account) = TokenAccount::try_deserialize(&mut account_data.as_ref()) {
                    token_account.mint == ctx.accounts.source_mint.key()
                } else {
                    false
                }
            } else {
                false
            }
        })
        .ok_or(ErrorCode::VaultNotFound)?;

    // Transfer source tokens to input vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.input_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_source_token_account.to_account_info(),
                to: input_vault.clone(),
                authority: ctx.accounts.user_transfer_authority.to_account_info(),
                mint: ctx.accounts.source_mint.to_account_info(),
            },
        ),
        in_amount,
        ctx.accounts.source_mint.decimals,
    )?;

    // Execute swap route into order vault
    let (mut output_amount, event_data) = route_executor_module::execute_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.source_mint.to_account_info(),
        &ctx.accounts.order_vault.to_account_info(),
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

    // Collect platform fee from intermediate tokens
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        let fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.intermediate_token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.order_vault.to_account_info(),
                        to: platform_fee_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                        mint: ctx.accounts.intermediate_mint.to_account_info(),
                    },
                    signer_seeds
                ),
                fee_amount,
                ctx.accounts.intermediate_mint.decimals,
            )?;

            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.intermediate_mint.key(),
                amount: fee_amount,
            });

            output_amount = output_amount.checked_sub(fee_amount).ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    // Verify slippage tolerance
    if output_amount < quoted_out_amount * (10_000 - slippage_bps as u64) / 10_000 {
        return Err(ErrorCode::SlippageToleranceExceeded.into());
    }

    // Initialize limit order with intermediate tokens
    let order = &mut ctx.accounts.limit_order;
    order.creator = ctx.accounts.user_transfer_authority.key();
    order.input_mint = ctx.accounts.intermediate_mint.key(); // Intermediate token as input
    order.output_mint = ctx.accounts.order_output_mint.key(); // Final output token
    order.input_vault = ctx.accounts.order_vault.key();
    order.user_destination_account = ctx.accounts.user_final_destination_account.key();
    order.input_amount = output_amount;
    order.min_output_amount = min_order_output_amount;
    order.trigger_price_bps = trigger_price_bps;
    order.trigger_type = trigger_type;
    order.expiry = expiry;
    order.status = OrderStatus::Open;
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

    Ok(output_amount)
}




