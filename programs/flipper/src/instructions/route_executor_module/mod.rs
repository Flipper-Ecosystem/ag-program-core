use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount};
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
    let mut output_amount = 0;
    let mut event_data = Vec::new();

    // Execute each step in the route plan
    for (i, step) in route_plan.iter().enumerate() {
        let step_amount = (current_amount as u128 * step.percent as u128 / 100) as u64;
        if step_amount == 0 {
            return Err(ErrorCode::InvalidCalculation.into());
        }

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

        output_amount += swap_result.output_amount;
        current_amount = swap_result.output_amount;

        // Collect data for SwapEvent
        let output_mint = if i != route_plan.len() - 1 {
            let output_vault_data = TokenAccount::try_deserialize(&mut output_account_info.data.borrow().as_ref())?;
            output_vault_data.mint
        } else {
            user_destination_token_account.key()
        };

        event_data.push(SwapEventData {
            amm: adapter_info.program_id,
            input_mint: source_mint.key(),
            input_amount: step_amount,
            output_mint,
            output_amount: current_amount,
        });
    }

    Ok((output_amount, event_data))
}