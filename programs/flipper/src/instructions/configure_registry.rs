use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::{adapters::*, errors::ErrorCode, state::*};

pub fn initialize_adapter_registry(ctx: Context<InitializeAdapterRegistry>, adapters: Vec<AdapterInfo>) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    registry.supported_adapters = adapters;
    registry.authority = ctx.accounts.authority.key();
    Ok(())
}

pub fn configure_adapter(ctx: Context<ConfigureAdapter>, adapter: AdapterInfo) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    if let Some(existing) = registry.supported_adapters.iter_mut().find(|a| a.swap_type == adapter.swap_type) {
        *existing = adapter.clone();
    } else {
        registry.supported_adapters.push(adapter.clone());
    }

    emit_cpi!(
        AdapterConfigured {
            program_id: adapter.program_id,
            swap_type: adapter.swap_type.clone(),
        }
    );

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeAdapterRegistry<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 4 + 100 * (4 + 32 + 32 + 8), // authority + vec discriminator + 100 adapters
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ConfigureAdapter<'info> {
    #[account(
        mut,
        seeds = [b"adapter_registry"],
        bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(signer)]
    pub authority: Signer<'info>
}