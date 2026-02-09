use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use anchor_spl::token_interface::{
    Mint, TokenAccount, TokenInterface,
    transfer_checked, TransferChecked,
    close_account, CloseAccount,
};
use crate::errors::ErrorCode;
use crate::state::*;
use crate::instructions::limit_orders_module::{LimitOrder, OrderStatus};
use crate::instructions::vault_manager_module::VaultAuthority;

/// Jupiter shared_accounts_route account indices (must match Jupiter IDL).
/// 2: user_transfer_authority (vault_authority - we sign), 3: user_source, 6: user_destination
const JUPITER_USER_TRANSFER_AUTHORITY_INDEX: usize = 2;
const JUPITER_USER_SOURCE_INDEX: usize = 3;
const JUPITER_USER_DESTINATION_INDEX: usize = 6;
const JUPITER_MIN_ACCOUNTS: usize = 13;

/// Shared execute limit order instruction
/// Uses Jupiter CPI for swap execution (different from regular execute_limit_order)
/// Note: For creating and canceling limit orders, use the regular limit_orders_module functions
/// as the LimitOrder structure is the same. Only execution differs (Jupiter CPI vs DEX adapters).
#[event_cpi]
#[derive(Accounts)]
pub struct SharedExecuteLimitOrder<'info> {
    /// Adapter registry for operator validation
    #[account(
        seeds = [b"adapter_registry"],
        bump
    )]
    pub adapter_registry: Account<'info, AdapterRegistry>,

    /// Vault authority controlling token transfers
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Limit order to execute (will be closed, rent goes to operator)
    #[account(
        mut,
        close = operator,
        constraint = limit_order.status == OrderStatus::Open @ ErrorCode::InvalidOrderStatus,
        constraint = limit_order.input_vault == input_vault.key() @ ErrorCode::InvalidVaultAddress
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// Vault holding input tokens - this is an order_vault PDA (["order_vault", limitOrder])
    #[account(
        mut,
        constraint = input_vault.mint == limit_order.input_mint @ ErrorCode::InvalidMint
    )]
    pub input_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Vault for output tokens (temporary destination) - PDA derived from ["vault", output_mint]
    #[account(
        mut,
        seeds = [b"vault", output_mint.key().as_ref()],
        bump,
        constraint = output_vault.mint == limit_order.output_mint @ ErrorCode::InvalidMint,
        constraint = output_vault.owner == vault_authority.key() @ ErrorCode::InvalidVaultOwner
    )]
    pub output_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token program for input tokens
    pub input_token_program: Interface<'info, TokenInterface>,
    
    /// Token program for output tokens
    pub output_token_program: Interface<'info, TokenInterface>,

    /// User's destination account for output tokens
    #[account(
        mut,
        constraint = user_destination_token_account.key() == limit_order.user_destination_account,
        constraint = user_destination_token_account.mint == limit_order.output_mint,
        constraint = user_destination_token_account.owner == limit_order.creator
    )]
    pub user_destination_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Input token mint
    #[account(
        constraint = input_mint.key() == limit_order.input_mint @ ErrorCode::InvalidMint
    )]
    pub input_mint: InterfaceAccount<'info, Mint>,
    
    /// Output token mint
    #[account(
        constraint = output_mint.key() == limit_order.output_mint @ ErrorCode::InvalidMint
    )]
    pub output_mint: InterfaceAccount<'info, Mint>,

    /// Optional platform fee collection account
    #[account(mut)]
    pub platform_fee_account: Option<InterfaceAccount<'info, TokenAccount>>,

    /// Jupiter program for CPI swap
    /// CHECK: Jupiter program ID will be validated in the CPI call
    pub jupiter_program: AccountInfo<'info>,

    /// Operator executing the order (must be registered, receives rent from closed order)
    #[account(
        mut,
        signer,
        constraint = adapter_registry.operators.contains(&operator.key()) @ ErrorCode::InvalidOperator
    )]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
    
    // Note: event_authority is automatically added by #[event_cpi] macro
}

/// Executes a limit order using Jupiter CPI. Client passes `data` and Jupiter accounts in `remaining_accounts`.
pub fn shared_execute_limit_order<'info>(
    ctx: Context<'_, '_, 'info, 'info, SharedExecuteLimitOrder<'info>>,
    quoted_out_amount: u64,
    platform_fee_bps: u8,
    data: Vec<u8>,
) -> Result<u64> {
    let now = Clock::get()?.unix_timestamp;
    require!(now < ctx.accounts.limit_order.expiry, ErrorCode::OrderExpired);
    require!(
        ctx.accounts.limit_order.should_execute(quoted_out_amount)?,
        ErrorCode::TriggerPriceNotMet
    );

    let in_amount = ctx.accounts.limit_order.input_amount;
    require!(in_amount > 0, ErrorCode::InvalidAmount);
    require!(quoted_out_amount > 0, ErrorCode::InvalidAmount);
    require!(!data.is_empty(), ErrorCode::EmptyRoute);

    // Validate Jupiter program matches the one stored in vault_authority
    require!(
        ctx.accounts.jupiter_program.key() == ctx.accounts.vault_authority.jupiter_program_id,
        ErrorCode::InvalidJupiterProgram
    );

    require!(
        ctx.remaining_accounts.len() >= JUPITER_MIN_ACCOUNTS,
        ErrorCode::NotEnoughJupiterAccounts
    );
    // Validate that user_transfer_authority (index 2) is our vault_authority
    require!(
        ctx.remaining_accounts[JUPITER_USER_TRANSFER_AUTHORITY_INDEX].key() == ctx.accounts.vault_authority.key(),
        ErrorCode::JupiterProgramAuthorityMismatch
    );
    // Validate that user_source (index 3) is our input_vault
    require!(
        ctx.remaining_accounts[JUPITER_USER_SOURCE_INDEX].key() == ctx.accounts.input_vault.key(),
        ErrorCode::JupiterProgramSourceMismatch
    );
    // Validate that user_destination (index 6) is our output_vault
    require!(
        ctx.remaining_accounts[JUPITER_USER_DESTINATION_INDEX].key() == ctx.accounts.output_vault.key(),
        ErrorCode::JupiterProgramDestinationMismatch
    );

    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[b"vault_authority".as_ref(), &[vault_authority_bump]];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    ctx.accounts.output_vault.reload()?;
    let balance_before = ctx.accounts.output_vault.amount;

    // Build account metas from remaining_accounts; user_transfer_authority (index 2) must be signer
    let accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta> = ctx
        .remaining_accounts
        .iter()
        .enumerate()
        .map(|(idx, acc)| {
            // Only user_transfer_authority (index 2 = vault_authority) should be marked as signer
            let is_signer = idx == JUPITER_USER_TRANSFER_AUTHORITY_INDEX;
            anchor_lang::solana_program::instruction::AccountMeta {
                pubkey: *acc.key,
                is_signer,
                is_writable: acc.is_writable,
            }
        })
        .collect();

    let account_infos: Vec<AccountInfo> = ctx.remaining_accounts.iter().map(|acc| acc.clone()).collect();

    invoke_signed(
        &Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts,
            data,
        },
        &account_infos,
        signer_seeds,
    )?;

    ctx.accounts.output_vault.reload()?;
    let balance_after = ctx.accounts.output_vault.amount;
    let mut output_amount = balance_after
        .checked_sub(balance_before)
        .ok_or(ErrorCode::InvalidCalculation)?;

    msg!("Jupiter swap completed. Output amount: {}", output_amount);

    require!(
        ctx.accounts.limit_order.should_execute(output_amount)?,
        ErrorCode::TriggerPriceNotMet
    );

    let mut fee_amount = 0u64;
    let mut fee_account: Option<Pubkey> = None;

    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        require!(
            platform_fee_account.mint == ctx.accounts.output_mint.key(),
            ErrorCode::InvalidPlatformFeeMint
        );
        fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.output_token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.output_vault.to_account_info(),
                        to: platform_fee_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                        mint: ctx.accounts.output_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
                ctx.accounts.output_mint.decimals,
            )?;
            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.output_mint.key(),
                amount: fee_amount,
            });
            fee_account = Some(platform_fee_account.key());
            output_amount = output_amount
                .checked_sub(fee_amount)
                .ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    let min_acceptable = ctx.accounts.limit_order
        .calculate_min_acceptable_output(quoted_out_amount)?;
    require!(
        output_amount >= min_acceptable,
        ErrorCode::SlippageToleranceExceeded
    );

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.output_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.output_vault.to_account_info(),
                to: ctx.accounts.user_destination_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
                mint: ctx.accounts.output_mint.to_account_info(),
            },
            signer_seeds,
        ),
        output_amount,
        ctx.accounts.output_mint.decimals,
    )?;

    ctx.accounts.limit_order.status = OrderStatus::Filled;

    emit_cpi!(LimitOrderExecuted {
        order: ctx.accounts.limit_order.key(),
        executor: ctx.accounts.operator.key(),
        input_amount: in_amount,
        output_amount,
        fee_amount,
        trigger_type: ctx.accounts.limit_order.trigger_type as u8,
        min_output_amount: ctx.accounts.limit_order.min_output_amount,
    });

    emit_cpi!(LimitOrderSwapEvent {
        order: ctx.accounts.limit_order.key(),
        sender: ctx.accounts.limit_order.creator,
        recipient: ctx.accounts.user_destination_token_account.key(),
        executor: ctx.accounts.operator.key(),
        input_mint: ctx.accounts.input_mint.key(),
        output_mint: ctx.accounts.output_mint.key(),
        input_amount: in_amount,
        output_amount,
        fee_amount,
        fee_account,
        trigger_type: ctx.accounts.limit_order.trigger_type as u8,
    });

    close_account(
        CpiContext::new_with_signer(
            ctx.accounts.input_token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.input_vault.to_account_info(),
                destination: ctx.accounts.operator.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
    )?;

    msg!("Shared limit order executed: {}", ctx.accounts.limit_order.key());
    Ok(output_amount)
}
