use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

#[account]
pub struct AdapterRegistry {
    pub authority: Pubkey,
    pub supported_adapters: Vec<AdapterInfo>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AdapterInfo {
    pub name: String,
    pub program_id: Pubkey,
    pub swap_type: Swap,
    pub pool_addresses: Vec<Pubkey>,
}

impl AdapterRegistry {
    pub fn is_supported_adapter(&self, swap: &Swap) -> bool {
        self.supported_adapters.iter().any(|adapter| adapter.swap_type == *swap)
    }

    pub fn get_adapter_program_id(&self, swap: &Swap) -> Result<Pubkey> {
        self.supported_adapters
            .iter()
            .find(|adapter| adapter.swap_type == *swap)
            .map(|adapter| adapter.program_id)
            .ok_or(error!(ErrorCode::SwapNotSupported))
    }
}

#[event]
pub struct AdapterConfigured {
    pub program_id: Pubkey,
    pub swap_type: Swap,
}

#[event]
pub struct FeeEvent {
    pub account: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SwapEvent {
    pub amm: Pubkey,
    pub input_mint: Pubkey,
    pub input_amount: u64,
    pub output_mint: Pubkey,
    pub output_amount: u64,
}

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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Side {
    Bid,
    Ask,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RoutePlanStep {
    pub swap: Swap,
    pub percent: u8,
    pub input_index: u8,
    pub output_index: u8,
}


#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapResult {
    pub output_amount: u64,
}