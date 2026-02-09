use anchor_lang::prelude::*;

// Declare submodules for adapter implementations and trait
pub mod raydium;
pub mod whirlpool;
pub mod meteora;

pub mod dex_adapter;

pub mod adapter_connector_module;

// Test modules
#[cfg(test)]
mod dex_adapter_test;

// Result struct for swap operations, holding the output amount
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapResult {
    pub output_amount: u64,
}