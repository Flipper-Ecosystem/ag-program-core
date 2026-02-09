use anchor_lang::prelude::*;
use crate::adapters::adapter_connector_module::{AdapterContext, get_adapter};
use crate::errors::ErrorCode;
use crate::state::*;

// Test modules
#[cfg(test)]
mod adapter_registry_test;

/// Initializes the adapter registry with a list of supported adapters and operators.
pub fn initialize_adapter_registry(ctx: Context<InitializeAdapterRegistry>, adapters: Vec<AdapterInfo>, operators: Vec<Pubkey>) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    registry.supported_adapters = adapters;
    registry.authority = ctx.accounts.authority.key();
    registry.operators = operators;
    registry.bump = ctx.bumps.adapter_registry;
    Ok(())
}

/// Initializes a new pool info account for an adapter.
pub fn initialize_pool_info(ctx: Context<InitializePoolInfo>, swap_type: Swap, pool_address: Pubkey) -> Result<()> {
    let registry = &ctx.accounts.adapter_registry;
    if !registry.is_supported_adapter(&swap_type) {
        return Err(ErrorCode::SwapNotSupported.into());
    }

    let pool_info = &mut ctx.accounts.pool_info;
    pool_info.adapter_swap_type = swap_type.clone();
    pool_info.pool_address = pool_address;
    pool_info.enabled = true;

    emit_cpi!(PoolInitialized {
        swap_type,
        pool_address,
    });

    Ok(())
}

/// Adds an operator to the adapter registry.
pub fn add_operator(ctx: Context<AddOperator>, operator: Pubkey) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    if registry.operators.contains(&operator) {
        return Err(error!(ErrorCode::OperatorAlreadyExists));
    }
    registry.operators.push(operator);

    emit_cpi!(OperatorAdded { operator });

    Ok(())
}

/// Removes an operator from the adapter registry.
pub fn remove_operator(ctx: Context<RemoveOperator>, operator: Pubkey) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    let initial_len = registry.operators.len();
    registry.operators.retain(|op| *op != operator);

    if registry.operators.len() == initial_len {
        return Err(error!(ErrorCode::OperatorNotFound));
    }

    emit_cpi!(OperatorRemoved { operator });

    Ok(())
}

/// Configures an adapter in the registry by adding or updating it.
pub fn configure_adapter(ctx: Context<ConfigureAdapter>, adapter: AdapterInfo) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    if let Some(existing) = registry.supported_adapters.iter_mut().find(|a| a.swap_type == adapter.swap_type) {
        *existing = adapter.clone();
    } else {
        registry.supported_adapters.push(adapter.clone());
    }

    emit_cpi!(AdapterConfigured {
        program_id: adapter.program_id,
        swap_type: adapter.swap_type.clone(),
    });

    Ok(())
}

/// Disables an adapter in the registry by removing it.
pub fn disable_adapter(ctx: Context<DisableAdapter>, swap_type: Swap) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    let initial_len = registry.supported_adapters.len();
    registry.supported_adapters.retain(|adapter| adapter.swap_type != swap_type);

    if registry.supported_adapters.len() == initial_len {
        return Err(error!(ErrorCode::SwapNotSupported));
    }

    emit_cpi!(AdapterDisabled { swap_type });

    Ok(())
}

/// Disables a specific pool for an adapter.
pub fn disable_pool(ctx: Context<DisablePool>, swap_type: Swap, pool_address: Pubkey) -> Result<()> {
    let pool_info = &mut ctx.accounts.pool_info;
    if pool_info.adapter_swap_type != swap_type || pool_info.pool_address != pool_address {
        return Err(error!(ErrorCode::InvalidPoolAddress));
    }
    if !pool_info.enabled {
        return Err(error!(ErrorCode::PoolDisabled));
    }

    pool_info.enabled = false;

    emit_cpi!(PoolDisabled {
        swap_type,
        pool_address,
    });

    Ok(())
}

/// Changes the authority of the adapter registry.
pub fn change_authority(ctx: Context<ChangeAuthority>) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    let old_authority = registry.authority;
    registry.authority = ctx.accounts.new_authority.key();

    emit_cpi!(AuthorityChanged {
        old_authority,
        new_authority: registry.authority,
    });

    Ok(())
}

/// Resets the adapter registry with new adapters and operators.
pub fn reset_adapter_registry(ctx: Context<ResetAdapterRegistry>, adapters: Vec<AdapterInfo>, operators: Vec<Pubkey>) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    registry.supported_adapters = adapters;
    registry.operators = operators;

    emit_cpi!(RegistryReset {
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}

/// Migrates the adapter registry to write the PDA bump seed into the account data.
/// This is needed because the bump field was added after the account was originally created on-chain.
/// The account is reallocated to accommodate the extra byte if necessary.
pub fn migrate_adapter_registry(ctx: Context<MigrateAdapterRegistry>) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    registry.bump = ctx.bumps.adapter_registry;
    Ok(())
}

/// Accounts for initializing the adapter registry.
#[derive(Accounts)]
pub struct InitializeAdapterRegistry<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 4 + 10 * (4 + 32 + 32) + 4 + 10 * 32 + 1,
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Accounts for initializing a pool info account.
#[event_cpi]
#[derive(Accounts)]
#[instruction(swap_type: Swap, pool_address: Pubkey)]
pub struct InitializePoolInfo<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 4 + 32 + 1,
        seeds = [b"pool_info", swap_type.to_bytes().as_ref(), pool_address.as_ref()],
        bump
    )]
    pub pool_info: Account<'info, PoolInfo>,
    #[account(
        seeds = [b"adapter_registry"],
        bump,
        constraint = adapter_registry.authority == operator.key() || adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(signer)]
    pub operator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Accounts for adding an operator to the registry.
#[event_cpi]
#[derive(Accounts)]
pub struct AddOperator<'info> {
    #[account(
        mut,
        seeds = [b"adapter_registry"],
        bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(signer)]
    pub authority: Signer<'info>,
}

/// Accounts for removing an operator from the registry.
#[event_cpi]
#[derive(Accounts)]
pub struct RemoveOperator<'info> {
    #[account(
        mut,
        seeds = [b"adapter_registry"],
        bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(signer)]
    pub authority: Signer<'info>,
}

/// Accounts for configuring an adapter in the registry.
#[event_cpi]
#[derive(Accounts)]
pub struct ConfigureAdapter<'info> {
    #[account(
        mut,
        seeds = [b"adapter_registry"],
        bump,
        constraint = adapter_registry.authority == operator.key() || adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(signer)]
    pub operator: Signer<'info>,
}

/// Accounts for disabling an adapter in the registry.
#[event_cpi]
#[derive(Accounts)]
pub struct DisableAdapter<'info> {
    #[account(
        mut,
        seeds = [b"adapter_registry"],
        bump,
        constraint = adapter_registry.authority == operator.key() || adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(signer)]
    pub operator: Signer<'info>,
}

/// Accounts for disabling a pool in an adapter.
#[event_cpi]
#[derive(Accounts)]
#[instruction(swap_type: Swap, pool_address: Pubkey)]
pub struct DisablePool<'info> {
    #[account(
        mut,
        seeds = [b"pool_info", swap_type.to_bytes().as_ref(), pool_address.as_ref()],
        bump
    )]
    pub pool_info: Account<'info, PoolInfo>,
    #[account(
        seeds = [b"adapter_registry"],
        bump,
        constraint = adapter_registry.authority == operator.key() || adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(signer)]
    pub operator: Signer<'info>,
}

/// Accounts for changing the authority of the adapter registry.
#[event_cpi]
#[derive(Accounts)]
pub struct ChangeAuthority<'info> {
    #[account(
        mut,
        seeds = [b"adapter_registry"],
        bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(signer)]
    pub authority: Signer<'info>,
    /// CHECK: The new authority is not validated here, as it is just a Pubkey being set.
    pub new_authority: UncheckedAccount<'info>,
}

/// Accounts for resetting the adapter registry.
#[event_cpi]
#[derive(Accounts)]
pub struct ResetAdapterRegistry<'info> {
    #[account(
        mut,
        seeds = [b"adapter_registry"],
        bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(signer)]
    pub authority: Signer<'info>,
}

/// Accounts for migrating the adapter registry (writing bump to existing account).
/// Uses realloc to expand the account by 1 byte and re-derives the bump from seeds.
#[derive(Accounts)]
pub struct MigrateAdapterRegistry<'info> {
    #[account(
        mut,
        realloc = 8 + 32 + 4 + 10 * (4 + 32 + 32) + 4 + 10 * 32 + 1,
        realloc::payer = payer,
        realloc::zero = false,
        seeds = [b"adapter_registry"],
        bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}