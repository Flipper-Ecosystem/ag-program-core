use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::adapters::{dex_adapter::DexAdapter, raydium::RaydiumAdapter, whirlpool::WhirlpoolAdapter};
use crate::errors::ErrorCode;
use crate::state::{Swap, AdapterRegistry};

// Declare submodules
pub mod dex_adapter;
pub mod raydium;
pub mod whirlpool;

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