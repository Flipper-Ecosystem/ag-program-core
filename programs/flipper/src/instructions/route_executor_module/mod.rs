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

/// Calculate the remaining accounts range for a specific step
fn calculate_adapter_accounts_range(
    step: &RoutePlanStep,
    route_plan: &[RoutePlanStep],
    step_index: usize
) -> (usize, usize) {
    let start_index = step.input_index as usize + 1; // Skip input vault itself

    let end_index = if step_index == route_plan.len() - 1 {
        // For last step: use output_index (excluding user destination account)
        step.output_index as usize
    } else {
        // For intermediate steps: use output_index + 1 (including output vault)
        step.output_index as usize + 1
    };

    let count = end_index.saturating_sub(start_index);
    (start_index, count)
}

/// Executes a route plan, handling partial swaps, multi-hop swaps, and partial multi-hop swaps
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

        // Calculate correct start index and count for adapter
        let (adapter_start_index, adapter_accounts_count) = calculate_adapter_accounts_range(step, route_plan, i);

        // Execute the swap with correct range
        let swap_result = adapter.execute_swap(adapter_ctx, step_amount, adapter_start_index, adapter_accounts_count)?;

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