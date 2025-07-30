use anchor_lang::prelude::*;

// Declare modules
pub mod adapters;
pub mod instructions;
pub mod errors;
pub mod state;

declare_id!("5958qddzZjU34CHUD4bisVBiYgDQ6EREwBLgpbVaSLX7");

#[program]
pub mod flipper {
    use super::*;
    // Re-export instruction-related items for convenient imports
    pub use instructions::{
        adapter_module::*,  // Adapter registry management instructions
        swap_processor::*,  // Swap execution instructions
    };


    // Re-export error-related items for direct imports
    pub use errors::ErrorCode;

    // Re-export state-related items for convenient imports
    pub use state::{
        AdapterInfo,        // Struct for adapter metadata
        AdapterRegistry,    // Account storing supported adapters
        Swap,               // Enum for swap types
        RoutePlanStep,      // Struct for defining swap route steps
        SwapEvent,          // Event emitted on swap execution
        FeeEvent,           // Event emitted for platform fees
    };

    /// Initializes the adapter registry with a list of supported adapters.
    ///
    /// This function creates a new adapter registry account, sets its supported adapters,
    /// and assigns the provided authority. It is typically called once to set up the registry.
    ///
    /// # Arguments
    /// * `ctx` - Context containing the adapter registry account, payer, authority, and system program.
    /// * `adapters` - Vector of adapter information to initialize the registry with.
    ///
    /// # Returns
    /// * `Result<()>` - Returns Ok(()) on success, or an error if initialization fails.
    pub fn initialize_adapter_registry(ctx: Context<InitializeAdapterRegistry>, adapters: Vec<AdapterInfo>, operators: Vec<Pubkey>) -> Result<()> {
        instructions::initialize_adapter_registry(ctx, adapters, operators)
    }

    // Configures an adapter in the registry by adding or updating it
    // # Arguments
    // * `ctx` - Context containing the adapter registry and authority accounts
    // * `adapter` - Adapter information to add or update
    // # Returns
    // * `Result<()>` - Ok on success, error if authority is invalid
    pub fn configure_adapter(ctx: Context<ConfigureAdapter>, adapter: AdapterInfo) -> Result<()> {
        instructions::configure_adapter(ctx, adapter)
    }


    // Executes a token swap through a series of routing steps
    // # Arguments
    // * `ctx` - Context containing accounts for the swap
    // * `route_plan` - Vector of steps defining the swap route
    // * `in_amount` - Input token amount to swap
    // * `quoted_out_amount` - Expected output amount for slippage checking
    // * `slippage_bps` - Maximum slippage in basis points (max 10,000)
    // * `platform_fee_bps` - Platform fee in basis points
    // # Returns
    // * `Result<u64>` - Final output amount on success, error otherwise
    pub fn route<'info>(
        ctx: Context<'_, '_, 'info, 'info, Route<'info>>,
        route_plan: Vec<RoutePlanStep>,
        in_amount: u64,
        quoted_out_amount: u64,
        slippage_bps: u16,
        platform_fee_bps: u8,
    ) -> Result<u64> {
        instructions::route(ctx, route_plan, in_amount, quoted_out_amount, slippage_bps, platform_fee_bps)
    }
}
