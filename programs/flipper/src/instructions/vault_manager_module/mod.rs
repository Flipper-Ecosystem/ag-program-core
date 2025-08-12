use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use crate::errors::ErrorCode;


/// Data structure for vault authority
#[account]
pub struct VaultAuthority {
    pub admin: Pubkey, // Admin who can close vaults and change the admin
    pub bump: u8,     // Bump for the PDA
}

/// Accounts for creating the vault authority
#[derive(Accounts)]
pub struct CreateVaultAuthority<'info> {
    /// Vault authority PDA to be created
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1, // discriminator (8) + admin Pubkey (32) + bump (1)
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Who pays for vault authority creation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Admin who will be set in the vault authority
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Creates the vault authority PDA
pub fn create_vault_authority(ctx: Context<CreateVaultAuthority>) -> Result<()> {
    let vault_authority = &mut ctx.accounts.vault_authority;
    vault_authority.admin = ctx.accounts.admin.key();
    vault_authority.bump = ctx.bumps.vault_authority;

    msg!("Created vault authority: {}", vault_authority.key());
    Ok(())
}

/// Accounts for creating a new vault
#[derive(Accounts)]
pub struct CreateVault<'info> {
    /// Vault authority PDA
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Mint for which we're creating the vault
    pub mint: Account<'info, Mint>,

    /// Token account that will become the vault (created via CPI)
    /// CHECK: Will be created via CPI to anchor_spl::token
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    /// Who pays for vault creation
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Creates a new vault token account via CPI
pub fn create_vault(ctx: Context<CreateVault>) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();

    msg!("Creating vault for mint: {}", mint_key);

    // Get bumps for PDAs
    let vault_authority_bump = ctx.accounts.vault_authority.bump;
    let vault_bump = ctx.bumps.vault;

    // Seeds for vault_authority (which will be the owner)
    let authority_seeds = [
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let authority_signer_seeds = [&authority_seeds[..]];

    // Seeds for vault account
    let vault_seeds = [
        b"vault".as_ref(),
        mint_key.as_ref(),
        &[vault_bump],
    ];
    let vault_signer_seeds = [&vault_seeds[..]];

    // Create vault account via CPI to System Program
    let create_account_ix = anchor_lang::solana_program::system_instruction::create_account(
        &ctx.accounts.payer.key(),
        &ctx.accounts.vault.key(),
        ctx.accounts.rent.minimum_balance(TokenAccount::LEN),
        TokenAccount::LEN as u64,
        &ctx.accounts.token_program.key(),
    );

    anchor_lang::solana_program::program::invoke_signed(
        &create_account_ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &vault_signer_seeds, // Sign with vault PDA
    )?;

    // Initialize token account via CPI to Token Program
    let initialize_account_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::InitializeAccount {
            account: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        },
        &authority_signer_seeds, // Sign with authority PDA
    );

    token::initialize_account(initialize_account_ctx)?;

    msg!("Successfully created vault: {}", ctx.accounts.vault.key());

    Ok(())
}

/// Accounts for closing a vault
#[derive(Accounts)]
pub struct CloseVault<'info> {
    /// Vault authority PDA
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
        constraint = vault_authority.admin == admin.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Vault token account to close
    #[account(
        mut,
        constraint = vault.owner == vault_authority.key() @ ErrorCode::InvalidVaultOwner,
        constraint = vault.amount == 0 @ ErrorCode::VaultNotEmpty,
        close = destination
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Where to send the rent refund
    /// CHECK: destination account
    #[account(mut)]
    pub destination: AccountInfo<'info>,

    /// Admin who can close vaults
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

/// Closes an empty vault and returns rent
pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
    let vault_authority_bump = ctx.accounts.vault_authority.bump;

    let authority_seeds = [
        b"vault_authority".as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds = [&authority_seeds[..]];

    // Close vault via CPI
    let close_account_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        &signer_seeds,
    );

    token::close_account(close_account_ctx)?;

    msg!("Successfully closed vault: {}", ctx.accounts.vault.key());
    Ok(())
}

pub fn initialize_vaults(ctx: Context<InitializeVaults>) -> Result<()> {
    msg!("Vaults initialized successfully");
    Ok(())
}

/// Initializes input and output vaults owned by the vault_authority PDA.
#[derive(Accounts)]
pub struct InitializeVaults<'info> {
    /// CHECK: This is a PDA used as authority for token accounts
    #[account(
        seeds = [b"vault_authority"],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [b"vault", source_mint.key().as_ref()],
        bump,
        token::mint = source_mint,
        token::authority = vault_authority,
    )]
    pub input_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        seeds = [b"vault", destination_mint.key().as_ref()],
        bump,
        token::mint = destination_mint,
        token::authority = vault_authority,
    )]
    pub output_vault: Account<'info, TokenAccount>,

    pub source_mint: Account<'info, Mint>,
    pub destination_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}


/// Accounts for changing the vault authority admin
#[derive(Accounts)]
pub struct ChangeVaultAuthorityAdmin<'info> {
    /// Vault authority PDA
    #[account(
        mut,
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
        constraint = vault_authority.admin == current_admin.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// Current admin who authorizes the change
    pub current_admin: Signer<'info>,

    /// New admin to set
    /// CHECK new admin
    pub new_admin: AccountInfo<'info>,
}

/// Changes the admin of the vault authority
pub fn change_vault_authority_admin(ctx: Context<ChangeVaultAuthorityAdmin>) -> Result<()> {
    let vault_authority = &mut ctx.accounts.vault_authority;
    vault_authority.admin = ctx.accounts.new_admin.key();

    msg!("Changed vault authority admin to: {}", vault_authority.admin);
    Ok(())
}

/// Get vault PDA address for a mint
pub fn get_vault_address(mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"vault", mint.as_ref()],
        program_id,
    )
}

/// Get vault_authority address
pub fn get_vault_authority_address(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"vault_authority"],
        program_id,
    )
}

/// Check if vault exists for a mint
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