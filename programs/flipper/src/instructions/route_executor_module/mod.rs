use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;
use crate::adapters::adapter_connector_module::{AdapterContext, get_adapter};
use crate::errors::ErrorCode;
use crate::state::*;

/// Represents data needed for emitting a SwapEvent for each step
#[derive(Clone)]
pub struct SwapEventData {
    pub amm: Pubkey,
    pub input_mint: Pubkey,
    pub input_amount: u64,
    pub output_mint: Pubkey,
    pub output_amount: u64,
}

/// Executes a route plan, handling partial swaps, multi-hop swaps, and partial multi-hop swaps
/// # Arguments
/// * `adapter_registry` - The adapter registry containing supported adapters
/// * `input_token_program` - The token program for transfers
/// * `vault_authority` - The authority for the vault accounts
/// * `source_mint` - The mint of the input token
/// * `user_destination_token_account` - The user's destination token account
/// * `route_plan` - Array of route plan steps
/// * `remaining_accounts` - Additional accounts required for swaps
/// * `program_id` - The program ID of this program
/// * `in_amount` - The total input amount for the route
/// # Returns
/// * `Result<(u64, Vec<SwapEventData>)>` - The final output amount and swap event data
pub fn execute_route<'info>(
    adapter_registry: &Account<'info, AdapterRegistry>,
    input_token_program: &AccountInfo<'info>,
    vault_authority: &AccountInfo<'info>,
    source_mint: &AccountInfo<'info>,
    user_destination_token_account: &AccountInfo<'info>,
    route_plan: &[RoutePlanStep],
    remaining_accounts: &'info [AccountInfo<'info>],
    program_id: &Pubkey,
    in_amount: u64,
) -> Result<(u64, Vec<SwapEventData>)> {
    let mut current_amount = in_amount;
    let mut total_output_amount: u64 = 0;
    let mut event_data: Vec<SwapEventData> = Vec::new();
    let destination_mint = user_destination_token_account.key();

    // Process each step in the route plan
    for (i, step) in route_plan.iter().enumerate() {
        // Calculate input amount for this step
        let step_amount = if step.percent == 100 {
            current_amount
        } else {
            (current_amount as u128 * step.percent as u128 / 100) as u64
        };

        let input_vault_account = &remaining_accounts[step.input_index as usize];
        let output_account_info = if i == route_plan.len() - 1 {
            user_destination_token_account.clone()
        } else {
            remaining_accounts[step.output_index as usize].clone()
        };

        // Get adapter
        let adapter = get_adapter(&step.swap, adapter_registry)?;
        let adapter_info = adapter_registry
            .supported_adapters
            .iter()
            .find(|a| a.swap_type == step.swap)
            .ok_or(ErrorCode::SwapNotSupported)?;

        // Create adapter context
        let adapter_ctx = AdapterContext {
            token_program: input_token_program.clone(),
            authority: vault_authority.clone(),
            input_account: input_vault_account.clone(),
            output_account: output_account_info.clone(),
            remaining_accounts,
            program_id: *program_id,
        };

        // Execute the swap
        let swap_result = adapter.execute_swap(adapter_ctx, step_amount, step.input_index as usize + 1)?;

        // Determine output mint
        let output_mint = if i != route_plan.len() - 1 {
            let account_data = output_account_info.try_borrow_data()?;
            let output_vault_data = TokenAccount::try_deserialize(&mut account_data.as_ref())?;
            output_vault_data.mint
        } else {
            user_destination_token_account.key()
        };

        // Update amounts: accumulate only if output mint matches destination_mint
        if output_mint == destination_mint {
            total_output_amount = total_output_amount.saturating_add(swap_result.output_amount);
        } else {
            // For non-final steps in multi-hop, update current_amount
            current_amount = swap_result.output_amount;
        }

        // Record swap event
        event_data.push(SwapEventData {
            amm: adapter_info.program_id,
            input_mint: if i == 0 { source_mint.key() } else { event_data[i - 1].output_mint },
            input_amount: step_amount,
            output_mint,
            output_amount: swap_result.output_amount,
        });
    }

    Ok((total_output_amount, event_data))
}