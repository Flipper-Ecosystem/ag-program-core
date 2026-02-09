use anchor_lang::prelude::*;

pub mod adapter_registry_module;
pub mod swap_processor_module;
pub mod vault_manager_module;

pub mod route_validator_module;

pub mod route_executor_module;
pub mod limit_orders_module;

// New shared modules for Jupiter CPI integration
pub mod shared_route_module;
pub mod shared_limit_orders_module;

pub use adapter_registry_module::*;
pub use swap_processor_module::*;
pub use vault_manager_module::*;
pub use route_validator_module::*;
pub use route_executor_module::*;
pub use limit_orders_module::*;

// Export new shared modules
pub use shared_route_module::*;
pub use shared_limit_orders_module::*;