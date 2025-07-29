use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

// Stores the adapter registry state, including authority and supported adapters
#[account]
pub struct AdapterRegistry {
    pub authority: Pubkey,            // Account authorized to manage the registry
    pub supported_adapters: Vec<AdapterInfo>, // List of supported DEX adapters
}

// Stores information about a single adapter
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AdapterInfo {
    pub name: String,                // Name of the adapter (e.g., "Raydium")
    pub program_id: Pubkey,          // Program ID of the DEX protocol
    pub swap_type: Swap,             // Type of swap (e.g., Raydium, Whirlpool)
    pub pool_addresses: Vec<Pubkey>, // Valid pool addresses for the adapter
}

// Implementation of methods for AdapterRegistry
impl AdapterRegistry {
    // Checks if a swap type is supported by the registry
    // # Arguments
    // * `swap` - The swap type to check
    // # Returns
    // * `bool` - True if the swap type is supported, false otherwise
    pub fn is_supported_adapter(&self, swap: &Swap) -> bool {
        self.supported_adapters.iter().any(|adapter| adapter.swap_type == *swap)
    }

    // Retrieves the program ID for a given swap type
    // # Arguments
    // * `swap` - The swap type to query
    // # Returns
    // * `Result<Pubkey>` - Program ID of the adapter, or error if not supported
    pub fn get_adapter_program_id(&self, swap: &Swap) -> Result<Pubkey> {
        self.supported_adapters
            .iter()
            .find(|adapter| adapter.swap_type == *swap)
            .map(|adapter| adapter.program_id)
            .ok_or(error!(ErrorCode::SwapNotSupported))
    }
}

// Event emitted when an adapter is configured in the registry
#[event]
pub struct AdapterConfigured {
    pub program_id: Pubkey, // Program ID of the configured adapter
    pub swap_type: Swap,    // Type of swap for the configured adapter
}

/// Event emitted when an adapter is disabled in the registry.
#[event]
pub struct AdapterDisabled {
    pub swap_type: Swap, // Type of swap for the disabled adapter
}

/// Event emitted when a pool is disabled in an adapter.
#[event]
pub struct PoolDisabled {
    pub swap_type: Swap,    // Type of swap for the adapter
    pub pool_address: Pubkey, // Pool address that was disabled
}

/// Event emitted when a new pool address is added to an adapter.
#[event]
pub struct PoolAdded {
    pub swap_type: Swap,    // Type of swap for the adapter
    pub pool_address: Pubkey, // Pool address that was added
}

/// Event emitted when the authority of the registry is changed.
#[event]
pub struct AuthorityChanged {
    pub old_authority: Pubkey, // Previous authority
    pub new_authority: Pubkey, // New authority
}

// Event emitted when a platform fee is applied
#[event]
pub struct FeeEvent {
    pub account: Pubkey, // Account receiving the fee
    pub mint: Pubkey,   // Token mint for the fee
    pub amount: u64,    // Amount of the fee
}

// Event emitted when a swap is executed
#[event]
pub struct SwapEvent {
    pub amm: Pubkey,         // Program ID of the AMM (Automated Market Maker)
    pub input_mint: Pubkey,  // Mint of the input token
    pub input_amount: u64,   // Amount of input tokens
    pub output_mint: Pubkey, // Mint of the output token
    pub output_amount: u64,  // Amount of output tokens
}

// Defines supported swap types for various DEX protocols
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Swap {
    Saber,
    SaberAddDecimalsDeposit,
    SaberAddDecimalsWithdraw,
    TokenSwap,
    Sencha,
    Step,
    Cropper,
    Raydium,
    Crema { a_to_b: bool }, // Swap direction for Crema
    Lifinity,
    Mercurial,
    Cykura,
    Serum { side: Side }, // Bid or Ask side for Serum
    MarinadeDeposit,
    MarinadeUnstake,
    Aldrin { side: Side }, // Bid or Ask side for Aldrin
    AldrinV2 { side: Side }, // Bid or Ask side for AldrinV2
    Whirlpool { a_to_b: bool }, // Swap direction for Whirlpool
    Invariant { x_to_y: bool }, // Swap direction for Invariant
    Meteora,
    GooseFX,
    DeltaFi { stable: bool }, // Stable or volatile pool for DeltaFi
    Balansol,
    MarcoPolo { x_to_y: bool }, // Swap direction for MarcoPolo
    Dradex { side: Side }, // Bid or Ask side for Dradex
    LifinityV2,
    RaydiumClmm,
    Openbook { side: Side }, // Bid or Ask side for Openbook
    Phoenix { side: Side }, // Bid or Ask side for Phoenix
    Symmetry { from_token_id: u64, to_token_id: u64 }, // Token IDs for Symmetry
}

// Defines the side of an order for DEXs like Serum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Side {
    Bid,  // Buying the base currency
    Ask,  // Selling the base currency
}

// Defines a single step in a swap route
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RoutePlanStep {
    pub swap: Swap,        // Type of swap for this step
    pub percent: u8,       // Percentage of input amount to use (0-100)
    pub input_index: u8,   // Index of input token account in remaining accounts
    pub output_index: u8,  // Index of output token account in remaining accounts
}

// Result struct for swap operations (redefined here, also in adapters/mod.rs)
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapResult {
    pub output_amount: u64, // Output amount from the swap
}