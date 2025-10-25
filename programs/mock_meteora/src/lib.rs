use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface, transfer_checked, TransferChecked},
};

declare_id!("699YWVLRa4T5Mxs3iNJGnpwP24JNckt25vW1pEMc5xrA");

#[program]
pub mod mock_meteora_swap {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        initial_token_x_amount: u64,
        initial_token_y_amount: u64,
    ) -> Result<()> {
        // Validate mints are owned by the provided token programs
        require!(
            ctx.accounts.token_x_mint.to_account_info().owner == &ctx.accounts.token_x_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(
            ctx.accounts.token_y_mint.to_account_info().owner == &ctx.accounts.token_y_program.key(),
            ErrorCode::InvalidTokenProgram
        );

        // Validate initial amounts
        require!(initial_token_x_amount > 0, ErrorCode::ZeroAmount);
        require!(initial_token_y_amount > 0, ErrorCode::ZeroAmount);

        // Initialize lb_pair state
        let lb_pair = &mut ctx.accounts.lb_pair;
        lb_pair.reserve_x = ctx.accounts.reserve_x.key();
        lb_pair.reserve_y = ctx.accounts.reserve_y.key();
        lb_pair.token_x_vault_amount = initial_token_x_amount;
        lb_pair.token_y_vault_amount = initial_token_y_amount;

        // Transfer initial tokens to reserves
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_x_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_x.to_account_info(),
                    to: ctx.accounts.reserve_x.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: ctx.accounts.token_x_mint.to_account_info(),
                },
            ),
            initial_token_x_amount,
            ctx.accounts.token_x_mint.decimals,
        )?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_y_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_y.to_account_info(),
                    to: ctx.accounts.reserve_y.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: ctx.accounts.token_y_mint.to_account_info(),
                },
            ),
            initial_token_y_amount,
            ctx.accounts.token_y_mint.decimals,
        )?;

        // Initialize oracle (mock: set initialized flag)
        let oracle = &mut ctx.accounts.oracle;
        oracle.initialized = true;

        Ok(())
    }

    pub fn initialize_user_token_accounts(ctx: Context<InitializeUserTokenAccounts>) -> Result<()> {
        // Validate mints are owned by the provided token programs
        require!(
            ctx.accounts.token_x_mint.to_account_info().owner == &ctx.accounts.token_x_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(
            ctx.accounts.token_y_mint.to_account_info().owner == &ctx.accounts.token_y_program.key(),
            ErrorCode::InvalidTokenProgram
        );

        // User token accounts are created by associated_token_program
        Ok(())
    }

    pub fn swap2(
        ctx: Context<Swap2>,
        amount_in: u64,
        min_amount_out: u64,
        _remaining_accounts_info: RemainingAccountsInfo,
    ) -> Result<()> {
        // Validate mints are owned by the provided token programs
        require!(
            ctx.accounts.token_x_mint.to_account_info().owner == &ctx.accounts.token_x_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(
            ctx.accounts.token_y_mint.to_account_info().owner == &ctx.accounts.token_y_program.key(),
            ErrorCode::InvalidTokenProgram
        );

        // Validate input amounts
        require!(amount_in > 0, ErrorCode::ZeroAmount);

        // Load lb_pair state
        let lb_pair = &mut ctx.accounts.lb_pair;

        // Determine swap direction based on user_token_in mint
        let swap_for_y = ctx.accounts.user_token_in.mint == ctx.accounts.token_x_mint.key();

        // Set input/output reserves, vaults, and token programs
        let (reserve_in, reserve_out, vault_in, vault_out, user_token_in, user_token_out, token_program_in, token_program_out, mint_in, mint_out) = if swap_for_y {
            (
                lb_pair.token_x_vault_amount,
                lb_pair.token_y_vault_amount,
                &ctx.accounts.reserve_x,
                &ctx.accounts.reserve_y,
                &ctx.accounts.user_token_in,
                &ctx.accounts.user_token_out,
                &ctx.accounts.token_x_program,
                &ctx.accounts.token_y_program,
                &ctx.accounts.token_x_mint,
                &ctx.accounts.token_y_mint,
            )
        } else {
            (
                lb_pair.token_y_vault_amount,
                lb_pair.token_x_vault_amount,
                &ctx.accounts.reserve_y,
                &ctx.accounts.reserve_x,
                &ctx.accounts.user_token_in,
                &ctx.accounts.user_token_out,
                &ctx.accounts.token_y_program,
                &ctx.accounts.token_x_program,
                &ctx.accounts.token_y_mint,
                &ctx.accounts.token_x_mint,
            )
        };

        // Validate token mints
        require!(
            user_token_in.mint == mint_in.key(),
            ErrorCode::InvalidMint
        );
        require!(
            user_token_out.mint == mint_out.key(),
            ErrorCode::InvalidMint
        );

        // Calculate output amount using constant product formula
        let amount_out = calculate_swap_amount(amount_in, reserve_in, reserve_out)?;

        // Check slippage protection
        require!(
            amount_out >= min_amount_out,
            ErrorCode::InsufficientOutputAmount
        );

        // Update pool reserves
        if swap_for_y {
            lb_pair.token_x_vault_amount = lb_pair
                .token_x_vault_amount
                .checked_add(amount_in)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            lb_pair.token_y_vault_amount = lb_pair
                .token_y_vault_amount
                .checked_sub(amount_out)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        } else {
            lb_pair.token_y_vault_amount = lb_pair
                .token_y_vault_amount
                .checked_add(amount_in)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            lb_pair.token_x_vault_amount = lb_pair
                .token_x_vault_amount
                .checked_sub(amount_out)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }

        // Transfer input tokens from user to vault
        transfer_checked(
            CpiContext::new(
                token_program_in.to_account_info(),
                TransferChecked {
                    from: user_token_in.to_account_info(),
                    to: vault_in.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: mint_in.to_account_info(),
                },
            ),
            amount_in,
            mint_in.decimals,
        )?;

        // Transfer output tokens from vault to user using lb_pair as authority
        let token_x_mint_key = ctx.accounts.token_x_mint.key();
        let token_y_mint_key = ctx.accounts.token_y_mint.key();
        let authority_seeds = &[
            b"lb_pair".as_ref(),
            token_x_mint_key.as_ref(),
            token_y_mint_key.as_ref(),
            &[ctx.bumps.lb_pair],
        ];
        transfer_checked(
            CpiContext::new_with_signer(
                token_program_out.to_account_info(),
                TransferChecked {
                    from: vault_out.to_account_info(),
                    to: user_token_out.to_account_info(),
                    authority: ctx.accounts.lb_pair.to_account_info(),
                    mint: mint_out.to_account_info(),
                },
                &[authority_seeds],
            ),
            amount_out,
            mint_out.decimals,
        )?;

        // Update oracle (mock: set timestamp)
        let oracle = &mut ctx.accounts.oracle;
        oracle.last_update_timestamp = Clock::get()?.unix_timestamp;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + 32 + 32 + 8 + 8,
        seeds = [b"lb_pair", token_x_mint.key().as_ref(), token_y_mint.key().as_ref()],
        bump,
    )]
    pub lb_pair: Account<'info, LbPair>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_x_mint,
        associated_token::authority = user,
        associated_token::token_program = token_x_program,
    )]
    pub user_token_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_y_mint,
        associated_token::authority = user,
        associated_token::token_program = token_y_program,
    )]
    pub user_token_y: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_x_mint,
        associated_token::authority = lb_pair,
        associated_token::token_program = token_x_program,
    )]
    pub reserve_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_y_mint,
        associated_token::authority = lb_pair,
        associated_token::token_program = token_y_program,
    )]
    pub reserve_y: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + 1 + 8,
        seeds = [b"oracle", lb_pair.key().as_ref()],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,

    pub token_x_mint: InterfaceAccount<'info, Mint>,
    pub token_y_mint: InterfaceAccount<'info, Mint>,

    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct InitializeUserTokenAccounts<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_x_mint,
        associated_token::authority = user,
        associated_token::token_program = token_x_program,
    )]
    pub user_token_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_y_mint,
        associated_token::authority = user,
        associated_token::token_program = token_y_program,
    )]
    pub user_token_y: InterfaceAccount<'info, TokenAccount>,

    pub token_x_mint: InterfaceAccount<'info, Mint>,
    pub token_y_mint: InterfaceAccount<'info, Mint>,

    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Swap2<'info> {
    #[account(
        mut,
        has_one = reserve_x @ ErrorCode::InvalidReserveX,
        has_one = reserve_y @ ErrorCode::InvalidReserveY,
        seeds = [b"lb_pair", token_x_mint.key().as_ref(), token_y_mint.key().as_ref()],
        bump
    )]
    pub lb_pair: Account<'info, LbPair>,

    /// CHECK: Optional, validated in program logic if used
    #[account(mut)]
    pub bin_array_bitmap_extension: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = reserve_x.mint == token_x_mint.key() @ ErrorCode::InvalidMint,
        constraint = reserve_x.owner == lb_pair.key() @ ErrorCode::InvalidOwner,
    )]
    pub reserve_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = reserve_y.mint == token_y_mint.key() @ ErrorCode::InvalidMint,
        constraint = reserve_y.owner == lb_pair.key() @ ErrorCode::InvalidOwner,
    )]
    pub reserve_y: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_in.owner == user.key() @ ErrorCode::InvalidOwner,
    )]
    pub user_token_in: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_out.owner == user.key() @ ErrorCode::InvalidOwner,
    )]
    pub user_token_out: InterfaceAccount<'info, TokenAccount>,

    pub token_x_mint: InterfaceAccount<'info, Mint>,
    pub token_y_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub oracle: Account<'info, Oracle>,

    /// CHECK: Optional, validated in program logic if used
    #[account(mut)]
    pub host_fee_in: UncheckedAccount<'info>,

    #[account(signer)]
    pub user: Signer<'info>,

    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,

    ///CHECK memo
    pub memo_program: UncheckedAccount<'info>,

    #[account(
        seeds = [b"__event_authority"],
        bump,
    )]
    ///CHECK event authority
    pub event_authority: UncheckedAccount<'info>,

    /// CHECK: The Meteora program itself (self-reference for CPI)
    #[account(executable)]
    pub program: UncheckedAccount<'info>
}

#[account]
#[derive(Default)]
pub struct LbPair {
    pub reserve_x: Pubkey,
    pub reserve_y: Pubkey,
    pub token_x_vault_amount: u64,
    pub token_y_vault_amount: u64,
}

#[account]
#[derive(Default)]
pub struct Oracle {
    pub initialized: bool,
    pub last_update_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct RemainingAccountsSlice {
    pub accounts_type: AccountsType,
    pub length: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountsType {
    BinArrays,
}

impl Default for AccountsType {
    fn default() -> Self {
        AccountsType::BinArrays
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount cannot be zero")]
    ZeroAmount,
    #[msg("Output amount is less than minimum specified")]
    InsufficientOutputAmount,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
    #[msg("Invalid reserve X")]
    InvalidReserveX,
    #[msg("Invalid reserve Y")]
    InvalidReserveY,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Invalid owner")]
    InvalidOwner,
    #[msg("Invalid token program for mint")]
    InvalidTokenProgram,
}

fn calculate_swap_amount(amount_in: u64, reserve_in: u64, reserve_out: u64) -> Result<u64> {
    // Simplified constant product formula: x * y = k
    // No fees included for mock simplicity
    require!(reserve_in > 0 && reserve_out > 0, ErrorCode::ArithmeticOverflow);

    let reserve_in = reserve_in as u128;
    let reserve_out = reserve_out as u128;
    let amount_in = amount_in as u128;

    let product = reserve_in
        .checked_mul(reserve_out)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let new_reserve_in = reserve_in
        .checked_add(amount_in)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let new_reserve_out = product
        .checked_div(new_reserve_in)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let amount_out = reserve_out
        .checked_sub(new_reserve_out)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(amount_out as u64)
}