use anchor_lang::prelude::*;
use crate::adapters::{dex_adapter::DexAdapter, raydium::RaydiumAdapter, whirlpool::WhirlpoolAdapter, meteora::MeteoraAdapter};
use crate::errors::ErrorCode;
use crate::state::{Swap, AdapterRegistry};

// Context struct for passing account information to adapters
#[derive(Clone)]
pub struct AdapterContext<'info> {
    pub token_program: AccountInfo<'info>, // Token program for CPI calls
    pub authority: AccountInfo<'info>,     // Authority for token transfers
    pub input_account: AccountInfo<'info>, // Input token account
    pub output_account: AccountInfo<'info>, // Output token account
    pub remaining_accounts: &'info [AccountInfo<'info>], // Additional accounts for adapter-specific logic
    pub program_id: Pubkey //for PDA calculation
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
            // Initialize Raydium adapter with program ID
            let adapter = RaydiumAdapter {
                program_id: registry.get_adapter_program_id(swap)?,
            };
            // Validate CPI interface for security
            adapter.validate_cpi(&adapter.program_id)?;
            Ok(Box::new(adapter))
        }
        Swap::Whirlpool { a_to_b } => {
            // Initialize Whirlpool adapter with program ID and direction
            let adapter = WhirlpoolAdapter {
                program_id: registry.get_adapter_program_id(swap)?,
                a_to_b: *a_to_b,
            };
            // Validate CPI interface for security
            adapter.validate_cpi(&adapter.program_id)?;
            Ok(Box::new(adapter))
        }
        Swap::Meteora => {
            msg!("Matched Meteora variant!");
            msg!("Calling get_adapter_program_id...");
            let program_id = registry.get_adapter_program_id(swap)?;
            msg!("Got program_id: {}", program_id);
            let adapter = MeteoraAdapter {
                program_id,
            };
            adapter.validate_cpi(&adapter.program_id)?;
            Ok(Box::new(adapter))
        }
        _ => Err(ErrorCode::SwapNotSupported.into()), // Return error for unsupported swap types
    }
}