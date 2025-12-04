use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

// Stores the adapter registry state, including authority and supported adapters
#[account]
pub struct AdapterRegistry {
    pub authority: Pubkey,            // Account authorized to manage the registry
    pub operators: Vec<Pubkey>,      // List of operator public keys authorized to manage adapters and pools
    pub supported_adapters: Vec<AdapterInfo>, // List of supported DEX adapters
}

// Stores information about a single pool
#[account]
pub struct PoolInfo {
    pub adapter_swap_type: Swap, // The swap type of the adapter this pool belongs to
    pub pool_address: Pubkey,   // The pool's public key
    pub enabled: bool,          // Whether the pool is enabled or disabled
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

    // Checks if a public key is an authorized operator
    // # Arguments
    // * `key` - The public key to check
    // # Returns
    // * `bool` - True if the key is an operator or the authority, false otherwise
    pub fn is_authorized_operator(&self, key: &Pubkey) -> bool {
        self.authority == *key || self.operators.contains(key)
    }
}

// Stores information about a single adapter
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AdapterInfo {
    pub name: String,                // Name of the adapter (e.g., "Raydium")
    pub program_id: Pubkey,          // Program ID of the DEX protocol
    pub swap_type: Swap,             // Type of swap (e.g., Raydium, Whirlpool)
}

// Event emitted when an adapter is configured in the registry
#[event]
pub struct AdapterConfigured {
    pub program_id: Pubkey, // Program ID of the configured adapter
    pub swap_type: Swap,    // Type of swap for the configured adapter
}

// Event emitted when an adapter is disabled in the registry
#[event]
pub struct AdapterDisabled {
    pub swap_type: Swap, // Type of swap for the disabled adapter
}

// Event emitted when a pool is disabled in an adapter
#[event]
pub struct PoolDisabled {
    pub swap_type: Swap,    // Type of swap for the adapter
    pub pool_address: Pubkey, // Pool address that was disabled
}

// Event emitted when a new pool is initialized
#[event]
pub struct PoolInitialized {
    pub swap_type: Swap,    // Type of swap for the adapter
    pub pool_address: Pubkey, // Pool address that was initialized
}

// Event emitted when the authority of the registry is changed
#[event]
pub struct AuthorityChanged {
    pub old_authority: Pubkey, // Previous authority
    pub new_authority: Pubkey, // New authority
}

// Event emitted when an operator is added to the registry
#[event]
pub struct OperatorAdded {
    pub operator: Pubkey, // Public key of the added operator
}

// Event emitted when an operator is removed from the registry
#[event]
pub struct OperatorRemoved {
    pub operator: Pubkey, // Public key of the removed operator
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

// Global event emitted when a router swap is completed
#[event]
pub struct RouterSwapEvent {
    pub sender: Pubkey,              // User who initiated the swap
    pub recipient: Pubkey,           // User who receives the output tokens
    pub input_mint: Pubkey,          // Input token mint
    pub output_mint: Pubkey,         // Output token mint
    pub input_amount: u64,           // Initial input amount
    pub output_amount: u64,          // Final output amount (after fees)
    pub fee_amount: u64,             // Platform fee amount (0 if no fee)
    pub fee_account: Option<Pubkey>,  // Platform fee account (None if no fee)
    pub slippage_bps: u16,           // Slippage tolerance in basis points
}

#[event]
pub struct RegistryReset {
    pub authority: Pubkey,
}


use anchor_lang::prelude::*;


/// Event emitted when a limit order is executed
#[event]
pub struct LimitOrderCreated {
    pub order: Pubkey,
    pub creator: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_amount: u64,
    pub min_output_amount: u64,
    pub trigger_price_bps: u32,
    pub trigger_type: u8,
    pub expiry: i64,
}

#[event]
pub struct LimitOrderExecuted {
    pub order: Pubkey,
    pub executor: Pubkey,
    pub input_amount: u64,
    pub output_amount: u64,
    pub fee_amount: u64,
    pub trigger_type: u8,
    pub min_output_amount: u64,
}

// Global event emitted when a limit order swap is executed
#[event]
pub struct LimitOrderSwapEvent {
    pub order: Pubkey,                // Limit order account
    pub sender: Pubkey,                // Order creator
    pub recipient: Pubkey,             // User destination account
    pub executor: Pubkey,               // Operator who executed the order
    pub input_mint: Pubkey,            // Input token mint
    pub output_mint: Pubkey,           // Output token mint
    pub input_amount: u64,              // Input amount swapped
    pub output_amount: u64,             // Final output amount (after fees)
    pub fee_amount: u64,                // Platform fee amount (0 if no fee)
    pub fee_account: Option<Pubkey>,    // Platform fee account (None if no fee)
    pub trigger_type: u8,               // Trigger type (TakeProfit/StopLoss)
}

#[event]
pub struct LimitOrderCancelled {
    pub order: Pubkey,
    pub creator: Pubkey,
}

#[event]
pub struct LimitOrderClosed {
    pub order: Pubkey,
    pub closer: Pubkey,
    pub status: u8,
}

#[event]
pub struct RouteAndCreateOrderEvent {
    pub order: Pubkey,
    pub swap_input_mint: Pubkey,
    pub swap_input_amount: u64,
    pub swap_output_amount: u64,
    pub fee_amount: u64,
    pub order_input_amount: u64,
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
    Crema { a_to_b: bool },
    Lifinity,
    Mercurial,
    Cykura,
    Serum { side: Side },
    MarinadeDeposit,
    MarinadeUnstake,
    Aldrin { side: Side },
    AldrinV2 { side: Side },
    Whirlpool { a_to_b: bool },
    Invariant { x_to_y: bool },
    Meteora,
    GooseFX,
    DeltaFi { stable: bool },
    Balansol,
    MarcoPolo { x_to_y: bool },
    Dradex { side: Side },
    LifinityV2,
    RaydiumClmm,
    Openbook { side: Side },
    Phoenix { side: Side },
    Symmetry { from_token_id: u64, to_token_id: u64 },
}

impl Swap {
    // Converts the Swap enum to a fixed-size byte array for PDA seed generation
    pub fn to_bytes(&self) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        match self {
            Swap::Saber => bytes[0] = 0,
            Swap::SaberAddDecimalsDeposit => bytes[0] = 1,
            Swap::SaberAddDecimalsWithdraw => bytes[0] = 2,
            Swap::TokenSwap => bytes[0] = 3,
            Swap::Sencha => bytes[0] = 4,
            Swap::Step => bytes[0] = 5,
            Swap::Cropper => bytes[0] = 6,
            Swap::Raydium => bytes[0] = 7,
            Swap::Crema { a_to_b } => {
                bytes[0] = 8;
                bytes[1] = *a_to_b as u8;
            }
            Swap::Lifinity => bytes[0] = 9,
            Swap::Mercurial => bytes[0] = 10,
            Swap::Cykura => bytes[0] = 11,
            Swap::Serum { side } => {
                bytes[0] = 12;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::MarinadeDeposit => bytes[0] = 13,
            Swap::MarinadeUnstake => bytes[0] = 14,
            Swap::Aldrin { side } => {
                bytes[0] = 15;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::AldrinV2 { side } => {
                bytes[0] = 16;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::Whirlpool { a_to_b } => {
                bytes[0] = 17;
                bytes[1] = *a_to_b as u8;
            }
            Swap::Invariant { x_to_y } => {
                bytes[0] = 18;
                bytes[1] = *x_to_y as u8;
            }
            Swap::Meteora => bytes[0] = 19,
            Swap::GooseFX => bytes[0] = 20,
            Swap::DeltaFi { stable } => {
                bytes[0] = 21;
                bytes[1] = *stable as u8;
            }
            Swap::Balansol => bytes[0] = 22,
            Swap::MarcoPolo { x_to_y } => {
                bytes[0] = 23;
                bytes[1] = *x_to_y as u8;
            }
            Swap::Dradex { side } => {
                bytes[0] = 24;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::LifinityV2 => bytes[0] = 25,
            Swap::RaydiumClmm => bytes[0] = 26,
            Swap::Openbook { side } => {
                bytes[0] = 27;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::Phoenix { side } => {
                bytes[0] = 28;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::Symmetry { from_token_id, to_token_id } => {
                bytes[0] = 29;
                bytes[1..9].copy_from_slice(&from_token_id.to_le_bytes());
                bytes[9..17].copy_from_slice(&to_token_id.to_le_bytes());
            }
        }
        bytes
    }
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

// Result struct for swap operations
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapResult {
    pub output_amount: u64, // Output amount from the swap
}