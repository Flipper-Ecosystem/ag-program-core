use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer},
};

declare_id!("Fa6sgRmBda2UJpBT1tV3bq27JkLjuRYvnt6TxWqAJT5F");

#[program]
pub mod mock_whirlpool_swap {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        initial_token_a_amount: u64,
        initial_token_b_amount: u64,
    ) -> Result<()> {
        require!(initial_token_a_amount > 0, ErrorCode::ZeroAmount);
        require!(initial_token_b_amount > 0, ErrorCode::ZeroAmount);

        let whirlpool = &mut ctx.accounts.whirlpool;
        whirlpool.token_vault_a = ctx.accounts.token_vault_a.key();
        whirlpool.token_vault_b = ctx.accounts.token_vault_b.key();
        whirlpool.token_vault_a_amount = initial_token_a_amount;
        whirlpool.token_vault_b_amount = initial_token_b_amount;
        whirlpool.sqrt_price = 4295048016; // Simplified sqrt price
        whirlpool.liquidity = initial_token_a_amount as u128 * initial_token_b_amount as u128;
        whirlpool.tick_current_index = 0;

        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program_a.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_a.to_account_info(),
                    to: ctx.accounts.token_vault_a.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            initial_token_a_amount,
        )?;

        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program_b.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_b.to_account_info(),
                    to: ctx.accounts.token_vault_b.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            initial_token_b_amount,
        )?;

        Ok(())
    }

    pub fn initialize_user_token_accounts(ctx: Context<InitializeUserTokenAccounts>) -> Result<()> {
        Ok(())
    }

    pub fn swap_v2(
        ctx: Context<SwapV2>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
        _remaining_accounts_info: Option<RemainingAccountsInfo>,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);
        require!(other_amount_threshold > 0, ErrorCode::ZeroAmount);

        let whirlpool = &mut ctx.accounts.whirlpool;

        let (amount_in, amount_out) = if amount_specified_is_input {
            let calculated_out = if a_to_b {
                calculate_swap_amount(
                    amount,
                    whirlpool.token_vault_a_amount,
                    whirlpool.token_vault_b_amount,
                )?
            } else {
                calculate_swap_amount(
                    amount,
                    whirlpool.token_vault_b_amount,
                    whirlpool.token_vault_a_amount,
                )?
            };
            require!(calculated_out >= other_amount_threshold, ErrorCode::AmountOutBelowMinimum);
            (amount, calculated_out)
        } else {
            let calculated_in = if a_to_b {
                calculate_reverse_swap_amount(
                    amount,
                    whirlpool.token_vault_a_amount,
                    whirlpool.token_vault_b_amount,
                )?
            } else {
                calculate_reverse_swap_amount(
                    amount,
                    whirlpool.token_vault_b_amount,
                    whirlpool.token_vault_a_amount,
                )?
            };
            require!(calculated_in <= other_amount_threshold, ErrorCode::AmountInAboveMaximum);
            (calculated_in, amount)
        };

        if a_to_b {
            whirlpool.token_vault_a_amount = whirlpool.token_vault_a_amount
                .checked_add(amount_in)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            whirlpool.token_vault_b_amount = whirlpool.token_vault_b_amount
                .checked_sub(amount_out)
                .ok_or(ErrorCode::ArithmeticOverflow)?;

            anchor_spl::token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program_a.to_account_info(),
                    Transfer {
                        from: ctx.accounts.token_owner_account_a.to_account_info(),
                        to: ctx.accounts.token_vault_a.to_account_info(),
                        authority: ctx.accounts.token_authority.to_account_info(),
                    },
                ),
                amount_in,
            )?;

            let authority_seeds = &[
                b"whirlpool".as_ref(),
                ctx.accounts.whirlpool.to_account_info().key.as_ref(),
                &[ctx.bumps.whirlpool],
            ];
            anchor_spl::token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program_b.to_account_info(),
                    Transfer {
                        from: ctx.accounts.token_vault_b.to_account_info(),
                        to: ctx.accounts.token_owner_account_b.to_account_info(),
                        authority: ctx.accounts.whirlpool.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                amount_out,
            )?;
        } else {
            whirlpool.token_vault_b_amount = whirlpool.token_vault_b_amount
                .checked_add(amount_in)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            whirlpool.token_vault_a_amount = whirlpool.token_vault_a_amount
                .checked_sub(amount_out)
                .ok_or(ErrorCode::ArithmeticOverflow)?;

            anchor_spl::token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program_b.to_account_info(),
                    Transfer {
                        from: ctx.accounts.token_owner_account_b.to_account_info(),
                        to: ctx.accounts.token_vault_b.to_account_info(),
                        authority: ctx.accounts.token_authority.to_account_info(),
                    },
                ),
                amount_in,
            )?;

            let authority_seeds = &[
                b"whirlpool".as_ref(),
                ctx.accounts.whirlpool.to_account_info().key.as_ref(),
                &[ctx.bumps.whirlpool],
            ];
            anchor_spl::token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program_a.to_account_info(),
                    Transfer {
                        from: ctx.accounts.token_vault_a.to_account_info(),
                        to: ctx.accounts.token_owner_account_a.to_account_info(),
                        authority: ctx.accounts.whirlpool.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                amount_out,
            )?;
        }

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemainingAccountsSlice {
    pub accounts_type: u8,
    pub length: u8,
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + std::mem::size_of::<Whirlpool>(),
        seeds = [b"whirlpool", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()],
        bump,
    )]
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint_a,
        associated_token::authority = user,
        associated_token::token_program = token_program_a,
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint_b,
        associated_token::authority = user,
        associated_token::token_program = token_program_b,
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint_a,
        associated_token::authority = whirlpool,
        associated_token::token_program = token_program_a,
    )]
    pub token_vault_a: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint_b,
        associated_token::authority = whirlpool,
        associated_token::token_program = token_program_b,
    )]
    pub token_vault_b: Account<'info, TokenAccount>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

    pub token_program_a: Program<'info, Token>,
    pub token_program_b: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeUserTokenAccounts<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint_a,
        associated_token::authority = user,
        associated_token::token_program = token_program_a,
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint_b,
        associated_token::authority = user,
        associated_token::token_program = token_program_b,
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

    pub token_program_a: Program<'info, Token>,
    pub token_program_b: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SwapV2<'info> {
    pub token_program_a: Program<'info, Token>,
    pub token_program_b: Program<'info, Token>,

    /// CHECK: Memo program (optional)
    pub memo_program: UncheckedAccount<'info>,

    pub token_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"whirlpool", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()],
        bump,
        has_one = token_vault_a,
        has_one = token_vault_b,
    )]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = token_authority,
    )]
    pub token_owner_account_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint_b,
        associated_token::authority = token_authority,
    )]
    pub token_owner_account_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = whirlpool,
    )]
    pub token_vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint_b,
        associated_token::authority = whirlpool,
    )]
    pub token_vault_b: Account<'info, TokenAccount>,

    /// CHECK: Oracle account (optional)
    pub oracle: UncheckedAccount<'info>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,
}

#[account]
#[derive(Default)]
pub struct Whirlpool {
    pub token_vault_a: Pubkey,
    pub token_vault_b: Pubkey,
    pub token_vault_a_amount: u64,
    pub token_vault_b_amount: u64,
    pub sqrt_price: u128,
    pub liquidity: u128,
    pub tick_current_index: i32,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount cannot be zero")]
    ZeroAmount,
    #[msg("Output amount is less than minimum specified")]
    AmountOutBelowMinimum,
    #[msg("Input amount is greater than maximum specified")]
    AmountInAboveMaximum,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
}

fn calculate_swap_amount(amount_in: u64, reserve_in: u64, reserve_out: u64) -> Result<u64> {
    let reserve_in = reserve_in as u128;
    let reserve_out = reserve_out as u128;
    let amount_in = amount_in as u128;

    let product = reserve_in * reserve_out;
    let new_reserve_in = reserve_in
        .checked_add(amount_in)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let new_reserve_out = product
        .checked_div(new_reserve_in)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let amount_out = (reserve_out - new_reserve_out) as u64;
    Ok(amount_out)
}

fn calculate_reverse_swap_amount(amount_out: u64, reserve_in: u64, reserve_out: u64) -> Result<u64> {
    let reserve_in = reserve_in as u128;
    let reserve_out = reserve_out as u128;
    let amount_out = amount_out as u128;

    let product = reserve_in * reserve_out;
    let new_reserve_out = reserve_out
        .checked_sub(amount_out)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let new_reserve_in = product
        .checked_div(new_reserve_out)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let amount_in = (new_reserve_in - reserve_in) as u64;
    Ok(amount_in)
}