use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount};
use crate::adapters::adapter_connector_module::{AdapterContext, get_adapter};
use crate::errors::ErrorCode;
use crate::state::*;

// Program IDs for validation
pub const TOKEN_PROGRAM_ID: Pubkey = anchor_spl::token::ID;
pub const TOKEN_2022_PROGRAM_ID: Pubkey = anchor_spl::token_2022::ID;

/// Validates that the provided account is a valid token program
pub fn validate_token_program(program_account: &AccountInfo) -> Result<()> {
    let valid_token_programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
    if !valid_token_programs.contains(&program_account.key()) {
        return Err(ErrorCode::InvalidCpiInterface.into());
    }
    Ok(())
}

/// Validates that a mint is compatible with the specified token program
pub fn validate_mint_program_compatibility(mint_account: &AccountInfo, token_program: &AccountInfo) -> Result<()> {
    if mint_account.owner != &token_program.key() {
        return Err(ErrorCode::InvalidMint.into());
    }
    Ok(())
}

/// Validates the route plan and associated accounts
pub fn validate_route<'info>(
    adapter_registry: &Account<'info, AdapterRegistry>,
    input_token_program: &AccountInfo<'info>,
    output_token_program: &AccountInfo<'info>,
    source_mint: &AccountInfo<'info>,
    destination_mint: &AccountInfo<'info>,
    route_plan: &[RoutePlanStep],
    remaining_accounts: &'info [AccountInfo<'info>],
    program_id: &Pubkey,
) -> Result<()> {
    // Validate route plan
    if route_plan.is_empty() {
        return Err(ErrorCode::EmptyRoute.into());
    }

    let total_percent: u8 = route_plan.iter().map(|step| step.percent).sum();
    if total_percent != 100 {
        return Err(ErrorCode::NotEnoughPercent.into());
    }

    // Validate token programs
    validate_token_program(input_token_program)?;
    validate_token_program(output_token_program)?;

    // Validate mint compatibility with token programs
    validate_mint_program_compatibility(source_mint, input_token_program)?;
    validate_mint_program_compatibility(destination_mint, output_token_program)?;

    // Validate number of remaining accounts
    let required_accounts = route_plan.len() * 3;
    if remaining_accounts.len() < required_accounts {
        return Err(ErrorCode::NotEnoughAccountKeys.into());
    }

    // Validate input vault
    let input_vault = remaining_accounts
        .iter()
        .find(|acc| {
            if let Ok(token_account) = TokenAccount::try_deserialize(&mut acc.data.borrow().as_ref()) {
                token_account.mint == source_mint.key()
            } else {
                false
            }
        })
        .ok_or(ErrorCode::VaultNotFound)?;

    // Validate each step in the route plan
    for (i, step) in route_plan.iter().enumerate() {
        if !adapter_registry.is_supported_adapter(&step.swap) {
            return Err(ErrorCode::SwapNotSupported.into());
        }

        let input_vault_account = &remaining_accounts[step.input_index as usize];
        let input_vault_data = TokenAccount::try_deserialize(&mut input_vault_account.data.borrow().as_ref())?;
        if i == 0 && input_vault_data.mint != source_mint.key() {
            return Err(ErrorCode::InvalidMint.into());
        }

        // Validate pool info
        let pool_info_account = &remaining_accounts[step.input_index as usize + 1];
        let pool_info = Account::<PoolInfo>::try_from(pool_info_account)?;
        if pool_info.adapter_swap_type != step.swap || !pool_info.enabled {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate pool address matches
        let pool_account = &remaining_accounts[step.input_index as usize + 2];
        if pool_account.key() != pool_info.pool_address {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate adapter accounts
        let adapter = get_adapter(&step.swap, adapter_registry)?;
        let adapter_ctx = AdapterContext {
            token_program: input_token_program.clone(),
            authority: input_vault_account.clone(), // Placeholder; adjust if vault_authority is needed
            input_account: input_vault_account.clone(),
            output_account: if i == route_plan.len() - 1 {
                destination_mint.clone()
            } else {
                remaining_accounts[step.output_index as usize].clone()
            },
            remaining_accounts,
            program_id: *program_id,
        };

        adapter.validate_accounts(adapter_ctx, step.input_index as usize + 1)?;
    }

    Ok(())
}