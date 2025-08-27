use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer},
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
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_x_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.user_token_x.to_account_info(),
                    to: ctx.accounts.reserve_x.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            initial_token_x_amount,
        )?;

        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_y_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.user_token_y.to_account_info(),
                    to: ctx.accounts.reserve_y.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            initial_token_y_amount,
        )?;

        // Initialize oracle (mock: set initialized flag)
        let oracle = &mut ctx.accounts.oracle;
        oracle.initialized = true;

        Ok(())
    }

    pub fn initialize_user_token_accounts(ctx: Context<InitializeUserTokenAccounts>) -> Result<()> {
        // User token accounts are created by associated_token_program
        Ok(())
    }

    pub fn swap2(
        ctx: Context<Swap2>,
        amount_in: u64,
        min_amount_out: u64,
        _remaining_accounts_info: RemainingAccountsInfo,
    ) -> Result<()> {
        // Validate input amounts
        require!(amount_in > 0, ErrorCode::ZeroAmount);
        require!(min_amount_out > 0, ErrorCode::ZeroAmount);

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
                ctx.accounts.token_x_mint.key(),
                ctx.accounts.token_y_mint.key(),
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
                ctx.accounts.token_y_mint.key(),
                ctx.accounts.token_x_mint.key(),
            )
        };

        // Validate token mints
        require!(
            user_token_in.mint == mint_in,
            ErrorCode::InvalidMint
        );
        require!(
            user_token_out.mint == mint_out,
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
        anchor_spl::token::transfer(
            CpiContext::new(
                token_program_in.to_account_info(),
                anchor_spl::token::Transfer {
                    from: user_token_in.to_account_info(),
                    to: vault_in.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_in,
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
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                token_program_out.to_account_info(),
                anchor_spl::token::Transfer {
                    from: vault_out.to_account_info(),
                    to: user_token_out.to_account_info(),
                    authority: ctx.accounts.lb_pair.to_account_info(),
                },
                &[authority_seeds],
            ),
            amount_out,
        )?;

        // Update oracle (mock: set timestamp)
        let oracle = &mut ctx.accounts.oracle;
        oracle.last_update_timestamp = Clock::get()?.unix_timestamp;

        // Note: host_fee_in and memo_program are included but not used in this mock logic
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
        init,
        payer = user,
        associated_token::mint = token_x_mint,
        associated_token::authority = user,
        associated_token::token_program = token_x_program,
    )]
    pub user_token_x: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_y_mint,
        associated_token::authority = user,
        associated_token::token_program = token_y_program,
    )]
    pub user_token_y: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_x_mint,
        associated_token::authority = lb_pair,
        associated_token::token_program = token_x_program,
    )]
    pub reserve_x: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_y_mint,
        associated_token::authority = lb_pair,
        associated_token::token_program = token_y_program,
    )]
    pub reserve_y: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + 1 + 8,
        seeds = [b"oracle", lb_pair.key().as_ref()],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,

    pub token_x_mint: Account<'info, Mint>,

    pub token_y_mint: Account<'info, Mint>,

    #[account(
        constraint = token_x_program.key() == anchor_spl::token::ID || token_x_program.key() == anchor_spl::token_2022::ID,
        constraint = token_x_mint.mint_authority.is_none() || token_x_mint.mint_authority.unwrap() == token_x_program.key(),
    )]
    pub token_x_program: Program<'info, Token>,

    #[account(
        constraint = token_y_program.key() == anchor_spl::token::ID || token_y_program.key() == anchor_spl::token_2022::ID,
        constraint = token_y_mint.mint_authority.is_none() || token_y_mint.mint_authority.unwrap() == token_y_program.key(),
    )]
    pub token_y_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>
}


#[derive(Accounts)]
pub struct InitializeUserTokenAccounts<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_x_mint,
        associated_token::authority = user,
        associated_token::token_program = token_x_program,
    )]
    pub user_token_x: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_y_mint,
        associated_token::authority = user,
        associated_token::token_program = token_y_program,
    )]
    pub user_token_y: Account<'info, TokenAccount>,

    pub token_x_mint: Account<'info, Mint>,

    pub token_y_mint: Account<'info, Mint>,

    #[account(
        constraint = token_x_program.key() == anchor_spl::token::ID || token_x_program.key() == anchor_spl::token_2022::ID,
        constraint = token_x_mint.mint_authority.is_none() || token_x_mint.mint_authority.unwrap() == token_x_program.key(),
    )]
    pub token_x_program: Program<'info, Token>,

    #[account(
        constraint = token_y_program.key() == anchor_spl::token::ID|| token_y_program.key() == anchor_spl::token_2022::ID,
        constraint = token_y_mint.mint_authority.is_none() || token_y_mint.mint_authority.unwrap() == token_y_program.key(),
    )]
    pub token_y_program: Program<'info, Token>,

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
         seeds = [b"lb_pair", reserve_x.mint.key().as_ref(), reserve_y.mint.key().key().as_ref()],
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
    pub reserve_x: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = reserve_y.mint == token_y_mint.key() @ ErrorCode::InvalidMint,
        constraint = reserve_y.owner == lb_pair.key() @ ErrorCode::InvalidOwner,
    )]
    pub reserve_y: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_in.mint == token_x_mint.key() @ ErrorCode::InvalidMint,
        constraint = user_token_in.owner == user.key() @ ErrorCode::InvalidOwner,
    )]
    pub user_token_in: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_out.mint == token_y_mint.key() @ ErrorCode::InvalidMint,
        constraint = user_token_out.owner == user.key() @ ErrorCode::InvalidOwner,
    )]
    pub user_token_out: Account<'info, TokenAccount>,

    pub token_x_mint: Account<'info, Mint>,

    pub token_y_mint: Account<'info, Mint>,

    /// CHECK: Optional, validated in program logic if used
    #[account(mut)]
    pub oracle: Account<'info, Oracle>,

    /// CHECK: Optional, validated in program logic if used
    #[account(mut)]
    pub host_fee_in: UncheckedAccount<'info>,

    #[account(signer)]
    pub user: Signer<'info>,

    pub token_x_program: Program<'info, Token>,

    pub token_y_program: Program<'info, Token>,

    ///CHECK memo
    pub memo_program: UncheckedAccount<'info>,

    #[account(
        seeds = [b"__event_authority"],
        bump,
    )]
    ///CHECK event authority
    pub event_authority: UncheckedAccount<'info>,

    pub program: Program<'info, System>,
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