use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::adapters::{dex_adapter::DexAdapter, raydium::RaydiumAdapter, whirlpool::WhirlpoolAdapter};
use crate::errors::ErrorCode;
use crate::state::{Swap, AdapterRegistry};

// Declare submodules for adapter implementations and trait
pub mod dex_adapter;
pub mod raydium;
pub mod whirlpool;

// Result struct for swap operations, holding the output amount
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapResult {
    pub output_amount: u64,
}

// Context struct for passing account information to adapters
// Holds references to token program, authority, input/output accounts, and remaining accounts
#[derive(Clone)]
pub struct AdapterContext<'info> {
    pub token_program: AccountInfo<'info>, // Token program for CPI calls
    pub authority: AccountInfo<'info>,     // Authority for token transfers
    pub input_account: AccountInfo<'info>, // Input token account
    pub output_account: AccountInfo<'info>, // Output token account
    pub remaining_accounts: &'info [AccountInfo<'info>], // Additional accounts for adapter-specific logic
}

// Retrieves the appropriate adapter implementation based on the swap type
// # Arguments
// * `swap` - The swap type (e.g., Raydium, Whirlpool)
// * `registry` - The adapter registry account containing supported adapters
// # Returns
// * `Result<Box<dyn DexAdapter>>` - A boxed adapter implementing the DexAdapter trait
pub fn get_adapter(swap: &Swap, registry: &Account<AdapterRegistry>) -> Result<Box<dyn DexAdapter>> {
    match swap {
        Swap::Raydium => {
            // Initialize Raydium adapter with program ID and pool addresses
            let adapter = RaydiumAdapter {
                program_id: registry.get_adapter_program_id(swap)?,
                pool_addresses: registry
                    .supported_adapters
                    .iter()
                    .find(|a| a.swap_type == *swap)
                    .map(|a| a.pool_addresses.clone())
                    .unwrap_or_default(),
            };
            // Validate CPI interface for security
            adapter.validate_cpi(&adapter.program_id)?;
            Ok(Box::new(adapter))
        }
        Swap::Whirlpool { a_to_b } => {
            // Initialize Whirlpool adapter with program ID, direction, and pool addresses
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
            // Validate CPI interface for security
            adapter.validate_cpi(&adapter.program_id)?;
            Ok(Box::new(adapter))
        }
        _ => Err(ErrorCode::SwapNotSupported.into()), // Return error for unsupported swap types
    }
}