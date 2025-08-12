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
    pub use instructions::{
        adapter_module::*,
        swap_processor_module::*,
        vault_manager_module::*
    };
    pub use errors::ErrorCode;
    pub use state::{
        AdapterInfo,
        AdapterRegistry,
        Swap,
        RoutePlanStep,
        SwapEvent,
        FeeEvent,
        PoolInfo,
    };

    pub fn initialize_adapter_registry(ctx: Context<InitializeAdapterRegistry>, adapters: Vec<AdapterInfo>, operators: Vec<Pubkey>) -> Result<()> {
        instructions::initialize_adapter_registry(ctx, adapters, operators)
    }

    pub fn initialize_pool_info(ctx: Context<InitializePoolInfo>, swap_type: Swap, pool_address: Pubkey) -> Result<()> {
        instructions::initialize_pool_info(ctx, swap_type, pool_address)
    }

    pub fn configure_adapter(ctx: Context<ConfigureAdapter>, adapter: AdapterInfo) -> Result<()> {
        instructions::configure_adapter(ctx, adapter)
    }

    pub fn add_operator(ctx: Context<AddOperator>, operator: Pubkey) -> Result<()> {
        instructions::add_operator(ctx, operator)
    }

    pub fn remove_operator(ctx: Context<RemoveOperator>, operator: Pubkey) -> Result<()> {
        instructions::remove_operator(ctx, operator)
    }

    pub fn disable_adapter(ctx: Context<DisableAdapter>, swap_type: Swap) -> Result<()> {
        instructions::disable_adapter(ctx, swap_type)
    }

    pub fn disable_pool(ctx: Context<DisablePool>, swap_type: Swap, pool_address: Pubkey) -> Result<()> {
        instructions::disable_pool(ctx, swap_type, pool_address)
    }

    pub fn change_authority(ctx: Context<ChangeAuthority>) -> Result<()> {
        instructions::change_authority(ctx)
    }

    pub fn reset_adapter_registry(ctx: Context<ResetAdapterRegistry>, adapters: Vec<AdapterInfo>, operators: Vec<Pubkey>) -> Result<()> {
        instructions::reset_adapter_registry(ctx, adapters, operators)
    }


    pub fn initialize_vaults(ctx: Context<InitializeVaults>) -> Result<()> {
        instructions::initialize_vaults(ctx)
    }

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