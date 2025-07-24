use anchor_lang::prelude::*;
use crate::adapters::{AdapterContext, dex_adapter::DexAdapter};
use crate::errors::ErrorCode;
use crate::state::SwapResult;

pub struct RaydiumAdapter {
    pub program_id: Pubkey,
    pub pool_addresses: Vec<Pubkey>,
}

impl DexAdapter for RaydiumAdapter {
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        msg!("Executing Raydium swap with amount: {}", amount);
        Ok(SwapResult { output_amount: amount }) // Placeholder
    }

    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 2 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }
        let pool_account = &ctx.remaining_accounts[remaining_accounts_start_index];
        if !self.pool_addresses.contains(&pool_account.key()) {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }
        if pool_account.owner != &self.program_id {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }
        Ok(())
    }

    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()> {
        if *program_id != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }
        Ok(())
    }
}