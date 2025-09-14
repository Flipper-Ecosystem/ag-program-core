use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
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
    vault_authority: &AccountInfo<'info>,
    source_mint: &AccountInfo<'info>,
    destination_mint: &AccountInfo<'info>,
    route_plan: &[RoutePlanStep],
    remaining_accounts: &'info [AccountInfo<'info>],
    program_id: &Pubkey,
    in_amount: u64,
) -> Result<()> {
    // Validate route plan emptiness
    if route_plan.is_empty() {
        return Err(ErrorCode::EmptyRoute.into());
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

    // Validate input vault using token_interface
    let input_vault = remaining_accounts
        .iter()
        .find(|acc| {
            // Try to deserialize as TokenAccount using interface
            if let Ok(account_data) = acc.try_borrow_data() {
                if let Ok(token_account) = TokenAccount::try_deserialize(&mut account_data.as_ref()) {
                    token_account.mint == source_mint.key()
                } else {
                    false
                }
            } else {
                false
            }
        })
        .ok_or(ErrorCode::VaultNotFound)?;

    // Detect partial swaps and multi-hop swaps
    let mut input_vault_key = None;
    let mut is_partial_swap = false;
    let mut is_multi_hop = false;
    let mut used_dexes = Vec::new();
    let mut output_mints = Vec::new();
    let mut current_amount = in_amount;

    for i in 0..route_plan.len() {
        let step = &route_plan[i];
        // Validate percent is non-zero and within bounds
        if step.percent == 0 || step.percent > 100 {
            return Err(ErrorCode::InvalidPercent.into());
        }

        // Validate account indices
        if step.input_index as usize >= remaining_accounts.len() || step.output_index as usize >= remaining_accounts.len() {
            return Err(ErrorCode::InvalidAccountIndex.into());
        }

        let input_vault_account = &remaining_accounts[step.input_index as usize];
        let output_account_info = if i == route_plan.len() - 1 {
            destination_mint.clone()
        } else {
            remaining_accounts[step.output_index as usize].clone()
        };

        // Check step amount
        let step_amount = if step.percent == 100 {
            current_amount
        } else {
            (current_amount as u128 * step.percent as u128 / 100) as u64
        };
        if step_amount == 0 {
            return Err(ErrorCode::InvalidCalculation.into());
        }

        // Check for partial swaps: same input vault and percent < 100
        if step.percent < 100 {
            if input_vault_key.is_none() {
                input_vault_key = Some(input_vault_account.key());
            }
            if input_vault_key == Some(input_vault_account.key()) {
                is_partial_swap = true;
            }
            // Track DEXes for partial swaps
            let adapter_info = adapter_registry
                .supported_adapters
                .iter()
                .find(|a| a.swap_type == step.swap)
                .ok_or(ErrorCode::SwapNotSupported)?;
            if !used_dexes.contains(&adapter_info.program_id) {
                used_dexes.push(adapter_info.program_id);
            }
        }

        // Check for multi-hop: input vault matches a previous output vault
        if i > 0 {
            for prev_step in route_plan.iter().take(i) {
                let prev_output_vault = &remaining_accounts[prev_step.output_index as usize];
                if input_vault_account.key() == prev_output_vault.key() {
                    is_multi_hop = true;
                    break;
                }
            }
        }

        // Validate multi-hop: ensure input mint matches previous output mint
        if is_multi_hop && i > 0 {
            let account_data = input_vault_account.try_borrow_data()?;
            let input_vault_data = TokenAccount::try_deserialize(&mut account_data.as_ref())?;
            let prev_output_mint = output_mints[i - 1];
            if input_vault_data.mint != prev_output_mint {
                return Err(ErrorCode::InvalidMultiHopRoute.into());
            }
        }

        // Determine output mint
        let output_mint = if i == route_plan.len() - 1 {
            destination_mint.key()
        } else {
            let account_data = output_account_info.try_borrow_data()?;
            let output_vault_data = TokenAccount::try_deserialize(&mut account_data.as_ref())?;
            output_vault_data.mint
        };
        output_mints.push(output_mint);

        // Update current_amount for multi-hop validation
        if is_multi_hop && output_mint != destination_mint.key() {
            current_amount = step_amount; // Simulate passing amount to next step
        }

        // Validate adapter and pool
        if !adapter_registry.is_supported_adapter(&step.swap) {
            return Err(ErrorCode::SwapNotSupported.into());
        }

        let account_data = input_vault_account.try_borrow_data()?;
        let input_vault_data = TokenAccount::try_deserialize(&mut account_data.as_ref())?;
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
            authority: vault_authority.clone(),
            input_account: input_vault_account.clone(),
            output_account: output_account_info,
            remaining_accounts,
            program_id: *program_id,
        };

        adapter.validate_accounts(adapter_ctx, step.input_index as usize + 1)?;
    }

    // Validate partial swap: ensure multiple DEXes and same input vault
    if is_partial_swap {
        let total_percent: u8 = route_plan
            .iter()
            .filter(|step| {
                let input_vault = &remaining_accounts[step.input_index as usize];
                input_vault_key == Some(input_vault.key())
            })
            .map(|step| step.percent)
            .sum();
        if total_percent != 100 {
            return Err(ErrorCode::InvalidPartialSwapPercent.into());
        }
        if used_dexes.len() < 2 {
            return Err(ErrorCode::InsufficientDexesForPartialSwap.into());
        }
    }

    // Ensure at least one step produces destination_mint
    if !output_mints.iter().any(|mint| *mint == destination_mint.key()) {
        return Err(ErrorCode::NoOutputProduced.into());
    }

    Ok(())
}