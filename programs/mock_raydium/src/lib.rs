use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer},
};

declare_id!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");

#[program]
pub mod mock_raydium_swap {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        initial_token_a_amount: u64,
        initial_token_b_amount: u64,
    ) -> Result<()> {
        // Validate initial amounts
        require!(initial_token_a_amount > 0, ErrorCode::ZeroAmount);
        require!(initial_token_b_amount > 0, ErrorCode::ZeroAmount);

        // Initialize pool state
        let pool_state = &mut ctx.accounts.pool_state;
        pool_state.token_a_vault = ctx.accounts.token_a_vault.key();
        pool_state.token_b_vault = ctx.accounts.token_b_vault.key();
        pool_state.token_a_vault_amount = initial_token_a_amount;
        pool_state.token_b_vault_amount = initial_token_b_amount;

        // Transfer initial tokens to vaults
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.user_token_a.to_account_info(),
                    to: ctx.accounts.token_a_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            initial_token_a_amount,
        )?;

        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.user_token_b.to_account_info(),
                    to: ctx.accounts.token_b_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            initial_token_b_amount,
        )?;

        Ok(())
    }

    pub fn initialize_user_token_accounts(ctx: Context<InitializeUserTokenAccounts>) -> Result<()> {
        // User token accounts are created automatically by associated_token_program
        Ok(())
    }

    pub fn swap_base_input(
        ctx: Context<Swap>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        // Validate input amounts
        require!(amount_in > 0, ErrorCode::ZeroAmount);
        require!(minimum_amount_out > 0, ErrorCode::ZeroAmount);

        // Load pool state
        let pool_state = &mut ctx.accounts.pool_state;

        // Calculate output amount using constant product formula
        let amount_out = calculate_swap_amount(
            amount_in,
            pool_state.token_a_vault_amount,
            pool_state.token_b_vault_amount,
        )?;

        // Check slippage protection
        require!(
            amount_out >= minimum_amount_out,
            ErrorCode::InsufficientOutputAmount
        );

        // Update pool reserves
        pool_state.token_a_vault_amount = pool_state
            .token_a_vault_amount
            .checked_add(amount_in)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        pool_state.token_b_vault_amount = pool_state
            .token_b_vault_amount
            .checked_sub(amount_out)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // Transfer input tokens from user to vault
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program_a.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.user_token_a.to_account_info(),
                    to: ctx.accounts.token_a_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_in,
        )?;

        // Transfer output tokens from vault to user
        let authority_seeds = &[
            b"authority".as_ref(),
            ctx.accounts.pool_state.to_account_info().key.as_ref(),
            &[ctx.bumps.authority],
        ];
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program_b.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.token_b_vault.to_account_info(),
                    to: ctx.accounts.user_token_b.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            amount_out,
        )?;

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
        seeds = [b"pool_state", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump,
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        seeds = [b"authority", pool_state.key().as_ref()],
        bump,
    )]
    /// CHECK: PDA authority for vaults, verified by seeds
    pub authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = user,
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = user,
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = authority,
    )]
    pub token_a_vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = authority,
    )]
    pub token_b_vault: Account<'info, TokenAccount>,

    pub token_a_mint: Account<'info, Mint>,

    pub token_b_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeUserTokenAccounts<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = user,
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = user,
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    pub token_a_mint: Account<'info, Mint>,

    pub token_b_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"authority", pool_state.key().as_ref()],
        bump,
    )]

    /// CHECK: PDA authority for vaults, verified by seeds
    pub authority: UncheckedAccount<'info>,

    /// CHECK: amm config
    pub amm_config: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"pool_state", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump,
        has_one = token_a_vault,
        has_one = token_b_vault,
    )]
    pub pool_state: Box<Account<'info, PoolState>>,


    #[account(
        mut,
        associated_token::mint = token_a_mint,
        associated_token::authority = user,
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_b_mint,
        associated_token::authority = user,
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_a_mint,
        associated_token::authority = authority,
    )]
    pub token_a_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_b_mint,
        associated_token::authority = authority,
    )]
    pub token_b_vault: Account<'info, TokenAccount>,

    pub token_program_a: Program<'info, Token>,
    pub token_program_b: Program<'info, Token>,

    pub token_a_mint: Account<'info, Mint>,

    pub token_b_mint: Account<'info, Mint>,

    /// CHECK observation
    pub observation_state: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(Default)]
pub struct PoolState {
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    pub token_a_vault_amount: u64,
    pub token_b_vault_amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount cannot be zero")]
    ZeroAmount,
    #[msg("Output amount is less than minimum specified")]
    InsufficientOutputAmount,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
}

fn calculate_swap_amount(amount_in: u64, reserve_in: u64, reserve_out: u64) -> Result<u64> {
    // Simplified constant product formula: x * y = k
    // No fees included for mock simplicity
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