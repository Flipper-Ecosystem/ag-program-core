use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer, transfer, InitializeAccount, initialize_account};
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use crate::adapters::{AdapterContext, get_adapter};
use crate::errors::ErrorCode;
use crate::state::*;




// Остальной код остается без изменений...
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

    let required_accounts = route_plan.len() * 3;
    if ctx.remaining_accounts.len() < required_accounts {
        return Err(ErrorCode::NotEnoughAccountKeys.into());
    }

    let adapter_registry = &ctx.accounts.adapter_registry;
    let mut current_amount = in_amount;
    let mut output_amount = 0;

    let token_program_info = ctx.accounts.token_program.to_account_info();

    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority",
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

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

    let cpi_accounts_transfer = Transfer {
        from: ctx.accounts.user_source_token_account.to_account_info(),
        to: input_vault.clone(),
        authority: ctx.accounts.user_transfer_authority.to_account_info(),
    };
    let cpi_ctx_transfer = CpiContext::new(token_program_info.clone(), cpi_accounts_transfer);
    transfer(cpi_ctx_transfer, in_amount)?;

    for (i, step) in route_plan.iter().enumerate() {
        if !adapter_registry.is_supported_adapter(&step.swap) {
            return Err(ErrorCode::SwapNotSupported.into());
        }

        let step_amount = (current_amount as u128 * step.percent as u128 / 100) as u64;
        if step_amount == 0 {
            return Err(ErrorCode::InvalidCalculation.into());
        }

        let input_vault_account = &ctx.remaining_accounts[step.input_index as usize];

        let output_account_info = if i == route_plan.len() - 1 {
            ctx.accounts.user_destination_token_account.to_account_info()
        } else {
            ctx.remaining_accounts[step.output_index as usize].clone()
        };

        let input_vault_data = TokenAccount::try_deserialize(&mut input_vault_account.data.borrow().as_ref())?;
        if i == 0 && input_vault_data.mint != ctx.accounts.source_mint.key() {
            return Err(ErrorCode::InvalidMint.into());
        }

        let adapter = get_adapter(&step.swap, adapter_registry)?;
        let adapter_info = adapter_registry
            .supported_adapters
            .iter()
            .find(|a| a.swap_type == step.swap)
            .ok_or(ErrorCode::SwapNotSupported)?;

        let pool_info_account = &ctx.remaining_accounts[step.input_index as usize + 1];
        let pool_info = Account::<PoolInfo>::try_from(pool_info_account)?;
        if pool_info.adapter_swap_type != step.swap || !pool_info.enabled {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        let pool_account = &ctx.remaining_accounts[step.input_index as usize + 2];
        if pool_account.key() != pool_info.pool_address {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }


        let adapter_ctx = AdapterContext {
            token_program: token_program_info.clone(),
            authority: ctx.accounts.vault_authority.to_account_info(),
            input_account: input_vault_account.clone(),
            output_account: output_account_info.clone(),
            remaining_accounts: ctx.remaining_accounts,
        };

        adapter.validate_accounts(adapter_ctx.clone(), step.input_index as usize + 1)?;

        let swap_result = adapter.execute_swap(adapter_ctx, step_amount, step.input_index as usize + 1)?;

        output_amount += swap_result.output_amount;
        current_amount = swap_result.output_amount;

        let output_vault_data = if i != route_plan.len() - 1 {
            Some(TokenAccount::try_deserialize(&mut output_account_info.data.borrow().as_ref())?)
        } else {
            None
        };

        emit_cpi!(SwapEvent {
            amm: adapter_info.program_id,
            input_mint: input_vault_data.mint,
            input_amount: step_amount,
            output_mint: if let Some(output_data) = output_vault_data {
                output_data.mint
            } else {
                ctx.accounts.destination_mint.key()
            },
            output_amount: current_amount,
        });
    }

    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        let fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
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

            let cpi_accounts_fee = Transfer {
                from: destination_vault.clone(),
                to: platform_fee_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx_fee = CpiContext::new_with_signer(
                token_program_info.clone(),
                cpi_accounts_fee,
                signer_seeds
            );
            transfer(cpi_ctx_fee, fee_amount)?;

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
    /// CHECK: vault authority
    pub vault_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    #[account(signer)]
    pub user_transfer_authority: Signer<'info>,
    #[account(
        mut,
        token::mint = source_mint
    )]
    pub user_source_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = destination_mint
    )]
    pub user_destination_token_account: Account<'info, TokenAccount>,
    /// CHECK: Mint account for the input token
    pub source_mint: AccountInfo<'info>,
    /// CHECK: Mint account for the output token
    pub destination_mint: AccountInfo<'info>,
    #[account(mut)]
    pub platform_fee_account: Option<Account<'info, TokenAccount>>,
}