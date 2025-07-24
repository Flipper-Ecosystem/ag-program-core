use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::adapters::{AdapterContext, get_adapter};
use crate::errors::ErrorCode;
use crate::state::*;

/// Initializes the adapter registry with a list of supported adapters.
///
/// This function creates a new adapter registry account, sets its supported adapters,
/// and assigns the provided authority. It is typically called once to set up the registry.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account, payer, authority, and system program.
/// * `adapters` - Vector of adapter information to initialize the registry with.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if initialization fails.
pub fn initialize_adapter_registry(ctx: Context<InitializeAdapterRegistry>, adapters: Vec<AdapterInfo>) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    registry.supported_adapters = adapters;
    registry.authority = ctx.accounts.authority.key();
    Ok(())
}

/// Configures an adapter in the registry by adding or updating it.
///
/// This function either updates an existing adapter with the same swap type or adds a new one
/// to the registry. It emits an event to log the configuration change.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account and authority.
/// * `adapter` - The adapter information to add or update.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if the authority is invalid.
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

/// Accounts for initializing the adapter registry.
#[derive(Accounts)]
pub struct InitializeAdapterRegistry<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 4 + 100 * (4 + 32 + 32 + 8),
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Accounts for configuring an adapter in the registry.
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