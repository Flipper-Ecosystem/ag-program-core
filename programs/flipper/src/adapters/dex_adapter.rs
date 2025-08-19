use anchor_lang::prelude::*;
use crate::adapters::adapter_connector_module::AdapterContext;
use crate::state::SwapResult;

// Trait defining the interface for decentralized exchange (DEX) adapters
// Provides methods for executing and validating swaps
pub trait DexAdapter {
    // Executes a swap operation using the provided context and amount
    // # Arguments
    // * `ctx` - Context containing account references for the swap
    // * `amount` - Input token amount to swap
    // * `remaining_accounts_start_index` - Index for accessing remaining accounts
    // # Returns
    // * `Result<SwapResult>` - Result containing the output amount
    fn execute_swap<'info>(
        &self,
        ctx: AdapterContext<'info>,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult>;

    // Validates the accounts provided for the swap
    // # Arguments
    // * `ctx` - Context containing account references to validate
    // * `remaining_accounts_start_index` - Index for accessing remaining accounts
    // # Returns
    // * `Result<()>` - Ok if accounts are valid, error otherwise
    fn validate_accounts<'info>(
        &self,
        ctx: AdapterContext<'info>,
        remaining_accounts_start_index: usize,
    ) -> Result<()>;

    // Validates the CPI (cross-program invocation) program ID
    // # Arguments
    // * `program_id` - Program ID to validate against
    // # Returns
    // * `Result<()>` - Ok if valid, error if mismatched
    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()>;
}