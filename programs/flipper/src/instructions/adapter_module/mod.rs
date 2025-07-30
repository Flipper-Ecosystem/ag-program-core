use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::adapters::{AdapterContext, get_adapter};
use crate::errors::ErrorCode;
use crate::state::*;

/// Initializes the adapter registry with a list of supported adapters and operators.
///
/// This function creates a new adapter registry account, sets its supported adapters,
/// assigns the provided authority, and initializes the operators list.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account, payer, authority, and system program.
/// * `adapters` - Vector of adapter information to initialize the registry with.
/// * `operators` - Vector of operator public keys to initialize the registry with.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if initialization fails.
pub fn initialize_adapter_registry(ctx: Context<InitializeAdapterRegistry>, adapters: Vec<AdapterInfo>, operators: Vec<Pubkey>) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    registry.supported_adapters = adapters;
    registry.authority = ctx.accounts.authority.key();
    registry.operators = operators;
    Ok(())
}

/// Adds an operator to the adapter registry.
///
/// This function adds a new operator to the registry's operators list.
/// Only the authority can call this instruction.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account, authority, and new operator.
/// * `operator` - The public key of the operator to add.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if the authority is invalid or operator already exists.
pub fn add_operator(ctx: Context<AddOperator>, operator: Pubkey) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    if registry.operators.contains(&operator) {
        return Err(error!(ErrorCode::OperatorAlreadyExists));
    }
    registry.operators.push(operator);

    emit_cpi!(
        OperatorAdded {
            operator,
        }
    );

    Ok(())
}

/// Removes an operator from the adapter registry.
///
/// This function removes an operator from the registry's operators list.
/// Only the authority can call this instruction.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account, authority, and operator to remove.
/// * `operator` - The public key of the operator to remove.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if the authority is invalid or operator not found.
pub fn remove_operator(ctx: Context<RemoveOperator>, operator: Pubkey) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    let initial_len = registry.operators.len();
    registry.operators.retain(|op| *op != operator);

    if registry.operators.len() == initial_len {
        return Err(error!(ErrorCode::OperatorNotFound));
    }

    emit_cpi!(
        OperatorRemoved {
            operator,
        }
    );

    Ok(())
}

/// Configures an adapter in the registry by adding or updating it.
///
/// This function either updates an existing adapter with the same swap type or adds a new one
/// to the registry. It emits an event to log the configuration change. Only operators or authority can call this.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account and operator/authority.
/// * `adapter` - The adapter information to add or update.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if the caller is not authorized.
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

/// Disables an adapter in the registry by removing it.
///
/// This function removes an adapter with the specified swap type from the registry.
/// It emits an event to log the adapter disablement. Only operators or authority can call this.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account and operator/authority.
/// * `swap_type` - The swap type of the adapter to disable.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if the adapter is not found or caller is not authorized.
pub fn disable_adapter(ctx: Context<DisableAdapter>, swap_type: Swap) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    let initial_len = registry.supported_adapters.len();
    registry.supported_adapters.retain(|adapter| adapter.swap_type != swap_type);

    if registry.supported_adapters.len() == initial_len {
        return Err(error!(ErrorCode::SwapNotSupported));
    }

    emit_cpi!(
        AdapterDisabled {
            swap_type: swap_type.clone(),
        }
    );

    Ok(())
}

/// Disables a specific pool address for an adapter in the registry.
///
/// This function removes a pool address from the specified adapter's pool_addresses list.
/// It emits an event to log the pool disablement. Only operators or authority can call this.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account and operator/authority.
/// * `swap_type` - The swap type of the adapter.
/// * `pool_address` - The pool address to disable.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if the adapter or pool is not found or caller is not authorized.
pub fn disable_pool(ctx: Context<DisablePool>, swap_type: Swap, pool_address: Pubkey) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    let adapter = registry
        .supported_adapters
        .iter_mut()
        .find(|adapter| adapter.swap_type == swap_type)
        .ok_or(error!(ErrorCode::SwapNotSupported))?;

    let initial_len = adapter.pool_addresses.len();
    adapter.pool_addresses.retain(|addr| *addr != pool_address);

    if adapter.pool_addresses.len() == initial_len {
        return Err(error!(ErrorCode::PoolNotFound));
    }

    emit_cpi!(
        PoolDisabled {
            swap_type: swap_type.clone(),
            pool_address,
        }
    );

    Ok(())
}

/// Adds a new pool address to an existing adapter in the registry.
///
/// This function adds a new pool address to the specified adapter's pool_addresses list.
/// It emits an event to log the addition of the new pool address. Only operators or authority can call this.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account and operator/authority.
/// * `swap_type` - The swap type of the adapter.
/// * `pool_address` - The new pool address to add.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if the adapter is not found or caller is not authorized.
pub fn add_pool_address(ctx: Context<AddPoolAddress>, swap_type: Swap, pool_address: Pubkey) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    let adapter = registry
        .supported_adapters
        .iter_mut()
        .find(|adapter| adapter.swap_type == swap_type)
        .ok_or(error!(ErrorCode::SwapNotSupported))?;

    if adapter.pool_addresses.contains(&pool_address) {
        return Err(error!(ErrorCode::PoolAlreadyExists));
    }

    adapter.pool_addresses.push(pool_address);

    emit_cpi!(
        PoolAdded {
            swap_type: swap_type.clone(),
            pool_address,
        }
    );

    Ok(())
}

/// Changes the authority of the adapter registry.
///
/// This function updates the authority of the adapter registry to a new authority.
/// It emits an event to log the authority change. Only the current authority can call this.
///
/// # Arguments
/// * `ctx` - Context containing the adapter registry account, current authority, and new authority.
///
/// # Returns
/// * `Result<()>` - Returns Ok(()) on success, or an error if the current authority is invalid.
pub fn change_authority(ctx: Context<ChangeAuthority>) -> Result<()> {
    let registry = &mut ctx.accounts.adapter_registry;
    let old_authority = registry.authority;
    registry.authority = ctx.accounts.new_authority.key();

    emit_cpi!(
        AuthorityChanged {
            old_authority,
            new_authority: registry.authority,
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
        space = 8 + 32 + 4 + 100 * (4 + 32 + 32 + 8) + 4 + 100 * 32, // Increased space for operators
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
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
pub struct DisablePool<'info> {
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

/// Accounts for adding a new pool address to an adapter.
#[event_cpi]
#[derive(Accounts)]
pub struct AddPoolAddress<'info> {
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
    pub new_authority: UncheckedAccount<'info>
}