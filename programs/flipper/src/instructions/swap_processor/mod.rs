use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Approve, approve, Transfer, transfer};
use crate::adapters::{AdapterContext, get_adapter};
use crate::errors::ErrorCode;
use crate::state::*;

/// Executes a token swap through a series of routing steps using router vaults.
///
/// This function processes a swap route defined by the `route_plan`, transferring tokens between
/// program-owned vaults for each token, delegating tokens to DEX pool accounts for each step,
/// executing the swap, and managing intermediate token storage. Each token has its own vault
/// owned by the program's vault authority PDA.
///
/// # Arguments
/// * `ctx` - Context containing accounts for the adapter registry, vault authority, token program, user accounts
/// * `route_plan` - Vector of steps defining the swap route, including adapter and vault indices
/// * `in_amount` - The input token amount to swap
/// * `quoted_out_amount` - The expected output amount for slippage checking
/// * `slippage_bps` - Maximum slippage allowed in basis points (max 10,000)
/// * `platform_fee_bps` - Platform fee in basis points, if applicable
///
/// # Returns
/// * `Result<u64>` - Returns the final output amount on success, or an error if validation fails
///
/// # Architecture
/// * Router program owns separate vault token accounts for each supported token
/// * Vault authority PDA signs all CPI calls on behalf of the program
/// * User tokens are transferred to input vault, then routed through intermediate vaults
/// * Final output is transferred directly to user's destination account
pub fn route<'info>(
    ctx: Context<'_, '_, 'info, 'info, Route<'info>>,
    route_plan: Vec<RoutePlanStep>,
    in_amount: u64,
    quoted_out_amount: u64,
    slippage_bps: u16,
    platform_fee_bps: u8,
) -> Result<u64> {
    // Validate route plan is not empty
    if route_plan.is_empty() {
        return Err(ErrorCode::EmptyRoute.into());
    }

    // Validate that percentages sum to 100%
    let total_percent: u8 = route_plan.iter().map(|step| step.percent).sum();
    if total_percent != 100 {
        return Err(ErrorCode::NotEnoughPercent.into());
    }

    // Validate slippage is within acceptable range
    if slippage_bps > 10_000 {
        return Err(ErrorCode::InvalidSlippage.into());
    }

    // Ensure we have enough accounts in remaining_accounts for all vault and pool accounts
    let required_accounts = route_plan.len() * 2; // minimum: input vault + output vault/pool for each step
    if ctx.remaining_accounts.len() < required_accounts {
        return Err(ErrorCode::NotEnoughAccountKeys.into());
    }

    let adapter_registry = &ctx.accounts.adapter_registry;
    let mut current_amount = in_amount;
    let mut output_amount = 0;

    let token_program_info = ctx.accounts.token_program.to_account_info();

    // Create PDA signer seeds for vault authority (program owns all vaults)
    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority",
        &[vault_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Find the input vault for the source token
    // This vault should already exist and be owned by the vault_authority
    let input_vault = ctx.remaining_accounts
        .iter()
        .find(|acc| {
            // Deserialize account data to check if it's a TokenAccount with matching mint
            if let Ok(token_account) = TokenAccount::try_deserialize(&mut acc.data.borrow().as_ref()) {
                token_account.mint == ctx.accounts.source_mint.key()
            } else {
                false
            }
        })
        .ok_or(ErrorCode::VaultNotFound)?;

    // Transfer initial input tokens from user's source account to the router's input vault
    let cpi_accounts_transfer = Transfer {
        from: ctx.accounts.user_source_token_account.to_account_info(),
        to: input_vault.clone(),
        authority: ctx.accounts.user_transfer_authority.to_account_info(),
    };
    let cpi_ctx_transfer = CpiContext::new(token_program_info.clone(), cpi_accounts_transfer);
    transfer(cpi_ctx_transfer, in_amount)?;

    // Process each step in the routing plan
    for (i, step) in route_plan.iter().enumerate() {
        // Verify that the adapter for this swap type is supported
        if !adapter_registry.is_supported_adapter(&step.swap) {
            return Err(ErrorCode::SwapNotSupported.into());
        }

        // Calculate the amount for this step based on the percentage
        let step_amount = (current_amount as u128 * step.percent as u128 / 100) as u64;
        if step_amount == 0 {
            return Err(ErrorCode::InvalidCalculation.into());
        }

        // Get input vault from remaining_accounts using the input_index
        let input_vault_account = &ctx.remaining_accounts[step.input_index as usize];

        // Determine output destination based on whether this is the final step
        let output_account_info = if i == route_plan.len() - 1 {
            // Final step: output goes directly to user's destination token account
            ctx.accounts.user_destination_token_account.to_account_info()
        } else {
            // Intermediate step: output goes to the next vault in the chain
            ctx.remaining_accounts[step.output_index as usize].clone()
        };

        // Validate that the input vault contains the expected token
        let input_vault_data = TokenAccount::try_deserialize(&mut input_vault_account.data.borrow().as_ref())?;

        // For the first step, ensure input vault matches the source mint
        if i == 0 && input_vault_data.mint != ctx.accounts.source_mint.key() {
            return Err(ErrorCode::InvalidMint.into());
        }

        // Get the adapter implementation for this swap type
        let adapter = get_adapter(&step.swap, adapter_registry)?;

        // Get adapter configuration from registry
        let adapter_info = adapter_registry
            .supported_adapters
            .iter()
            .find(|a| a.swap_type == step.swap)
            .ok_or(ErrorCode::SwapNotSupported)?;

        // Use the first pool_address as the delegate account for token approval
        // This is typically the DEX's pool or vault account that needs spending permission
        let pool_address = adapter_info
            .pool_addresses
            .first()
            .ok_or(ErrorCode::PoolNotFound)?;

        // Find the corresponding pool account in remaining_accounts
        let delegate_account = ctx
            .remaining_accounts
            .iter()
            .find(|account| account.key() == *pool_address)
            .ok_or(ErrorCode::PoolAccountNotFound)?
            .clone();

        // Approve the DEX pool to spend tokens from our vault
        // The vault_authority (program PDA) signs this approval
        let cpi_accounts = Approve {
            to: input_vault_account.clone(),
            delegate: delegate_account,
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            token_program_info.clone(),
            cpi_accounts,
            signer_seeds // Program signs with vault_authority PDA
        );
        approve(cpi_ctx, step_amount)?;

        // Create adapter context with all necessary accounts
        let adapter_ctx = AdapterContext {
            token_program: token_program_info.clone(),
            authority: ctx.accounts.vault_authority.to_account_info(),
            input_account: input_vault_account.clone(),
            output_account: output_account_info.clone(),
            remaining_accounts: ctx.remaining_accounts,
        };

        // Validate that the adapter has all required accounts
        adapter.validate_accounts(adapter_ctx.clone(), step.input_index as usize)?;

        // Execute the actual swap through the adapter
        let swap_result = adapter.execute_swap(adapter_ctx, step_amount, step.input_index as usize)?;

        // Update tracking amounts
        output_amount += swap_result.output_amount;
        current_amount = swap_result.output_amount;

        // Get output token mint for event emission
        let output_vault_data = if i != route_plan.len() - 1 {
            // Intermediate step: deserialize output vault data
            Some(TokenAccount::try_deserialize(&mut output_account_info.data.borrow().as_ref())?)
        } else {
            // Final step: output goes to user account
            None
        };

        // Emit swap event for tracking and analytics
        emit_cpi!(SwapEvent {
            amm: adapter_info.program_id,
            input_mint: input_vault_data.mint,
            input_amount: step_amount,
            output_mint: if let Some(output_data) = output_vault_data {
                output_data.mint
            } else {
                ctx.accounts.destination_mint.key()
            },
            output_amount: current_amount,
        });
    }

    // Handle platform fees if a fee account is provided
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        let fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            // Find the destination token vault to deduct fees from
            let destination_vault = ctx.remaining_accounts
                .iter()
                .find(|acc| {
                    if let Ok(token_account) = TokenAccount::try_deserialize(&mut acc.data.borrow().as_ref()) {
                        token_account.mint == ctx.accounts.destination_mint.key()
                    } else {
                        false
                    }
                })
                .ok_or(ErrorCode::VaultNotFound)?;

            // Transfer platform fees from destination vault to fee account
            let cpi_accounts_fee = Transfer {
                from: destination_vault.clone(),
                to: platform_fee_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx_fee = CpiContext::new_with_signer(
                token_program_info.clone(),
                cpi_accounts_fee,
                signer_seeds // Program signs with vault_authority PDA
            );
            transfer(cpi_ctx_fee, fee_amount)?;

            // Emit fee event for tracking
            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.destination_mint.key(),
                amount: fee_amount,
            });

            // Deduct fee from final output amount
            output_amount = output_amount.checked_sub(fee_amount).ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    // Validate that the final output meets slippage tolerance requirements
    if output_amount < quoted_out_amount * (10_000 - slippage_bps as u64) / 10_000 {
        return Err(ErrorCode::SlippageToleranceExceeded.into());
    }

    Ok(output_amount)
}

/// Accounts required for executing a token swap route with program-owned vaults.
///
/// The router program maintains separate vault token accounts for each supported token.
/// These vaults are owned by the vault_authority PDA, allowing the program to sign
/// transactions on behalf of the vaults.
///
/// # remaining_accounts should contain:
/// * Vault token accounts for each token in the route (indexed by route_plan steps)
/// * Pool accounts for each DEX adapter being used
/// * Any additional accounts required by specific adapters
#[event_cpi]
#[derive(Accounts)]
#[instruction(route_plan: Vec<RoutePlanStep>)]
pub struct Route<'info> {
    /// Registry containing all supported DEX adapters and their configurations
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,

    /// CHECK: PDA authority that owns all vault token accounts.
    /// This PDA is derived from seeds ["vault_authority"] and is used as the authority
    /// for all CPI calls involving vault token accounts. The address is validated
    /// through the seeds constraint, ensuring it's the canonical vault authority PDA.
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,

    /// SPL Token program for all token operations
    pub token_program: Program<'info, Token>,

    /// User's authority for transferring tokens from their source account
    #[account(signer)]
    pub user_transfer_authority: Signer<'info>,

    /// User's source token account (will be debited for the input amount)
    #[account(
        mut,
        token::mint = source_mint
    )]
    pub user_source_token_account: Account<'info, TokenAccount>,

    /// User's destination token account (will be credited with the final output)
    #[account(
        mut,
        token::mint = destination_mint
    )]
    pub user_destination_token_account: Account<'info, TokenAccount>,


    /// CHECK: Mint account for the input token
    pub source_mint: AccountInfo<'info>,

    /// CHECK: Mint account for the output token
    destination_mint: AccountInfo<'info>,

    /// Optional platform fee token account (must match destination_mint if provided)
    #[account(mut)]
    pub platform_fee_account: Option<Account<'info, TokenAccount>>,

    // remaining_accounts contains:
    // - Vault token accounts: Program-owned token accounts for each token type
    //   (indexed by route_plan input_index and output_index)
    // - Pool accounts: DEX-specific accounts needed for each swap
    // - Adapter accounts: Any additional accounts required by specific adapters
}