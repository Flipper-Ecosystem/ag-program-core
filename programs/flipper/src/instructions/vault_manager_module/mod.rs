use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, TokenInterface, TokenAccount, Mint,
    transfer_checked, TransferChecked,
    initialize_account3, InitializeAccount3
};
use anchor_spl::token_2022::ID as TOKEN_2022_PROGRAM_ID;
use crate::errors::ErrorCode;

// Test modules
#[cfg(test)]
mod vault_manager_test;

#[account]
pub struct VaultAuthority {
    pub admin: Pubkey,
    pub bump: u8,
}

#[account]
pub struct GlobalManager {
    pub manager: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct CreateVaultAuthority<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1,
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_vault_authority(ctx: Context<CreateVaultAuthority>) -> Result<()> {
    let vault_authority = &mut ctx.accounts.vault_authority;
    vault_authority.admin = ctx.accounts.admin.key();
    vault_authority.bump = ctx.bumps.vault_authority;

    msg!("Created vault authority: {}", vault_authority.key());
    Ok(())
}

#[derive(Accounts)]
pub struct CreateGlobalManager<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1,
        seeds = [b"global_manager"],
        bump
    )]
    pub global_manager: Account<'info, GlobalManager>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub manager: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_global_manager(ctx: Context<CreateGlobalManager>) -> Result<()> {
    let global_manager = &mut ctx.accounts.global_manager;
    global_manager.manager = ctx.accounts.manager.key();
    global_manager.bump = ctx.bumps.global_manager;

    msg!("Created global manager: {}", global_manager.key());
    Ok(())
}

#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        seeds = [b"adapter_registry"],
        bump = adapter_registry.bump,
    )]
    pub adapter_registry: Account<'info, crate::state::AdapterRegistry>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub creator: Signer<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [b"vault", vault_mint.key().as_ref()],
        bump,
        token::mint = vault_mint,
        token::authority = vault_authority,
        token::token_program = vault_token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub vault_mint: InterfaceAccount<'info, Mint>,
    pub vault_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn create_vault(ctx: Context<CreateVault>) -> Result<()> {
    let adapter_registry = &ctx.accounts.adapter_registry;
    let creator = ctx.accounts.creator.key();
    let vault_authority_admin = ctx.accounts.vault_authority.admin;

    // Check if creator is vault authority admin or an operator
    let is_authorized = creator == vault_authority_admin 
        || adapter_registry.is_authorized_operator(&creator);

    require!(is_authorized, ErrorCode::UnauthorizedVaultCreator);

    msg!("Successfully created vault: {} for mint: {} by {}",
         ctx.accounts.vault.key(),
         ctx.accounts.vault_mint.key(),
         creator);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        seeds = [b"adapter_registry"],
        bump = adapter_registry.bump,
    )]
    pub adapter_registry: Account<'info, crate::state::AdapterRegistry>,

    #[account(
        mut,
        constraint = vault.owner == vault_authority.key() @ ErrorCode::InvalidVaultOwner,
        constraint = vault.amount == 0 @ ErrorCode::VaultNotEmpty,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    /// CHECK: validated by code
    pub destination: AccountInfo<'info>,

    pub closer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
    let adapter_registry = &ctx.accounts.adapter_registry;
    let closer = ctx.accounts.closer.key();
    let vault_authority_admin = ctx.accounts.vault_authority.admin;

    // Check if closer is vault authority admin or an operator
    let is_authorized = closer == vault_authority_admin 
        || adapter_registry.is_authorized_operator(&closer);

    require!(is_authorized, ErrorCode::UnauthorizedVaultCreator);

    let vault_authority_bump = ctx.accounts.vault_authority.bump;

    let authority_seeds = [
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds = &[&authority_seeds[..]];

    let close_account_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        anchor_spl::token_interface::CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        signer_seeds,
    );

    anchor_spl::token_interface::close_account(close_account_ctx)?;

    msg!("Successfully closed vault: {} by {}", ctx.accounts.vault.key(), closer);
    Ok(())
}

pub fn initialize_vaults(ctx: Context<InitializeVaults>) -> Result<()> {
    let adapter_registry = &ctx.accounts.adapter_registry;
    let creator = ctx.accounts.creator.key();
    let vault_authority_admin = ctx.accounts.vault_authority.admin;

    // Check if creator is vault authority admin or an operator
    let is_authorized = creator == vault_authority_admin 
        || adapter_registry.is_authorized_operator(&creator);

    require!(is_authorized, ErrorCode::UnauthorizedVaultCreator);

    msg!("Vaults initialized successfully by {}", creator);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeVaults<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        seeds = [b"adapter_registry"],
        bump = adapter_registry.bump,
    )]
    pub adapter_registry: Account<'info, crate::state::AdapterRegistry>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub creator: Signer<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [b"vault", source_mint.key().as_ref()],
        bump,
        token::mint = source_mint,
        token::authority = vault_authority,
        token::token_program = source_token_program,
    )]
    pub input_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        seeds = [b"vault", destination_mint.key().as_ref()],
        bump,
        token::mint = destination_mint,
        token::authority = vault_authority,
        token::token_program = destination_token_program,
    )]
    pub output_vault: InterfaceAccount<'info, TokenAccount>,

    pub source_mint: InterfaceAccount<'info, Mint>,
    pub destination_mint: InterfaceAccount<'info, Mint>,
    pub source_token_program: Interface<'info, TokenInterface>,
    pub destination_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ChangeVaultAuthorityAdmin<'info> {
    #[account(
        mut,
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        seeds = [b"global_manager"],
        bump = global_manager.bump,
        constraint = global_manager.manager != Pubkey::default() @ ErrorCode::GlobalManagerNotInitialized,
        constraint = global_manager.manager == manager.key() @ ErrorCode::UnauthorizedGlobalManager
    )]
    pub global_manager: Account<'info, GlobalManager>,

    pub manager: Signer<'info>,

    ///CHECK: will be trusted
    pub new_admin: AccountInfo<'info>,
}

pub fn change_vault_authority_admin(ctx: Context<ChangeVaultAuthorityAdmin>) -> Result<()> {
    let vault_authority = &mut ctx.accounts.vault_authority;
    let old_admin = vault_authority.admin;
    vault_authority.admin = ctx.accounts.new_admin.key();

    emit!(crate::state::VaultAuthorityAdminChanged {
        old_admin,
        new_admin: ctx.accounts.new_admin.key(),
        changed_by: ctx.accounts.manager.key(),
    });

    msg!("Changed vault authority admin from {} to {} by global manager {}", 
         old_admin, 
         vault_authority.admin,
         ctx.accounts.manager.key());
    Ok(())
}

pub fn get_vault_address(mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"vault", mint.as_ref()],
        program_id,
    )
}

pub fn get_vault_authority_address(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"vault_authority"],
        program_id,
    )
}

pub fn get_global_manager_address(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"global_manager"],
        program_id,
    )
}

#[derive(Accounts)]
pub struct ChangeGlobalManager<'info> {
    #[account(
        mut,
        seeds = [b"global_manager"],
        bump = global_manager.bump,
        constraint = global_manager.manager != Pubkey::default() @ ErrorCode::GlobalManagerNotInitialized,
        constraint = global_manager.manager == current_manager.key() @ ErrorCode::UnauthorizedGlobalManager
    )]
    pub global_manager: Account<'info, GlobalManager>,

    pub current_manager: Signer<'info>,

    ///CHECK: will be trusted
    pub new_manager: AccountInfo<'info>,
}

pub fn change_global_manager(ctx: Context<ChangeGlobalManager>) -> Result<()> {
    let global_manager = &mut ctx.accounts.global_manager;
    let old_manager = global_manager.manager;
    global_manager.manager = ctx.accounts.new_manager.key();

    emit!(crate::state::GlobalManagerChanged {
        old_manager,
        new_manager: ctx.accounts.new_manager.key(),
    });

    msg!("Changed global manager from {} to {}", 
         old_manager, 
         global_manager.manager);
    Ok(())
}

pub fn vault_exists(
    remaining_accounts: &[AccountInfo],
    mint: &Pubkey,
    program_id: &Pubkey,
) -> bool {
    let (vault_address, _) = get_vault_address(mint, program_id);
    remaining_accounts
        .iter()
        .any(|account| account.key() == vault_address)
}

#[derive(Accounts)]
pub struct WithdrawPlatformFees<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        seeds = [b"global_manager"],
        bump = global_manager.bump,
        constraint = global_manager.manager != Pubkey::default() @ ErrorCode::GlobalManagerNotInitialized,
        constraint = global_manager.manager == manager.key() @ ErrorCode::UnauthorizedGlobalManager
    )]
    pub global_manager: Account<'info, GlobalManager>,

    #[account(
        mut,
        constraint = platform_fee_account.owner == vault_authority.key() @ ErrorCode::InvalidPlatformFeeOwner,
        constraint = platform_fee_account.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub platform_fee_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = destination.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub manager: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_platform_fees(ctx: Context<WithdrawPlatformFees>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Err(ErrorCode::InvalidAmount.into());
    }

    let vault_authority_bump = ctx.accounts.vault_authority.bump;
    let authority_seeds = [
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds = &[&authority_seeds[..]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.platform_fee_account.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    msg!("Global manager {} withdrew {} tokens from platform fee account to {}", 
         ctx.accounts.manager.key(),
         amount, 
         ctx.accounts.destination.key());
    Ok(())
}

/// Creates a vault for Token 2022 tokens with extensions
/// This instruction supports tokens with extensions like:
/// - metadataPointer
/// - permanentDelegate
/// - defaultAccountState
/// - scaledUiAmountConfig
/// - pausableConfig
/// - confidentialTransferMint
/// - transferHook
/// - tokenMetadata
/// 
/// The account_space parameter should include the size of all extensions.
/// For xstocks tokens with the provided extensions, typical size is around 300-400 bytes.
#[derive(Accounts)]
#[instruction(account_space: u16)]
pub struct CreateVaultWithExtensions<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        seeds = [b"adapter_registry"],
        bump = adapter_registry.bump,
    )]
    pub adapter_registry: Account<'info, crate::state::AdapterRegistry>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub creator: Signer<'info>,

    /// CHECK: The vault account will be initialized by this instruction
    #[account(mut)]
    pub vault: AccountInfo<'info>,

    #[account(
        constraint = vault_mint.to_account_info().owner == &vault_token_program.key() @ ErrorCode::InvalidCpiInterface
    )]
    pub vault_mint: InterfaceAccount<'info, Mint>,
    pub vault_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_vault_with_extensions(ctx: Context<CreateVaultWithExtensions>, account_space: u16) -> Result<()> {
    let adapter_registry = &ctx.accounts.adapter_registry;
    let creator = ctx.accounts.creator.key();
    let vault_authority_admin = ctx.accounts.vault_authority.admin;

    // Check if creator is vault authority admin or an operator
    let is_authorized = creator == vault_authority_admin 
        || adapter_registry.is_authorized_operator(&creator);

    require!(is_authorized, ErrorCode::UnauthorizedVaultCreator);

    // Verify that we're using Token 2022 program
    require!(
        ctx.accounts.vault_token_program.key() == TOKEN_2022_PROGRAM_ID,
        ErrorCode::InvalidCpiInterface
    );

    // Derive vault PDA
    let mint_key = ctx.accounts.vault_mint.key();
    let (vault_pda, vault_bump) = Pubkey::find_program_address(
        &[b"vault", mint_key.as_ref()],
        ctx.program_id,
    );

    require!(
        ctx.accounts.vault.key() == vault_pda,
        ErrorCode::InvalidVaultAddress
    );

    // Calculate the required account size
    // Base token account size is 165 bytes
    // Extensions add additional space
    let base_size: usize = 165;
    let extension_size: usize = account_space as usize;
    let total_size = base_size + extension_size;

    // Create the account first
    let vault_authority_bump = ctx.accounts.vault_authority.bump;
    let mint_key_bytes = mint_key.as_ref();
    let vault_seeds = [
        b"vault",
        mint_key_bytes,
        &[vault_bump],
    ];

    anchor_lang::solana_program::program::invoke_signed(
        &anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.payer.key(),
            &ctx.accounts.vault.key(),
            ctx.accounts.rent.minimum_balance(total_size),
            total_size as u64,
            &ctx.accounts.vault_token_program.key(),
        ),
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[&vault_seeds],
    )?;

    // Initialize the token account with extensions
    let authority_seeds = [
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds = &[&authority_seeds[..]];

    let initialize_ctx = CpiContext::new_with_signer(
        ctx.accounts.vault_token_program.to_account_info(),
        InitializeAccount3 {
            account: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.vault_mint.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        signer_seeds,
    );

    initialize_account3(initialize_ctx)?;

    msg!(
        "Successfully created vault with extensions: {} for mint: {} (space: {} bytes) by {}",
        ctx.accounts.vault.key(),
        ctx.accounts.vault_mint.key(),
        total_size,
        creator
    );
    Ok(())
}