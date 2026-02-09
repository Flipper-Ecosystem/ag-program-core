use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

// Stores the adapter registry state, including authority and supported adapters
#[account]
pub struct AdapterRegistry {
    pub authority: Pubkey,            // Account authorized to manage the registry
    pub operators: Vec<Pubkey>,      // List of operator public keys authorized to manage adapters and pools
    pub supported_adapters: Vec<AdapterInfo>, // List of supported DEX adapters
    pub bump: u8,                     // Bump seed for PDA
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

// Event emitted when the global manager is changed
#[event]
pub struct GlobalManagerChanged {
    pub old_manager: Pubkey, // Previous global manager
    pub new_manager: Pubkey, // New global manager
}

// Event emitted when vault authority admin is changed by global manager
#[event]
pub struct VaultAuthorityAdminChanged {
    pub old_admin: Pubkey, // Previous vault authority admin
    pub new_admin: Pubkey, // New vault authority admin
    pub changed_by: Pubkey, // Global manager who made the change
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

// Remaining accounts info structure for Jupiter swaps
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub struct RemainingAccountsSlice {
    pub accounts_type: u8,
    pub length: u8,
}

// Candidate swap for dynamic routing
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum CandidateSwap {
    HumidiFi { swap_id: u64, is_base_to_quote: bool },
    TesseraV { side: Side },
    HumidiFiV2 { swap_id: u64, is_base_to_quote: bool },
}

// Defines supported swap types for various DEX protocols
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
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
    TokenSwapV2,
    HeliumTreasuryManagementRedeemV0,
    StakeDexStakeWrappedSol,
    StakeDexSwapViaStake { bridge_stake_seed: u32 },
    GooseFXV2,
    Perps,
    PerpsAddLiquidity,
    PerpsRemoveLiquidity,
    MeteoraDlmm,
    OpenBookV2 { side: Side },
    RaydiumClmmV2,
    StakeDexPrefundWithdrawStakeAndDepositStake { bridge_stake_seed: u32 },
    Clone { pool_index: u8, quantity_is_input: bool, quantity_is_collateral: bool },
    SanctumS { src_lst_value_calc_accs: u8, dst_lst_value_calc_accs: u8, src_lst_index: u32, dst_lst_index: u32 },
    SanctumSAddLiquidity { lst_value_calc_accs: u8, lst_index: u32 },
    SanctumSRemoveLiquidity { lst_value_calc_accs: u8, lst_index: u32 },
    RaydiumCP,
    WhirlpoolSwapV2 { a_to_b: bool, remaining_accounts_info: Option<RemainingAccountsInfo> },
    OneIntro,
    PumpWrappedBuy,
    PumpWrappedSell,
    PerpsV2,
    PerpsV2AddLiquidity,
    PerpsV2RemoveLiquidity,
    MoonshotWrappedBuy,
    MoonshotWrappedSell,
    StabbleStableSwap,
    StabbleWeightedSwap,
    Obric { x_to_y: bool },
    FoxBuyFromEstimatedCost,
    FoxClaimPartial { is_y: bool },
    SolFi { is_quote_to_base: bool },
    SolayerDelegateNoInit,
    SolayerUndelegateNoInit,
    TokenMill { side: Side },
    DaosFunBuy,
    DaosFunSell,
    ZeroFi,
    StakeDexWithdrawWrappedSol,
    VirtualsBuy,
    VirtualsSell,
    Perena { in_index: u8, out_index: u8 },
    PumpSwapBuy,
    PumpSwapSell,
    Gamma,
    MeteoraDlmmSwapV2 { remaining_accounts_info: RemainingAccountsInfo },
    Woofi,
    MeteoraDammV2,
    MeteoraDynamicBondingCurveSwap,
    StabbleStableSwapV2,
    StabbleWeightedSwapV2,
    RaydiumLaunchlabBuy { share_fee_rate: u64 },
    RaydiumLaunchlabSell { share_fee_rate: u64 },
    BoopdotfunWrappedBuy,
    BoopdotfunWrappedSell,
    Plasma { side: Side },
    GoonFi { is_bid: bool, blacklist_bump: u8 },
    HumidiFi { swap_id: u64, is_base_to_quote: bool },
    MeteoraDynamicBondingCurveSwapWithRemainingAccounts,
    TesseraV { side: Side },
    PumpWrappedBuyV2,
    PumpWrappedSellV2,
    PumpSwapBuyV2,
    PumpSwapSellV2,
    Heaven { a_to_b: bool },
    SolFiV2 { is_quote_to_base: bool },
    Aquifer,
    PumpWrappedBuyV3,
    PumpWrappedSellV3,
    PumpSwapBuyV3,
    PumpSwapSellV3,
    JupiterLendDeposit,
    JupiterLendRedeem,
    DefiTuna { a_to_b: bool, remaining_accounts_info: Option<RemainingAccountsInfo> },
    AlphaQ { a_to_b: bool },
    RaydiumV2,
    SarosDlmm { swap_for_y: bool },
    Futarchy { side: Side },
    MeteoraDammV2WithRemainingAccounts,
    Obsidian,
    WhaleStreet { side: Side },
    DynamicV1 { candidate_swaps: Vec<CandidateSwap>, best_position: Option<u8> },
    PumpWrappedBuyV4,
    PumpWrappedSellV4,
    CarrotIssue,
    CarrotRedeem,
    Manifest { side: Side },
    BisonFi { a_to_b: bool },
    HumidiFiV2 { swap_id: u64, is_base_to_quote: bool },
    PerenaStar { is_mint: bool },
    JupiterRfqV2 { side: Side, fill_data: Vec<u8> },
    GoonFiV2 { is_bid: bool },
    Scorch { swap_id: u128 },
    VaultLiquidUnstake { lst_amounts: [u64; 5], seed: u64 },
    XOrca,
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
            Swap::TokenSwapV2 => bytes[0] = 30,
            Swap::HeliumTreasuryManagementRedeemV0 => bytes[0] = 31,
            Swap::StakeDexStakeWrappedSol => bytes[0] = 32,
            Swap::StakeDexSwapViaStake { bridge_stake_seed } => {
                bytes[0] = 33;
                bytes[1..5].copy_from_slice(&bridge_stake_seed.to_le_bytes());
            }
            Swap::GooseFXV2 => bytes[0] = 34,
            Swap::Perps => bytes[0] = 35,
            Swap::PerpsAddLiquidity => bytes[0] = 36,
            Swap::PerpsRemoveLiquidity => bytes[0] = 37,
            Swap::MeteoraDlmm => bytes[0] = 38,
            Swap::OpenBookV2 { side } => {
                bytes[0] = 39;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::RaydiumClmmV2 => bytes[0] = 40,
            Swap::StakeDexPrefundWithdrawStakeAndDepositStake { bridge_stake_seed } => {
                bytes[0] = 41;
                bytes[1..5].copy_from_slice(&bridge_stake_seed.to_le_bytes());
            }
            Swap::Clone { pool_index, quantity_is_input, quantity_is_collateral } => {
                bytes[0] = 42;
                bytes[1] = *pool_index;
                bytes[2] = *quantity_is_input as u8;
                bytes[3] = *quantity_is_collateral as u8;
            }
            Swap::SanctumS { src_lst_value_calc_accs, dst_lst_value_calc_accs, src_lst_index, dst_lst_index } => {
                bytes[0] = 43;
                bytes[1] = *src_lst_value_calc_accs;
                bytes[2] = *dst_lst_value_calc_accs;
                bytes[3..7].copy_from_slice(&src_lst_index.to_le_bytes());
                bytes[7..11].copy_from_slice(&dst_lst_index.to_le_bytes());
            }
            Swap::SanctumSAddLiquidity { lst_value_calc_accs, lst_index } => {
                bytes[0] = 44;
                bytes[1] = *lst_value_calc_accs;
                bytes[2..6].copy_from_slice(&lst_index.to_le_bytes());
            }
            Swap::SanctumSRemoveLiquidity { lst_value_calc_accs, lst_index } => {
                bytes[0] = 45;
                bytes[1] = *lst_value_calc_accs;
                bytes[2..6].copy_from_slice(&lst_index.to_le_bytes());
            }
            Swap::RaydiumCP => bytes[0] = 46,
            Swap::WhirlpoolSwapV2 { a_to_b, .. } => {
                bytes[0] = 47;
                bytes[1] = *a_to_b as u8;
            }
            Swap::OneIntro => bytes[0] = 48,
            Swap::PumpWrappedBuy => bytes[0] = 49,
            Swap::PumpWrappedSell => bytes[0] = 50,
            Swap::PerpsV2 => bytes[0] = 51,
            Swap::PerpsV2AddLiquidity => bytes[0] = 52,
            Swap::PerpsV2RemoveLiquidity => bytes[0] = 53,
            Swap::MoonshotWrappedBuy => bytes[0] = 54,
            Swap::MoonshotWrappedSell => bytes[0] = 55,
            Swap::StabbleStableSwap => bytes[0] = 56,
            Swap::StabbleWeightedSwap => bytes[0] = 57,
            Swap::Obric { x_to_y } => {
                bytes[0] = 58;
                bytes[1] = *x_to_y as u8;
            }
            Swap::FoxBuyFromEstimatedCost => bytes[0] = 59,
            Swap::FoxClaimPartial { is_y } => {
                bytes[0] = 60;
                bytes[1] = *is_y as u8;
            }
            Swap::SolFi { is_quote_to_base } => {
                bytes[0] = 61;
                bytes[1] = *is_quote_to_base as u8;
            }
            Swap::SolayerDelegateNoInit => bytes[0] = 62,
            Swap::SolayerUndelegateNoInit => bytes[0] = 63,
            Swap::TokenMill { side } => {
                bytes[0] = 64;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::DaosFunBuy => bytes[0] = 65,
            Swap::DaosFunSell => bytes[0] = 66,
            Swap::ZeroFi => bytes[0] = 67,
            Swap::StakeDexWithdrawWrappedSol => bytes[0] = 68,
            Swap::VirtualsBuy => bytes[0] = 69,
            Swap::VirtualsSell => bytes[0] = 70,
            Swap::Perena { in_index, out_index } => {
                bytes[0] = 71;
                bytes[1] = *in_index;
                bytes[2] = *out_index;
            }
            Swap::PumpSwapBuy => bytes[0] = 72,
            Swap::PumpSwapSell => bytes[0] = 73,
            Swap::Gamma => bytes[0] = 74,
            Swap::MeteoraDlmmSwapV2 { .. } => bytes[0] = 75,
            Swap::Woofi => bytes[0] = 76,
            Swap::MeteoraDammV2 => bytes[0] = 77,
            Swap::MeteoraDynamicBondingCurveSwap => bytes[0] = 78,
            Swap::StabbleStableSwapV2 => bytes[0] = 79,
            Swap::StabbleWeightedSwapV2 => bytes[0] = 80,
            Swap::RaydiumLaunchlabBuy { share_fee_rate } => {
                bytes[0] = 81;
                bytes[1..9].copy_from_slice(&share_fee_rate.to_le_bytes());
            }
            Swap::RaydiumLaunchlabSell { share_fee_rate } => {
                bytes[0] = 82;
                bytes[1..9].copy_from_slice(&share_fee_rate.to_le_bytes());
            }
            Swap::BoopdotfunWrappedBuy => bytes[0] = 83,
            Swap::BoopdotfunWrappedSell => bytes[0] = 84,
            Swap::Plasma { side } => {
                bytes[0] = 85;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::GoonFi { is_bid, blacklist_bump } => {
                bytes[0] = 86;
                bytes[1] = *is_bid as u8;
                bytes[2] = *blacklist_bump;
            }
            Swap::HumidiFi { swap_id, is_base_to_quote } => {
                bytes[0] = 87;
                bytes[1..9].copy_from_slice(&swap_id.to_le_bytes());
                bytes[9] = *is_base_to_quote as u8;
            }
            Swap::MeteoraDynamicBondingCurveSwapWithRemainingAccounts => bytes[0] = 88,
            Swap::TesseraV { side } => {
                bytes[0] = 89;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::PumpWrappedBuyV2 => bytes[0] = 90,
            Swap::PumpWrappedSellV2 => bytes[0] = 91,
            Swap::PumpSwapBuyV2 => bytes[0] = 92,
            Swap::PumpSwapSellV2 => bytes[0] = 93,
            Swap::Heaven { a_to_b } => {
                bytes[0] = 94;
                bytes[1] = *a_to_b as u8;
            }
            Swap::SolFiV2 { is_quote_to_base } => {
                bytes[0] = 95;
                bytes[1] = *is_quote_to_base as u8;
            }
            Swap::Aquifer => bytes[0] = 96,
            Swap::PumpWrappedBuyV3 => bytes[0] = 97,
            Swap::PumpWrappedSellV3 => bytes[0] = 98,
            Swap::PumpSwapBuyV3 => bytes[0] = 99,
            Swap::PumpSwapSellV3 => bytes[0] = 100,
            Swap::JupiterLendDeposit => bytes[0] = 101,
            Swap::JupiterLendRedeem => bytes[0] = 102,
            Swap::DefiTuna { a_to_b, .. } => {
                bytes[0] = 103;
                bytes[1] = *a_to_b as u8;
            }
            Swap::AlphaQ { a_to_b } => {
                bytes[0] = 104;
                bytes[1] = *a_to_b as u8;
            }
            Swap::RaydiumV2 => bytes[0] = 105,
            Swap::SarosDlmm { swap_for_y } => {
                bytes[0] = 106;
                bytes[1] = *swap_for_y as u8;
            }
            Swap::Futarchy { side } => {
                bytes[0] = 107;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::MeteoraDammV2WithRemainingAccounts => bytes[0] = 108,
            Swap::Obsidian => bytes[0] = 109,
            Swap::WhaleStreet { side } => {
                bytes[0] = 110;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::DynamicV1 { .. } => bytes[0] = 111,
            Swap::PumpWrappedBuyV4 => bytes[0] = 112,
            Swap::PumpWrappedSellV4 => bytes[0] = 113,
            Swap::CarrotIssue => bytes[0] = 114,
            Swap::CarrotRedeem => bytes[0] = 115,
            Swap::Manifest { side } => {
                bytes[0] = 116;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::BisonFi { a_to_b } => {
                bytes[0] = 117;
                bytes[1] = *a_to_b as u8;
            }
            Swap::HumidiFiV2 { swap_id, is_base_to_quote } => {
                bytes[0] = 118;
                bytes[1..9].copy_from_slice(&swap_id.to_le_bytes());
                bytes[9] = *is_base_to_quote as u8;
            }
            Swap::PerenaStar { is_mint } => {
                bytes[0] = 119;
                bytes[1] = *is_mint as u8;
            }
            Swap::JupiterRfqV2 { side, .. } => {
                bytes[0] = 120;
                bytes[1] = match side {
                    Side::Bid => 0,
                    Side::Ask => 1,
                };
            }
            Swap::GoonFiV2 { is_bid } => {
                bytes[0] = 121;
                bytes[1] = *is_bid as u8;
            }
            Swap::Scorch { swap_id } => {
                bytes[0] = 122;
                bytes[1..17].copy_from_slice(&swap_id.to_le_bytes());
            }
            Swap::VaultLiquidUnstake { seed, .. } => {
                bytes[0] = 123;
                bytes[1..9].copy_from_slice(&seed.to_le_bytes());
            }
            Swap::XOrca => bytes[0] = 124,
        }
        bytes
    }
}

// Defines the side of an order for DEXs like Serum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
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