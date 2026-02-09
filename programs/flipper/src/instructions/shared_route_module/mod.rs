use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use anchor_spl::token_interface::{
    Mint, TokenAccount, TokenInterface,
    transfer_checked, TransferChecked
};
use crate::errors::ErrorCode;
use crate::state::*;
use crate::instructions::vault_manager_module::VaultAuthority;
use crate::instructions::limit_orders_module::{LimitOrder, OrderStatus, TriggerType};

/// Jupiter shared_accounts_route fixed account indices (must match Jupiter IDL order).
/// 0: token_program
/// 1: program_authority (Jupiter PDA - not ours!)
/// 2: user_transfer_authority  <-- Must match our vault_authority (we sign for this)
/// 3: user_source_token_account  <-- Must match our vault_source
/// 4: program_source_token_account (Jupiter's intermediate account)
/// 5: program_destination_token_account (Jupiter's intermediate account)
/// 6: user_destination_token_account  <-- Must match our vault_destination
/// 7-12: source_mint, destination_mint, platform_fee, token2022, event_authority, program
const JUPITER_USER_TRANSFER_AUTHORITY_INDEX: usize = 2;
const JUPITER_USER_SOURCE_INDEX: usize = 3;
const JUPITER_USER_DESTINATION_INDEX: usize = 6;
const JUPITER_MIN_ACCOUNTS: usize = 13; // 0..=12: token_program, program_authority, ..., program

/// Shared route instruction for Jupiter CPI-based swaps
/// All swaps now go through vault-first approach using Jupiter CPI
///
/// Uses the same approach as Jupiter CPI example: client passes pre-built Jupiter
/// instruction `data` and all Jupiter accounts in `remaining_accounts`. We validate
/// that program_authority, program_source_token_account, program_destination_token_account
/// in remaining_accounts match our vault_authority, vault_source, vault_destination.
#[event_cpi]
#[derive(Accounts)]
pub struct SharedRoute<'info> {
    /// Vault authority PDA controlling all vaults
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// User's source account for input tokens
    #[account(
        mut,
        constraint = user_source_token_account.mint == source_mint.key() @ ErrorCode::InvalidMint,
        constraint = user_source_token_account.owner == user_transfer_authority.key() @ ErrorCode::InvalidAccount
    )]
    pub user_source_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's destination account for output tokens
    #[account(
        mut,
        constraint = user_destination_token_account.mint == destination_mint.key() @ ErrorCode::InvalidMint,
        constraint = user_destination_token_account.owner == user_transfer_authority.key() @ ErrorCode::InvalidAccount
    )]
    pub user_destination_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Source vault (input tokens) - PDA derived from ["vault", source_mint]
    #[account(
        mut,
        seeds = [b"vault", source_mint.key().as_ref()],
        bump,
        constraint = vault_source.mint == source_mint.key() @ ErrorCode::InvalidMint,
        constraint = vault_source.owner == vault_authority.key() @ ErrorCode::InvalidVaultOwner
    )]
    pub vault_source: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Destination vault (output tokens) - PDA derived from ["vault", destination_mint]
    #[account(
        mut,
        seeds = [b"vault", destination_mint.key().as_ref()],
        bump,
        constraint = vault_destination.mint == destination_mint.key() @ ErrorCode::InvalidMint,
        constraint = vault_destination.owner == vault_authority.key() @ ErrorCode::InvalidVaultOwner
    )]
    pub vault_destination: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Source mint
    pub source_mint: Box<InterfaceAccount<'info, Mint>>,
    
    /// Destination mint
    pub destination_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token program for source tokens
    pub input_token_program: Interface<'info, TokenInterface>,
    
    /// Token program for destination tokens (Token-2022 support)
    pub output_token_program: Interface<'info, TokenInterface>,

    /// User/operator initiating the swap
    pub user_transfer_authority: Signer<'info>,

    /// Optional platform fee collection account
    #[account(mut)]
    pub platform_fee_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// Jupiter program for CPI swap
    /// CHECK: Jupiter program ID will be validated in the CPI call
    pub jupiter_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    
    // Note: event_authority is automatically added by #[event_cpi] macro
}

/// Executes a Jupiter CPI swap via shared_accounts_route.
/// Client passes Jupiter instruction `data` (from swap-instructions API) and all Jupiter
/// accounts in `remaining_accounts`. We validate that vault-related accounts match our context.
///
/// # Arguments
/// * `in_amount` - Input token amount (for user->vault transfer)
/// * `quoted_out_amount` - Expected output amount from Jupiter quote (same as route)
/// * `slippage_bps` - Slippage tolerance in basis points (same as route)
/// * `platform_fee_bps` - Platform fee in basis points
/// * `data` - Serialized Jupiter shared_accounts_route instruction data (from API) - LAST to avoid Borsh deserialization issues
pub fn shared_route<'info>(
    ctx: Context<'_, '_, 'info, 'info, SharedRoute<'info>>,
    in_amount: u64,
    quoted_out_amount: u64,
    slippage_bps: u16,
    platform_fee_bps: u8,
    data: Vec<u8>,
) -> Result<u64> {
    require!(in_amount > 0, ErrorCode::InvalidAmount);
    require!(quoted_out_amount > 0, ErrorCode::InvalidAmount);
    require!(slippage_bps <= 10_000, ErrorCode::InvalidSlippage);
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
    // Validate that user_source (index 3) is our vault_source
    require!(
        ctx.remaining_accounts[JUPITER_USER_SOURCE_INDEX].key() == ctx.accounts.vault_source.key(),
        ErrorCode::JupiterProgramSourceMismatch
    );
    // Validate that user_destination (index 6) is our vault_destination
    require!(
        ctx.remaining_accounts[JUPITER_USER_DESTINATION_INDEX].key() == ctx.accounts.vault_destination.key(),
        ErrorCode::JupiterProgramDestinationMismatch
    );

    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        require!(
            platform_fee_account.owner == ctx.accounts.vault_authority.key(),
            ErrorCode::InvalidPlatformFeeOwner
        );
        require!(
            platform_fee_account.mint == ctx.accounts.destination_mint.key(),
            ErrorCode::InvalidPlatformFeeMint
        );
    }

    // Transfer tokens from user to vault_source
    transfer_checked(
        CpiContext::new(
            ctx.accounts.input_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_source_token_account.to_account_info(),
                to: ctx.accounts.vault_source.to_account_info(),
                authority: ctx.accounts.user_transfer_authority.to_account_info(),
                mint: ctx.accounts.source_mint.to_account_info(),
            },
        ),
        in_amount,
        ctx.accounts.source_mint.decimals,
    )?;

    ctx.accounts.vault_destination.reload()?;
    let dest_balance_before = ctx.accounts.vault_destination.amount;

    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[b"vault_authority".as_ref(), &[vault_authority_bump]];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Build account metas from remaining_accounts
    // user_transfer_authority (index 2) must be signer (PDA via invoke_signed)
    // Also preserve is_signer flag for accounts that were signers in original tx (e.g., mock_pool_authority)
    let accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta> = ctx
        .remaining_accounts
        .iter()
        .enumerate()
        .map(|(idx, acc)| {
            // Index 2 will be signed by PDA, OR keep original signer status
            let is_signer = idx == JUPITER_USER_TRANSFER_AUTHORITY_INDEX || acc.is_signer;
            anchor_lang::solana_program::instruction::AccountMeta {
                pubkey: *acc.key,
                is_signer,
                is_writable: acc.is_writable,
            }
        })
        .collect();

    let account_infos: Vec<AccountInfo> = ctx
        .remaining_accounts
        .iter()
        .map(|acc| acc.clone())
        .collect();

    // Build proper instruction data for Jupiter CPI:
    // Jupiter shared_accounts_route expects: discriminator (8) + Vec<u8> length (4) + Vec<u8> bytes
    // Our `data` param now contains properly formatted instruction data from client
    let jupiter_instruction_data = data;

    invoke_signed(
        &Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts,
            data: jupiter_instruction_data,
        },
        &account_infos,
        signer_seeds,
    )?;

    ctx.accounts.vault_destination.reload()?;
    let dest_balance_after = ctx.accounts.vault_destination.amount;
    let mut output_amount = dest_balance_after
        .checked_sub(dest_balance_before)
        .ok_or(ErrorCode::InvalidCalculation)?;

    msg!("Jupiter swap completed. Output amount: {}", output_amount);

    let mut fee_amount = 0u64;
    let mut fee_account: Option<Pubkey> = None;

    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        fee_amount = (output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.output_token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault_destination.to_account_info(),
                        to: platform_fee_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                        mint: ctx.accounts.destination_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
                ctx.accounts.destination_mint.decimals,
            )?;
            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.destination_mint.key(),
                amount: fee_amount,
            });
            fee_account = Some(platform_fee_account.key());
            output_amount = output_amount
                .checked_sub(fee_amount)
                .ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    let min_out_amount = (quoted_out_amount as u128)
        .checked_mul(
            (10_000u128)
                .checked_sub(slippage_bps as u128)
                .ok_or(ErrorCode::InvalidCalculation)?
        )
        .ok_or(ErrorCode::InvalidCalculation)?
        .checked_div(10_000)
        .ok_or(ErrorCode::InvalidCalculation)? as u64;
    require!(
        output_amount >= min_out_amount,
        ErrorCode::SlippageToleranceExceeded
    );

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.output_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_destination.to_account_info(),
                to: ctx.accounts.user_destination_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
                mint: ctx.accounts.destination_mint.to_account_info(),
            },
            signer_seeds,
        ),
        output_amount,
        ctx.accounts.destination_mint.decimals,
    )?;

    emit_cpi!(RouterSwapEvent {
        sender: ctx.accounts.user_transfer_authority.key(),
        recipient: ctx.accounts.user_destination_token_account.key(),
        input_mint: ctx.accounts.source_mint.key(),
        output_mint: ctx.accounts.destination_mint.key(),
        input_amount: in_amount,
        output_amount,
        fee_amount,
        fee_account,
        slippage_bps,
    });

    msg!("Shared route completed. Final output: {}", output_amount);
    Ok(output_amount)
}

/// Shared route and create order instruction accounts
/// Combines Jupiter CPI swap with limit order creation
#[event_cpi]
#[derive(Accounts)]
#[instruction(order_nonce: u64)]
pub struct SharedRouteAndCreateOrder<'info> {
    /// Vault authority PDA controlling all vaults
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Limit order account (must be initialized separately using init_limit_order)
    #[account(
        mut,
        seeds = [b"limit_order", creator.key().as_ref(), order_nonce.to_le_bytes().as_ref()],
        bump = limit_order.bump,
        constraint = limit_order.status == OrderStatus::Init @ ErrorCode::InvalidOrderStatus
    )]
    pub limit_order: Account<'info, LimitOrder>,

    /// User's source account for swap input tokens
    #[account(
        mut,
        constraint = user_input_account.mint == swap_input_mint.key(),
        constraint = user_input_account.owner == creator.key()
    )]
    pub user_input_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's destination account for final order output tokens (swap input token)
    #[account(
        constraint = user_destination_account.mint == swap_input_mint.key(),
        constraint = user_destination_account.owner == creator.key()
    )]
    pub user_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Source vault for Jupiter swap (temporary swap input) - PDA derived from ["vault", swap_input_mint]
    #[account(
        mut,
        seeds = [b"vault", swap_input_mint.key().as_ref()],
        bump,
        constraint = swap_source_vault.mint == swap_input_mint.key() @ ErrorCode::InvalidMint,
        constraint = swap_source_vault.owner == vault_authority.key() @ ErrorCode::InvalidVaultOwner
    )]
    pub swap_source_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Destination vault for Jupiter swap output (becomes order input vault)
    /// Must be created separately using init_limit_order for tokens with extensions
    /// This is typically an order_vault PDA (["order_vault", limitOrder]), not a regular vault
    #[account(
        mut,
        constraint = swap_destination_vault.mint == swap_output_mint.key() @ ErrorCode::InvalidMint,
        constraint = swap_destination_vault.owner == vault_authority.key() @ ErrorCode::InvalidVaultOwner,
        constraint = swap_destination_vault.key() == limit_order.input_vault @ ErrorCode::InvalidVaultAddress
    )]
    pub swap_destination_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Swap input token mint
    pub swap_input_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Swap output token mint (becomes order input mint)
    pub swap_output_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token program for swap input tokens
    pub input_token_program: Interface<'info, TokenInterface>,

    /// Token program for swap/order output tokens
    pub output_token_program: Interface<'info, TokenInterface>,

    /// Optional platform fee collection account
    #[account(mut)]
    pub platform_fee_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// Jupiter program for CPI swap
    /// CHECK: Jupiter program ID will be validated in the CPI call
    pub jupiter_program: AccountInfo<'info>,

    /// Order creator (must sign)
    #[account(mut, signer)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,

    // Note: event_authority is automatically added by #[event_cpi] macro
}

/// Executes a Jupiter CPI swap and creates a limit order. Uses same CPI pattern: `data` + `remaining_accounts`.
/// Same parameter style as route_and_create_order: quoted_out_amount + slippage_bps for the swap.
pub fn shared_route_and_create_order<'info>(
    ctx: Context<'_, '_, 'info, 'info, SharedRouteAndCreateOrder<'info>>,
    order_nonce: u64,
    swap_in_amount: u64,
    swap_quoted_out_amount: u64,
    swap_slippage_bps: u16,
    platform_fee_bps: u8,
    order_min_output_amount: u64,
    order_trigger_price_bps: u32,
    order_expiry: i64,
    order_slippage_bps: u16,
    data: Vec<u8>,
) -> Result<(u64, Pubkey)> {
    require!(swap_in_amount > 0, ErrorCode::InvalidAmount);
    require!(swap_quoted_out_amount > 0, ErrorCode::InvalidAmount);
    require!(swap_slippage_bps <= 10_000, ErrorCode::InvalidSlippage);
    require!(!data.is_empty(), ErrorCode::EmptyRoute);

    // Validate Jupiter program matches the one stored in vault_authority
    require!(
        ctx.accounts.jupiter_program.key() == ctx.accounts.vault_authority.jupiter_program_id,
        ErrorCode::InvalidJupiterProgram
    );

    require!(order_min_output_amount > 0, ErrorCode::InvalidAmount);
    require!(
        order_trigger_price_bps > 0 && order_trigger_price_bps <= 100_000,
        ErrorCode::InvalidTriggerPrice
    );
    require!(
        order_expiry > Clock::get()?.unix_timestamp,
        ErrorCode::InvalidExpiry
    );
    require!(order_slippage_bps <= 10_000, ErrorCode::InvalidSlippage);
    require!(
        ctx.accounts.limit_order.creator == ctx.accounts.creator.key(),
        ErrorCode::UnauthorizedAdmin
    );
    require!(
        ctx.accounts.swap_destination_vault.key() == ctx.accounts.limit_order.input_vault,
        ErrorCode::InvalidVaultAddress
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
    // Validate that user_source (index 3) is our swap_source_vault
    require!(
        ctx.remaining_accounts[JUPITER_USER_SOURCE_INDEX].key() == ctx.accounts.swap_source_vault.key(),
        ErrorCode::JupiterProgramSourceMismatch
    );
    // Validate that user_destination (index 6) is our swap_destination_vault
    require!(
        ctx.remaining_accounts[JUPITER_USER_DESTINATION_INDEX].key() == ctx.accounts.swap_destination_vault.key(),
        ErrorCode::JupiterProgramDestinationMismatch
    );

    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        require!(
            platform_fee_account.owner == ctx.accounts.vault_authority.key(),
            ErrorCode::InvalidPlatformFeeOwner
        );
        require!(
            platform_fee_account.mint == ctx.accounts.swap_output_mint.key(),
            ErrorCode::InvalidPlatformFeeMint
        );
    }

    transfer_checked(
        CpiContext::new(
            ctx.accounts.input_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_input_account.to_account_info(),
                to: ctx.accounts.swap_source_vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
                mint: ctx.accounts.swap_input_mint.to_account_info(),
            },
        ),
        swap_in_amount,
        ctx.accounts.swap_input_mint.decimals,
    )?;

    ctx.accounts.swap_destination_vault.reload()?;
    let dest_balance_before = ctx.accounts.swap_destination_vault.amount;

    let vault_authority_bump = ctx.bumps.vault_authority;
    let authority_seeds: &[&[u8]] = &[b"vault_authority".as_ref(), &[vault_authority_bump]];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

    // Build account metas from remaining_accounts
    // user_transfer_authority (index 2) must be signer (PDA via invoke_signed)
    // Also preserve is_signer flag for accounts that were signers in original tx
    let accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta> = ctx
        .remaining_accounts
        .iter()
        .enumerate()
        .map(|(idx, acc)| {
            // Index 2 will be signed by PDA, OR keep original signer status
            let is_signer = idx == JUPITER_USER_TRANSFER_AUTHORITY_INDEX || acc.is_signer;
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

    ctx.accounts.swap_destination_vault.reload()?;
    let dest_balance_after = ctx.accounts.swap_destination_vault.amount;
    let mut swap_output_amount = dest_balance_after
        .checked_sub(dest_balance_before)
        .ok_or(ErrorCode::InvalidCalculation)?;

    msg!("Jupiter swap completed. Output amount: {}", swap_output_amount);

    let mut fee_amount = 0u64;
    let mut fee_account: Option<Pubkey> = None;
    if let Some(platform_fee_account) = &ctx.accounts.platform_fee_account {
        fee_amount = (swap_output_amount as u128 * platform_fee_bps as u128 / 10_000) as u64;
        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.output_token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.swap_destination_vault.to_account_info(),
                        to: platform_fee_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                        mint: ctx.accounts.swap_output_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
                ctx.accounts.swap_output_mint.decimals,
            )?;
            emit_cpi!(FeeEvent {
                account: platform_fee_account.key(),
                mint: ctx.accounts.swap_output_mint.key(),
                amount: fee_amount,
            });
            fee_account = Some(platform_fee_account.key());
            swap_output_amount = swap_output_amount
                .checked_sub(fee_amount)
                .ok_or(ErrorCode::InvalidCalculation)?;
        }
    }

    let min_swap_out_amount = (swap_quoted_out_amount as u128)
        .checked_mul(
            (10_000u128)
                .checked_sub(swap_slippage_bps as u128)
                .ok_or(ErrorCode::InvalidCalculation)?
        )
        .ok_or(ErrorCode::InvalidCalculation)?
        .checked_div(10_000)
        .ok_or(ErrorCode::InvalidCalculation)? as u64;
    require!(
        swap_output_amount >= min_swap_out_amount,
        ErrorCode::SlippageToleranceExceeded
    );

    emit_cpi!(RouterSwapEvent {
        sender: ctx.accounts.creator.key(),
        recipient: ctx.accounts.swap_destination_vault.key(),
        input_mint: ctx.accounts.swap_input_mint.key(),
        output_mint: ctx.accounts.swap_output_mint.key(),
        input_amount: swap_in_amount,
        output_amount: swap_output_amount,
        fee_amount,
        fee_account,
        slippage_bps: swap_slippage_bps,
    });

    let order = &mut ctx.accounts.limit_order;
    order.input_mint = ctx.accounts.swap_output_mint.key();
    order.output_mint = ctx.accounts.swap_input_mint.key();
    order.user_destination_account = ctx.accounts.user_destination_account.key();
    order.input_amount = swap_output_amount;
    order.min_output_amount = order_min_output_amount;
    order.trigger_price_bps = order_trigger_price_bps;
    order.trigger_type = TriggerType::TakeProfit;
    order.expiry = order_expiry;
    order.status = OrderStatus::Open;
    order.slippage_bps = order_slippage_bps;

    let order_key = order.key();

    emit_cpi!(LimitOrderCreated {
        order: order_key,
        creator: order.creator,
        input_mint: order.input_mint,
        output_mint: order.output_mint,
        input_amount: order.input_amount,
        min_output_amount: order.min_output_amount,
        trigger_price_bps: order.trigger_price_bps,
        trigger_type: order.trigger_type as u8,
        expiry: order.expiry,
    });

    emit_cpi!(RouteAndCreateOrderEvent {
        order: order_key,
        swap_input_mint: ctx.accounts.swap_input_mint.key(),
        swap_input_amount: swap_in_amount,
        swap_output_amount,
        fee_amount,
        order_input_amount: swap_output_amount,
    });

    msg!("Shared route and create order completed. Order: {}", order_key);
    Ok((swap_output_amount, order_key))
}

