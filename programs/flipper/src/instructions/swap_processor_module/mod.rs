use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer, transfer, InitializeAccount, initialize_account};
use anchor_spl::token_2022::{Token2022};
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use crate::adapters::adapter_connector_module::AdapterContext;
use crate::errors::ErrorCode;
use crate::state::*;
use crate::instructions::route_validator_module;
use crate::instructions::route_executor_module;
use crate::instructions::vault_manager_module::{VaultAuthority};
#[event_cpi]
#[derive(Accounts)]
#[instruction(route_plan: Vec<RoutePlanStep>)]
pub struct Route<'info> {
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

    // Separate token programs for input and output
    /// CHECK: Input token program (SPL Token or Token2022)
    pub input_token_program: AccountInfo<'info>,
    /// CHECK: Output token program (SPL Token or Token2022)
    pub output_token_program: AccountInfo<'info>,

    #[account(signer)]
    pub user_transfer_authority: Signer<'info>,
    #[account(
        mut,
        token::mint = source_mint,
        token::token_program = input_token_program
    )]
    pub user_source_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = destination_mint,
        token::token_program = output_token_program
    )]
    pub user_destination_token_account: Account<'info, TokenAccount>,
    /// CHECK: Mint account for the input token
    pub source_mint: AccountInfo<'info>,
    /// CHECK: Mint account for the output token
    pub destination_mint: AccountInfo<'info>,
    #[account(mut)]
    pub platform_fee_account: Option<Account<'info, TokenAccount>>,
}

pub fn route<'info>(
    ctx: Context<'_, '_, 'info, 'info, Route<'info>>,
    route_plan: Vec<RoutePlanStep>,
    in_amount: u64,
    quoted_out_amount: u64,
    slippage_bps: u16,
    platform_fee_bps: u8,
) -> Result<u64> {
    if slippage_bps > 10_000 {
        return Err(ErrorCode::InvalidSlippage.into());
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

    // Validate route and accounts
    route_validator_module::validate_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program,
        &ctx.accounts.output_token_program,
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.source_mint,
        &ctx.accounts.destination_mint,
        &route_plan,
        ctx.remaining_accounts,
        ctx.program_id,
        in_amount
    )?;

    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Find input vault that matches source mint
    let input_vault = ctx.remaining_accounts
        .iter()
        .find(|acc| {
            if let Ok(token_account) = TokenAccount::try_deserialize(&mut acc.data.borrow().as_ref()) {
                token_account.mint == ctx.accounts.source_mint.key()
            } else {
                false
            }
        })
        .ok_or(ErrorCode::VaultNotFound)?;

    // Transfer initial funds from user to input vault using input token program
    let input_token_program_info = ctx.accounts.input_token_program.to_account_info();

    let cpi_accounts_transfer = Transfer {
        from: ctx.accounts.user_source_token_account.to_account_info(),
        to: input_vault.clone(),
        authority: ctx.accounts.user_transfer_authority.to_account_info(),
    };
    let cpi_ctx_transfer = CpiContext::new(input_token_program_info.clone(), cpi_accounts_transfer);
    transfer(cpi_ctx_transfer, in_amount)?;

    // Execute the route and collect event data
    let (mut output_amount, event_data) = route_executor_module::execute_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program,
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.source_mint,
        &ctx.accounts.user_destination_token_account.to_account_info(),
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
            // Find destination vault
            let destination_vault = ctx.remaining_accounts
                .iter()
                .find(|acc| {
                    if let Ok(token_account) = TokenAccount::try_deserialize(&mut acc.data.borrow().as_ref()) {
                        token_account.mint == ctx.accounts.destination_mint.key()
                    } else {
                        false
                    }
                })
                .ok_or(ErrorCode::VaultNotFound)?;

            // Transfer fee using output token program
            let output_token_program_info = ctx.accounts.output_token_program.to_account_info();

            let cpi_accounts_fee = Transfer {
                from: destination_vault.clone(),
                to: platform_fee_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx_fee = CpiContext::new_with_signer(
                output_token_program_info,
                cpi_accounts_fee,
                signer_seeds
            );
            transfer(cpi_ctx_fee, fee_amount)?;

            // Emit fee event
            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.destination_mint.key(),
                amount: fee_amount,
            });

            output_amount = output_amount.checked_sub(fee_amount).ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    // Check slippage tolerance
    if output_amount < quoted_out_amount * (10_000 - slippage_bps as u64) / 10_000 {
        return Err(ErrorCode::SlippageToleranceExceeded.into());
    }

    Ok(output_amount)
}
