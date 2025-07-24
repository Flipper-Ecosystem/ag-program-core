use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::adapters::{AdapterContext, get_adapter};
use crate::errors::ErrorCode;
use crate::state::*;

/// Executes a token swap through a series of routing steps.
///
/// This function processes a swap route defined by the `route_plan`, transferring tokens from the
/// user's source account to the destination account via one or more adapters. It validates the route,
/// checks for slippage, applies platform fees if applicable, and emits events for each swap and fee.
///
/// # Lifetime Analysis
/// The function uses the `'info` lifetime, standard in Anchor for Solana, to ensure all account references
/// remain valid during instruction execution. The `AdapterContext<'info>` struct contains references to
/// account data (`AccountInfo<'info>`) and a slice of remaining accounts (`&'info [AccountInfo<'info>]`),
/// all tied to the `'info` lifetime. This guarantees memory safety by ensuring references do not outlive
/// the instruction's scope. Each iteration of the loop creates a new `AdapterContext` instance, which is
/// cloned for validation and moved into the `execute_swap` call, transferring ownership. The actual
/// account data is not copied; only metadata is cloned, and the `remaining_accounts` slice reference is
/// shared across iterations, maintaining the `'info` lifetime.
///
/// # Arguments
/// * `ctx` - Context containing accounts for the adapter registry, token program, and user accounts,
///           with all references tied to the `'info` lifetime.
/// * `route_plan` - Vector of steps defining the swap route, including adapter and token indices.
/// * `in_amount` - The input token amount to swap.
/// * `quoted_out_amount` - The expected output amount for slippage checking.
/// * `slippage_bps` - Maximum slippage allowed in basis points (max 10,000).
/// * `platform_fee_bps` - Platform fee in basis points, if applicable.
///
/// # Returns
/// * `Result<u64>` - Returns the final output amount on success, or an error if validation fails.
pub fn route<'info>(
    ctx: Context<'_, '_, 'info, 'info, Route<'info>>,
    route_plan: Vec<RoutePlanStep>,
    in_amount: u64,
    quoted_out_amount: u64,
    slippage_bps: u16,
    platform_fee_bps: u8,
) -> Result<u64> {
    if route_plan.is_empty() {
        return Err(ErrorCode::EmptyRoute.into());
    }

    let total_percent: u8 = route_plan.iter().map(|step| step.percent).sum();
    if total_percent != 100 {
        return Err(ErrorCode::NotEnoughPercent.into());
    }

    if slippage_bps > 10_000 {
        return Err(ErrorCode::InvalidSlippage.into());
    }

    let max_index = route_plan
        .iter()
        .map(|step| step.input_index.max(step.output_index) as usize + 1)
        .max()
        .unwrap_or(0);
    if ctx.remaining_accounts.len() < max_index {
        return Err(ErrorCode::NotEnoughAccountKeys.into());
    }

    let adapter_registry = &ctx.accounts.adapter_registry;
    let mut current_amount = in_amount;
    let mut output_amount = 0;

    let token_program_info = ctx.accounts.token_program.to_account_info();
    let authority_info = ctx.accounts.user_transfer_authority.to_account_info();

    for step in &route_plan {
        if !adapter_registry.is_supported_adapter(&step.swap) {
            return Err(ErrorCode::SwapNotSupported.into());
        }

        let step_amount = (current_amount as u128 * step.percent as u128 / 100) as u64;
        if step_amount == 0 {
            return Err(ErrorCode::InvalidCalculation.into());
        }

        let input_account = ctx.remaining_accounts[step.input_index as usize].clone();
        let output_account = ctx.remaining_accounts[step.output_index as usize].clone();

        let adapter = get_adapter(&step.swap, adapter_registry)?;
        let adapter_program_id = adapter_registry.get_adapter_program_id(&step.swap)?;

        let adapter_ctx = AdapterContext {
            token_program: token_program_info.clone(),
            authority: authority_info.clone(),
            input_account,
            output_account,
            remaining_accounts: ctx.remaining_accounts,
        };

        adapter.validate_accounts(adapter_ctx.clone(), step.input_index as usize + 1)?;
        let swap_result = adapter.execute_swap(adapter_ctx, step_amount, step.input_index as usize + 1)?;

        output_amount += swap_result.output_amount;
        current_amount = swap_result.output_amount;

        emit_cpi!(SwapEvent {
            amm: adapter_program_id,
            input_mint: ctx.accounts.user_source_token_account.mint,
            input_amount: step_amount,
            output_mint: ctx.accounts.user_destination_token_account.mint,
            output_amount: current_amount,
        });
    }

    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        let fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.destination_mint.key(),
                amount: fee_amount,
            });
            output_amount = output_amount.checked_sub(fee_amount).ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    if output_amount < quoted_out_amount * (10_000 - slippage_bps as u64) / 10_000 {
        return Err(ErrorCode::SlippageToleranceExceeded.into());
    }

    Ok(output_amount)
}

/// Accounts for executing a token swap route.
///
/// # Lifetime Analysis
/// The `Route<'info>` struct uses the `'info` lifetime to ensure all account references remain valid
/// during instruction execution. Each field (`Account<'info, T>`, `Program<'info, T>`, `Signer<'info>`)
/// is tied to the `'info` lifetime, guaranteeing that references to account data do not outlive the
/// instruction's scope. Anchor automatically handles deserialization and validation of accounts,
/// ensuring the `'info` lifetime is respected. The `remaining_accounts` slice (`&'info [AccountInfo<'info>]`)
/// is shared across all `AdapterContext` instances in the route function, maintaining the same lifetime.
#[event_cpi]
#[derive(Accounts)]
#[instruction(route_plan: Vec<RoutePlanStep>)]
pub struct Route<'info> {
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    pub token_program: Program<'info, Token>,
    #[account(signer)]
    pub user_transfer_authority: Signer<'info>,
    #[account(
        mut,
        constraint = route_plan[0].input_index == 0 @ ErrorCode::InvalidInputIndex,
        token::mint = source_mint
    )]
    pub user_source_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = route_plan.iter().last().map(|step| step.output_index == 1).unwrap_or(true) @ ErrorCode::InvalidOutputIndex,
        token::mint = destination_mint
    )]
    pub user_destination_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination_token_account: Option<Account<'info, TokenAccount>>,
    /// CHECK: Source mint, validated by token account constraints.
    pub source_mint: AccountInfo<'info>,
    /// CHECK: Destination mint, validated by token account constraints.
    pub destination_mint: AccountInfo<'info>,
    #[account(mut)]
    pub platform_fee_account: Option<Account<'info, TokenAccount>>,
}