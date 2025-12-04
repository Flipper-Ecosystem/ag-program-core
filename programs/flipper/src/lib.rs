use anchor_lang::prelude::*;

// Declare modules
pub mod adapters;
pub mod instructions;
pub mod errors;
pub mod state;

declare_id!("HcAmx3AgExN7dja5S8NPSqTW6ayaKyVXFJs2cyjsSwb7");

#[program]
pub mod flipper {
    use super::*;
    pub use instructions::{
        adapter_registry_module::*,
        swap_processor_module::*,
        vault_manager_module::*,
        limit_orders_module::*
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


    pub fn create_vault_authority(ctx: Context<CreateVaultAuthority>) -> Result<()> {
        instructions::create_vault_authority(ctx)
    }

    pub fn create_vault(ctx: Context<CreateVault>) -> Result<()> {
        instructions::create_vault(ctx)
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        instructions::close_vault(ctx)
    }

    pub fn initialize_vaults(ctx: Context<InitializeVaults>) -> Result<()> {
        instructions::initialize_vaults(ctx)
    }

    pub fn change_vault_authority_admin(ctx: Context<ChangeVaultAuthorityAdmin>) -> Result<()> {
        instructions::change_vault_authority_admin(ctx)
    }

    pub fn withdraw_platform_fees(ctx: Context<WithdrawPlatformFees>, amount: u64) -> Result<()> {
        instructions::withdraw_platform_fees(ctx, amount)
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

    // Limit Orders functions

    /// Creates a new limit order
    pub fn create_limit_order(
        ctx: Context<CreateLimitOrder>,
        nonce: u64,
        input_amount: u64,
        min_output_amount: u64,
        trigger_price_bps: u32,
        trigger_type: TriggerType,
        expiry: i64,
        slippage_bps: u16
    ) -> Result<()> {
        instructions::create_limit_order(
            ctx,
            nonce,
            input_amount,
            min_output_amount,
            trigger_price_bps,
            trigger_type,
            expiry,
            slippage_bps
        )
    }

    /// Executes a limit order when trigger conditions are met
    pub fn execute_limit_order<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteLimitOrder<'info>>,
        route_plan: Vec<RoutePlanStep>,
        quoted_out_amount: u64,
        platform_fee_bps: u8,
    ) -> Result<u64> {
        instructions::execute_limit_order(
            ctx,
            route_plan,
            quoted_out_amount,
            platform_fee_bps,
        )
    }

    /// Cancels an open limit order
    pub fn cancel_limit_order(
        ctx: Context<CancelLimitOrder>,
    ) -> Result<()> {
        instructions::cancel_limit_order(ctx)
    }

    /// Closes a filled or cancelled limit order by operator and collects rent
    pub fn close_limit_order_by_operator(
        ctx: Context<CloseLimitOrderByOperator>,
    ) -> Result<()> {
        instructions::close_limit_order_by_operator(ctx)
    }

    pub fn route_and_create_order<'info>(
        ctx: Context<'_, '_, 'info, 'info, RouteAndCreateOrder<'info>>,
        order_nonce: u64,
        route_plan: Vec<crate::state::RoutePlanStep>,
        in_amount: u64,
        quoted_out_amount: u64,
        slippage_bps: u16,
        platform_fee_bps: u8,
        order_min_output_amount: u64,
        order_trigger_price_bps: u32,
        order_trigger_type: TriggerType,
        order_expiry: i64,
        order_slippage_bps: u16,
    ) -> Result<(u64, Pubkey)> {
        instructions::route_and_create_order(
            ctx,
            order_nonce,
            route_plan,
            in_amount,
            quoted_out_amount,
            slippage_bps,
            platform_fee_bps,
            order_min_output_amount,
            order_trigger_price_bps,
            order_trigger_type,
            order_expiry,
            order_slippage_bps
        )
    }
}