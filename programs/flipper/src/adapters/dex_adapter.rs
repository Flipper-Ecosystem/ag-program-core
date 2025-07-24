use anchor_lang::prelude::*;
use crate::adapters::AdapterContext;
use crate::state::SwapResult;

pub trait DexAdapter {
    fn execute_swap<'info>(
        &self,
        ctx: AdapterContext<'info>,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult>;
    fn validate_accounts<'info>(
        &self,
        ctx: AdapterContext<'info>,
        remaining_accounts_start_index: usize,
    ) -> Result<()>;
    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()>;
}