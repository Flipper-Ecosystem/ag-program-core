use anchor_lang::prelude::*;
use crate::adapters::{AdapterContext, dex_adapter::DexAdapter};
use crate::errors::ErrorCode;
use crate::state::SwapResult;

// Adapter for interacting with the Whirlpool DEX protocol
pub struct WhirlpoolAdapter {
    pub program_id: Pubkey,       // Program ID of the Whirlpool protocol
    pub a_to_b: bool,             // Swap direction (true for A-to-B, false for B-to-A)
    pub pool_addresses: Vec<Pubkey>, // Supported pool addresses for Whirlpool swaps
}

// Implementation of the DexAdapter trait for Whirlpool
impl DexAdapter for WhirlpoolAdapter {
    // Executes a swap on the Whirlpool protocol
    // # Arguments
    // * `ctx` - Context with account references for the swap
    // * `amount` - Input token amount to swap
    // * `remaining_accounts_start_index` - Index for accessing remaining accounts
    // # Returns
    // * `Result<SwapResult>` - Result with the output amount (placeholder implementation)
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        // Log swap execution and direction for debugging
        msg!("Executing Whirlpool swap, a_to_b: {}, amount: {}", self.a_to_b, amount);
        // Placeholder: returns input amount as output (to be replaced with actual CPI logic)
        Ok(SwapResult { output_amount: amount })
    }

    // Validates accounts for a Whirlpool swap
    // # Arguments
    // * `ctx` - Context with account references to validate
    // * `remaining_accounts_start_index` - Index for accessing remaining accounts
    // # Returns
    // * `Result<()>` - Ok if accounts are valid, error if insufficient or incorrect
    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        // Check if enough remaining accounts are provided (Whirlpool requires more accounts)
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 3 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }
        // Validate pool account address and ownership
        let pool_account = &ctx.remaining_accounts[remaining_accounts_start_index];
        if !self.pool_addresses.contains(&pool_account.key()) {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }
        if pool_account.owner != &self.program_id {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }
        Ok(())
    }

    // Validates the CPI program ID for Whirlpool
    // # Arguments
    // * `program_id` - Program ID to validate against
    // # Returns
    // * `Result<()>` - Ok if valid, error if mismatched
    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()> {
        // Ensure the provided program ID matches the adapter's program ID
        if *program_id != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }
        Ok(())
    }
}