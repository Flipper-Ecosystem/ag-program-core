use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::state::{Swap, AdapterRegistry};
use crate::errors::ErrorCode;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapResult {
    pub output_amount: u64,
}

#[derive(Clone)]
pub struct AdapterContext<'info> {
    pub token_program: AccountInfo<'info>,
    pub authority: AccountInfo<'info>,
    pub input_account: AccountInfo<'info>,
    pub output_account: AccountInfo<'info>,
    pub remaining_accounts: &'info [AccountInfo<'info>],
}

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

pub fn get_adapter(swap: &Swap, registry: &Account<AdapterRegistry>) -> Result<Box<dyn DexAdapter>> {
    match swap {
        Swap::Raydium => {
            let adapter = RaydiumAdapter {
                program_id: registry.get_adapter_program_id(swap)?,
                pool_addresses: registry
                    .supported_adapters
                    .iter()
                    .find(|a| a.swap_type == *swap)
                    .map(|a| a.pool_addresses.clone())
                    .unwrap_or_default(),
            };
            adapter.validate_cpi(&adapter.program_id)?;
            Ok(Box::new(adapter))
        }
        Swap::Whirlpool { a_to_b } => {
            let adapter = WhirlpoolAdapter {
                program_id: registry.get_adapter_program_id(swap)?,
                a_to_b: *a_to_b,
                pool_addresses: registry
                    .supported_adapters
                    .iter()
                    .find(|a| a.swap_type == *swap)
                    .map(|a| a.pool_addresses.clone())
                    .unwrap_or_default(),
            };
            adapter.validate_cpi(&adapter.program_id)?;
            Ok(Box::new(adapter))
        }
        _ => Err(ErrorCode::SwapNotSupported.into()),
    }
}

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

pub struct WhirlpoolAdapter {
    pub program_id: Pubkey,
    pub a_to_b: bool,
    pub pool_addresses: Vec<Pubkey>,
}

impl DexAdapter for WhirlpoolAdapter {
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        msg!("Executing Whirlpool swap, a_to_b: {}, amount: {}", self.a_to_b, amount);
        Ok(SwapResult { output_amount: amount }) // Placeholder
    }

    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 3 {
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