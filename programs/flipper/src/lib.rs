use anchor_lang::prelude::*;

// Declare modules
pub mod adapters;
pub mod instructions;
pub mod errors;
pub mod state;

// Re-export adapter-related items for direct imports
pub use adapters::{
    AdapterContext,
    get_adapter,
    dex_adapter::DexAdapter,
    raydium::RaydiumAdapter,
    whirlpool::WhirlpoolAdapter,
    SwapResult,
};

// Re-export error-related items for direct imports
pub use errors::ErrorCode;

// Re-export state-related items for direct imports
pub use state::{AdapterInfo, AdapterRegistry, Swap, RoutePlanStep, SwapEvent, FeeEvent};

// Re-export instruction-related items
pub use instructions::{
    adapter_module::*,
    swap_processor::*,
};

use anchor_lang::prelude::*;

declare_id!("5958qddzZjU34CHUD4bisVBiYgDQ6EREwBLgpbVaSLX7");

#[program]
pub mod flipper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
