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
        swap_processor_module::*,  // Swap execution instructions
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

    // Initializes the adapter registry with a list of supported adapters.
    //
    // This function creates a new adapter registry account, sets its supported adapters,
    // and assigns the provided authority. It is typically called once to set up the registry.
    //
    // # Arguments
    // * `ctx` - Context containing the adapter registry account, payer, authority, and system program.
    // * `adapters` - Vector of adapter information to initialize the registry with.
    //
    // # Returns
    // * `Result<()>` - Returns Ok(()) on success, or an error if initialization fails.
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

    // Adds an operator to the adapter registry.
    //
    // This function adds a new operator to the registry's operators list.
    // Only the authority can call this instruction.
    //
    // # Arguments
    // * `ctx` - Context containing the adapter registry account, authority, and new operator.
    // * `operator` - The public key of the operator to add.
    //
    // # Returns
    // * `Result<()>` - Returns Ok(()) on success, or an error if the authority is invalid or operator already exists.
    pub fn add_operator(ctx: Context<AddOperator>, operator: Pubkey) -> Result<()> {
        instructions::add_operator(ctx, operator)
    }

    // Removes an operator from the adapter registry.
    //
    // This function removes an operator from the registry's operators list.
    // Only the authority can call this instruction.
    //
    // # Arguments
    // * `ctx` - Context containing the adapter registry account, authority, and operator to remove.
    // * `operator` - The public key of the operator to remove.
    //
    // # Returns
    // * `Result<()>` - Returns Ok(()) on success, or an error if the authority is invalid or operator not found.
    pub fn remove_operator(ctx: Context<RemoveOperator>, operator: Pubkey) -> Result<()> {
        instructions::remove_operator(ctx, operator)
    }

    // Disables an adapter in the registry by removing it.
    //
    // This function removes an adapter with the specified swap type from the registry.
    // It emits an event to log the adapter disablement. Only operators or authority can call this.
    //
    // # Arguments
    // * `ctx` - Context containing the adapter registry account and operator/authority.
    // * `swap_type` - The swap type of the adapter to disable.
    //
    // # Returns
    // * `Result<()>` - Returns Ok(()) on success, or an error if the adapter is not found or caller is not authorized.
    pub fn disable_adapter(ctx: Context<DisableAdapter>, swap_type: Swap) -> Result<()> {
        instructions::disable_adapter(ctx, swap_type)
    }

    // Disables a specific pool address for an adapter in the registry.
    //
    // This function removes a pool address from the specified adapter's pool_addresses list.
    // It emits an event to log the pool disablement. Only operators or authority can call this.
    //
    // # Arguments
    // * `ctx` - Context containing the adapter registry account and operator/authority.
    // * `swap_type` - The swap type of the adapter.
    // * `pool_address` - The pool address to disable.
    //
    // # Returns
    // * `Result<()>` - Returns Ok(()) on success, or an error if the adapter or pool is not found or caller is not authorized.
    pub fn disable_pool(ctx: Context<DisablePool>, swap_type: Swap, pool_address: Pubkey) -> Result<()> {
        instructions::disable_pool(ctx, swap_type, pool_address)
    }

    // Adds a new pool address to an existing adapter in the registry.
    //
    // This function adds a new pool address to the specified adapter's pool_addresses list.
    // It emits an event to log the addition of the new pool address. Only operators or authority can call this.
    //
    // # Arguments
    // * `ctx` - Context containing the adapter registry account and operator/authority.
    // * `swap_type` - The swap type of the adapter.
    // * `pool_address` - The new pool address to add.
    //
    // # Returns
    // * `Result<()>` - Returns Ok(()) on success, or an error if the adapter is not found or caller is not authorized.
    pub fn add_pool_address(ctx: Context<AddPoolAddress>, swap_type: Swap, pool_address: Pubkey) -> Result<()> {
        instructions::add_pool_address(ctx, swap_type, pool_address)
    }

    // Changes the authority of the adapter registry.
    //
    // This function updates the authority of the adapter registry to a new authority.
    // It emits an event to log the authority change. Only the current authority can call this.
    //
    // # Arguments
    // * `ctx` - Context containing the adapter registry account, current authority, and new authority.
    //
    // # Returns
    //* `Result<()>` - Returns Ok(()) on success, or an error if the current authority is invalid.
    pub fn change_authority(ctx: Context<ChangeAuthority>) -> Result<()> {
        instructions::change_authority(ctx)
    }


    // Resets the adapter registry with new adapters and operators.
    //
    // This function overwrites the existing supported adapters and operators lists.
    // Only the authority can call this instruction.
    //
    // # Arguments
    // * `ctx` - Context containing the adapter registry account and authority.
    // * `adapters` - New vector of adapter information.
    // * `operators` - New vector of operator public keys.
    //
    // # Returns
    // * `Result<()>` - Returns Ok(()) on success, or an error if the authority is invalid.
    pub fn reset_adapter_registry(ctx: Context<ResetAdapterRegistry>, adapters: Vec<AdapterInfo>, operators: Vec<Pubkey>) -> Result<()> {
        instructions::reset_adapter_registry(ctx, adapters,  operators)
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
