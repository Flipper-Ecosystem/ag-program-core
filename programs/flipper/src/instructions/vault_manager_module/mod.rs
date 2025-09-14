use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, TokenInterface, TokenAccount, Mint,
    transfer_checked, TransferChecked,
    initialize_account3, InitializeAccount3
};
use crate::errors::ErrorCode;

#[account]
pub struct VaultAuthority {
    pub admin: Pubkey,
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
pub struct CreateVault<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
        constraint = vault_authority.admin == admin.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub admin: Signer<'info>,

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
    msg!("Successfully created vault: {} for mint: {}",
         ctx.accounts.vault.key(),
         ctx.accounts.vault_mint.key());
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
        constraint = vault_authority.admin == admin.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        mut,
        constraint = vault.owner == vault_authority.key() @ ErrorCode::InvalidVaultOwner,
        constraint = vault.amount == 0 @ ErrorCode::VaultNotEmpty,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    /// CHECK: validated by code
    pub destination: AccountInfo<'info>,

    pub admin: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
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

    msg!("Successfully closed vault: {}", ctx.accounts.vault.key());
    Ok(())
}

pub fn initialize_vaults(ctx: Context<InitializeVaults>) -> Result<()> {
    msg!("Vaults initialized successfully");
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeVaults<'info> {
    #[account(
        seeds = [b"vault_authority"],
        bump = vault_authority.bump,
        constraint = vault_authority.admin != Pubkey::default() @ ErrorCode::VaultAuthorityNotInitialized,
        constraint = vault_authority.admin == admin.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub admin: Signer<'info>,

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
        constraint = vault_authority.admin == current_admin.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    pub current_admin: Signer<'info>,

    ///CHECK: will be trusted
    pub new_admin: AccountInfo<'info>,
}

pub fn change_vault_authority_admin(ctx: Context<ChangeVaultAuthorityAdmin>) -> Result<()> {
    let vault_authority = &mut ctx.accounts.vault_authority;
    vault_authority.admin = ctx.accounts.new_admin.key();

    msg!("Changed vault authority admin to: {}", vault_authority.admin);
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
        constraint = vault_authority.admin == admin.key() @ ErrorCode::UnauthorizedAdmin
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

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
    pub admin: Signer<'info>,
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
        ctx.accounts.mint.decimals, // Теперь используем decimals из mint аккаунта
    )?;

    msg!("Withdrew {} tokens from platform fee account to {}", amount, ctx.accounts.destination.key());
    Ok(())
}