use anchor_lang::prelude::*;
use crate::adapters::{AdapterContext, dex_adapter::DexAdapter};
use crate::errors::ErrorCode;
use crate::state::{SwapResult, PoolInfo};

// Adapter for interacting with the Raydium DEX protocol
pub struct RaydiumAdapter {
    pub program_id: Pubkey, // Program ID of the Raydium protocol
}

// Implementation of the DexAdapter trait for Raydium
impl DexAdapter for RaydiumAdapter {
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        msg!("Executing Raydium swap with amount: {}", amount);

        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 2 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let pool_info_account = &ctx.remaining_accounts[remaining_accounts_start_index];
        let pool_info = Account::<PoolInfo>::try_from(pool_info_account)?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let pool_account = &ctx.remaining_accounts[remaining_accounts_start_index + 1];
        if pool_info.pool_address != pool_account.key() {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        Ok(SwapResult { output_amount: amount })
    }

    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 2 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let pool_info_account = &ctx.remaining_accounts[remaining_accounts_start_index];
        let pool_info = Account::<PoolInfo>::try_from(pool_info_account)?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let pool_account = &ctx.remaining_accounts[remaining_accounts_start_index + 1];
        if pool_info.pool_address != pool_account.key() {
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