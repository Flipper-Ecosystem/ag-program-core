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

/// Represents the status of a limit order
#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderStatus {
    Open = 0,
    Filled = 1,
    Cancelled = 2,
}

/// Account structure for a limit order
#[account]
pub struct LimitOrder {
    pub creator: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_vault: Pubkey,
    pub input_amount: u64,
    pub min_output_amount: u64,
    pub expiry: i64,
    pub status: OrderStatus,
    pub bump: u8,
}

/// Creates a standalone limit order
#[event_cpi]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateLimitOrder<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        init,
        payer = creator,
        space = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1,
        seeds = [b"limit_order", creator.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub limit_order: Account<'info, LimitOrder>,

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

    #[account(
        mut,
        constraint = user_input_token_account.mint == input_mint.key(),
        constraint = user_input_token_account.owner == creator.key()
    )]
    pub user_input_token_account: InterfaceAccount<'info, TokenAccount>,

    pub input_mint: InterfaceAccount<'info, Mint>,
    pub output_mint: InterfaceAccount<'info, Mint>,
    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

    #[account(mut, signer)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_limit_order(
    ctx: Context<CreateLimitOrder>,
    nonce: u64,
    input_amount: u64,
    min_output_amount: u64,
    expiry: i64,
) -> Result<()> {
    if input_amount == 0 {
        return Err(ErrorCode::InvalidAmount.into());
    }
    if min_output_amount == 0 {
        return Err(ErrorCode::InvalidAmount.into());
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

    let order = &mut ctx.accounts.limit_order;
    order.creator = ctx.accounts.creator.key();
    order.input_mint = ctx.accounts.input_mint.key();
    order.output_mint = ctx.accounts.output_mint.key();
    order.input_vault = ctx.accounts.input_vault.key();
    order.input_amount = input_amount;
    order.min_output_amount = min_output_amount;
    order.expiry = expiry;
    order.status = OrderStatus::Open;
    order.bump = ctx.bumps.limit_order;

    emit_cpi!(LimitOrderCreated {
        order: order.key(),
        creator: order.creator,
        input_mint: order.input_mint,
        output_mint: order.output_mint,
        input_amount: order.input_amount,
        min_output_amount: order.min_output_amount,
        expiry: order.expiry,
    });

    Ok(())
}

/// Executes a limit order by routing the swap
#[event_cpi]
#[derive(Accounts)]
#[instruction(route_plan: Vec<RoutePlanStep>)]
pub struct ExecuteLimitOrder<'info> {
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,

    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        mut,
        constraint = limit_order.status == OrderStatus::Open @ ErrorCode::InvalidOrderStatus,
        constraint = limit_order.input_vault == input_vault.key() @ ErrorCode::InvalidVaultAddress
    )]
    pub limit_order: Account<'info, LimitOrder>,

    #[account(mut)]
    pub input_vault: InterfaceAccount<'info, TokenAccount>,

    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

    #[account(
        mut,
        constraint = user_destination_token_account.mint == limit_order.output_mint,
        constraint = user_destination_token_account.owner == limit_order.creator
    )]
    pub user_destination_token_account: InterfaceAccount<'info, TokenAccount>,

    pub input_mint: InterfaceAccount<'info, Mint>,
    pub output_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub platform_fee_account: Option<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        signer,
        constraint = adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub operator: Signer<'info>,
}

pub fn execute_limit_order<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteLimitOrder<'info>>,
    route_plan: Vec<RoutePlanStep>,
    quoted_out_amount: u64,
    platform_fee_bps: u8,
) -> Result<u64> {
    let now = Clock::get()?.unix_timestamp;
    if now >= ctx.accounts.limit_order.expiry {
        return Err(ErrorCode::OrderExpired.into());
    }

    let in_amount = ctx.accounts.limit_order.input_amount;

    // Validate route
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

    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Execute the route
    let (mut output_amount, event_data) = route_executor_module::execute_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.input_mint.to_account_info(),
        &ctx.accounts.user_destination_token_account.to_account_info(),
        &route_plan,
        ctx.remaining_accounts,
        ctx.program_id,
        in_amount,
    )?;

    // Check minimum output
    if output_amount < ctx.accounts.limit_order.min_output_amount {
        return Err(ErrorCode::SlippageToleranceExceeded.into());
    }

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

    // Apply platform fee if specified
    let mut fee_amount = 0;
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        if platform_fee_account.mint != ctx.accounts.output_mint.key() {
            return Err(ErrorCode::InvalidPlatformFeeMint.into());
        }
        fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            // Assume last step outputs to a destination vault if fee is taken
            let destination_vault = ctx.remaining_accounts
                .iter()
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

    // If using destination vault, transfer net to user
    if ctx.accounts.platform_fee_account.is_some() {
        let destination_vault = ctx.remaining_accounts
            .iter()
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
    }

    // Update order status
    ctx.accounts.limit_order.status = OrderStatus::Filled;

    emit_cpi!(LimitOrderExecuted {
        order: ctx.accounts.limit_order.key(),
        executor: ctx.accounts.operator.key(),
        input_amount: in_amount,
        output_amount,
        fee_amount,
    });

    Ok(output_amount)
}

/// Cancels a limit order and returns tokens to the creator
#[event_cpi]
#[derive(Accounts)]
pub struct CancelLimitOrder<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        mut,
        close = creator,
        constraint = limit_order.status == OrderStatus::Open @ ErrorCode::InvalidOrderStatus,
        constraint = limit_order.creator == creator.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub limit_order: Account<'info, LimitOrder>,

    #[account(mut)]
    pub input_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_input_token_account.mint == limit_order.input_mint,
        constraint = user_input_token_account.owner == creator.key()
    )]
    pub user_input_token_account: InterfaceAccount<'info, TokenAccount>,

    pub input_mint: InterfaceAccount<'info, Mint>,
    pub input_token_program: Interface<'info, TokenInterface>,

    #[account(signer)]
    pub creator: Signer<'info>,
}

pub fn cancel_limit_order(ctx: Context<CancelLimitOrder>) -> Result<()> {
    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Transfer tokens back to user
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

    // Update status
    ctx.accounts.limit_order.status = OrderStatus::Cancelled;

    emit_cpi!(LimitOrderCancelled {
        order: ctx.accounts.limit_order.key(),
        creator: ctx.accounts.creator.key(),
    });

    Ok(())
}

/// Routes and creates a limit order with the output
#[event_cpi]
#[derive(Accounts)]
#[instruction(route_plan: Vec<RoutePlanStep>, nonce: u64)]
pub struct RouteAndCreateOrder<'info> {
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,

    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>, // For route output, which is order input

    #[account(mut, signer)]
    pub user_transfer_authority: Signer<'info>,

    #[account(
        mut,
        constraint = user_source_token_account.mint == source_mint.key(),
        constraint = user_source_token_account.owner == user_transfer_authority.key()
    )]
    pub user_source_token_account: InterfaceAccount<'info, TokenAccount>,

    pub source_mint: InterfaceAccount<'info, Mint>,
    pub destination_mint: InterfaceAccount<'info, Mint>, // Route destination, order input mint

    pub order_output_mint: InterfaceAccount<'info, Mint>,
    pub order_output_token_program: Interface<'info, TokenInterface>,

    #[account(
        init,
        payer = user_transfer_authority,
        space = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1,
        seeds = [b"limit_order", user_transfer_authority.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub limit_order: Account<'info, LimitOrder>,

    #[account(
        init,
        payer = user_transfer_authority,
        seeds = [b"order_vault", limit_order.key().as_ref()],
        bump,
        token::mint = destination_mint,
        token::authority = vault_authority,
        token::token_program = output_token_program,
    )]
    pub order_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub platform_fee_account: Option<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
}

pub fn route_and_create_order<'info>(
    ctx: Context<'_, '_, 'info, 'info, RouteAndCreateOrder<'info>>,
    route_plan: Vec<RoutePlanStep>,
    in_amount: u64,
    quoted_out_amount: u64,
    slippage_bps: u16,
    platform_fee_bps: u8,
    nonce: u64,
    min_order_output_amount: u64,
    expiry: i64,
) -> Result<u64> {
    if slippage_bps > 10_000 {
        return Err(ErrorCode::InvalidSlippage.into());
    }
    if expiry <= Clock::get()?.unix_timestamp {
        return Err(ErrorCode::InvalidExpiry.into());
    }

    // Validate platform_fee_account if provided
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        if platform_fee_account.owner != ctx.accounts.vault_authority.key() {
            return Err(ErrorCode::InvalidPlatformFeeOwner.into());
        }
        if platform_fee_account.mint != ctx.accounts.destination_mint.key() {
            return Err(ErrorCode::InvalidPlatformFeeMint.into());
        }
    }

    // Validate route
    route_validator_module::validate_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.output_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.source_mint.to_account_info(),
        &ctx.accounts.destination_mint.to_account_info(),
        &route_plan,
        ctx.remaining_accounts,
        ctx.program_id,
        in_amount,
    )?;

    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Find input vault
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

    // Transfer initial funds to input vault
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

    // Execute route to order_vault
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

    // Apply platform fee if specified
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        let fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.output_token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.order_vault.to_account_info(),
                        to: platform_fee_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                        mint: ctx.accounts.destination_mint.to_account_info(),
                    },
                    signer_seeds
                ),
                fee_amount,
                ctx.accounts.destination_mint.decimals,
            )?;

            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.destination_mint.key(),
                amount: fee_amount,
            });

            output_amount = output_amount.checked_sub(fee_amount).ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    // Check slippage
    if output_amount < quoted_out_amount * (10_000 - slippage_bps as u64) / 10_000 {
        return Err(ErrorCode::SlippageToleranceExceeded.into());
    }

    // Set up the limit order
    let order = &mut ctx.accounts.limit_order;
    order.creator = ctx.accounts.user_transfer_authority.key();
    order.input_mint = ctx.accounts.destination_mint.key();
    order.output_mint = ctx.accounts.order_output_mint.key();
    order.input_vault = ctx.accounts.order_vault.key();
    order.input_amount = output_amount;
    order.min_output_amount = min_order_output_amount;
    order.expiry = expiry;
    order.status = OrderStatus::Open;
    order.bump = ctx.bumps.limit_order;

    emit_cpi!(LimitOrderCreated {
        order: order.key(),
        creator: order.creator,
        input_mint: order.input_mint,
        output_mint: order.output_mint,
        input_amount: order.input_amount,
        min_output_amount: order.min_output_amount,
        expiry: order.expiry,
    });

    Ok(output_amount)
}