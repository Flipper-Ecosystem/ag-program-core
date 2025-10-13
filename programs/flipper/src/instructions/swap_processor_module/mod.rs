use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint, TokenAccount, TokenInterface,
    transfer_checked, TransferChecked
};
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
    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

    #[account(signer)]
    pub user_transfer_authority: Signer<'info>,

    #[account(
        mut,
        constraint = user_source_token_account.mint == source_mint.key(),
        constraint = user_source_token_account.owner == user_transfer_authority.key()
    )]
    pub user_source_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_destination_token_account.mint == destination_mint.key(),
        constraint = user_destination_token_account.owner == user_transfer_authority.key(),
    )]
    pub user_destination_token_account: InterfaceAccount<'info, TokenAccount>,


    pub source_mint: InterfaceAccount<'info, Mint>,
    pub destination_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub platform_fee_account: Option<InterfaceAccount<'info, TokenAccount>>,
    pub system_program: Program<'info, System>
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
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.output_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.source_mint.to_account_info(),
        &ctx.accounts.destination_mint.to_account_info(),
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

    // Find destination vault
    let destination_vault = ctx.remaining_accounts
        .iter()
        .rev()
        .find(|acc| {
            if let Ok(account_data) = acc.try_borrow_data() {
                if let Ok(token_account) = TokenAccount::try_deserialize(&mut account_data.as_ref()) {
                    token_account.mint == ctx.accounts.destination_mint.key()
                } else {
                    false
                }
            } else {
                false
            }
        })
        .ok_or(ErrorCode::VaultNotFound)?;

    // Transfer initial funds from user to input vault using input token program
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

    // Execute the route - now using destination_vault instead of user account
    let (mut output_amount, event_data) = route_executor_module::execute_route(
        &ctx.accounts.adapter_registry,
        &ctx.accounts.input_token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.source_mint.to_account_info(),
        destination_vault, // Changed: use vault instead of user account
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
            // Transfer fee using output token program
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.output_token_program.to_account_info(),
                    TransferChecked {
                        from: destination_vault.clone(),
                        to: platform_fee_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                        mint: ctx.accounts.destination_mint.to_account_info(),
                    },
                    signer_seeds
                ),
                fee_amount,
                ctx.accounts.destination_mint.decimals,
            )?;

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

    // Transfer final amount from destination vault to user
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.output_token_program.to_account_info(),
            TransferChecked {
                from: destination_vault.clone(),
                to: ctx.accounts.user_destination_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
                mint: ctx.accounts.destination_mint.to_account_info(),
            },
            signer_seeds
        ),
        output_amount,
        ctx.accounts.destination_mint.decimals,
    )?;

    Ok(output_amount)
}