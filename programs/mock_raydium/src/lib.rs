use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface, transfer_checked, TransferChecked},
};

declare_id!("HTg2aCPRCYMMEbkx59TmQcyp4LcGZScoYksCBwJAfLNJ");

#[program]
pub mod mock_raydium {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        initial_token_a_amount: u64,
        initial_token_b_amount: u64,
    ) -> Result<()> {
        // (Unchanged from original)
        require!(
            ctx.accounts.token_a_mint.to_account_info().owner == &ctx.accounts.token_a_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(
            ctx.accounts.token_b_mint.to_account_info().owner == &ctx.accounts.token_b_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(initial_token_a_amount > 0, ErrorCode::ZeroAmount);
        require!(initial_token_b_amount > 0, ErrorCode::ZeroAmount);

        let pool_state = &mut ctx.accounts.pool_state;
        pool_state.token_a_vault = ctx.accounts.token_a_vault.key();
        pool_state.token_b_vault = ctx.accounts.token_b_vault.key();
        pool_state.token_a_vault_amount = initial_token_a_amount;
        pool_state.token_b_vault_amount = initial_token_b_amount;
        pool_state.is_custom_price_mode = false; // Initialize to constant product mode
        pool_state.mock_price = 0; // Initialize mock price to 0

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_a_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_a.to_account_info(),
                    to: ctx.accounts.token_a_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: ctx.accounts.token_a_mint.to_account_info(),
                },
            ),
            initial_token_a_amount,
            ctx.accounts.token_a_mint.decimals
        )?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_b_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_b.to_account_info(),
                    to: ctx.accounts.token_b_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: ctx.accounts.token_b_mint.to_account_info(),
                },
            ),
            initial_token_b_amount,
            ctx.accounts.token_b_mint.decimals
        )?;

        Ok(())
    }

    pub fn initialize_user_token_accounts(ctx: Context<InitializeUserTokenAccounts>) -> Result<()> {
        // (Unchanged from original)
        require!(
            ctx.accounts.token_a_mint.to_account_info().owner == &ctx.accounts.token_a_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(
            ctx.accounts.token_b_mint.to_account_info().owner == &ctx.accounts.token_b_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        Ok(())
    }

    pub fn set_mode(ctx: Context<SetMode>, use_custom_price: bool) -> Result<()> {
        let pool_state = &mut ctx.accounts.pool_state;
        pool_state.is_custom_price_mode = use_custom_price;
        if use_custom_price {
            require!(pool_state.mock_price > 0, ErrorCode::MockPriceNotSet);
        }
        Ok(())
    }

    pub fn set_mock_price(ctx: Context<SetMockPrice>, mock_price: u64) -> Result<()> {
        require!(mock_price > 0, ErrorCode::ZeroAmount);
        let pool_state = &mut ctx.accounts.pool_state;
        pool_state.mock_price = mock_price;
        Ok(())
    }

    pub fn swap_base_input(
        ctx: Context<Swap>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        msg!("call mock program");

        require!(
            ctx.accounts.input_token_mint.to_account_info().owner == &ctx.accounts.input_token_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(
            ctx.accounts.output_token_mint.to_account_info().owner == &ctx.accounts.output_token_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(amount_in > 0, ErrorCode::ZeroAmount);

        let pool_state = &mut ctx.accounts.pool_state;

        let amount_out = if pool_state.is_custom_price_mode {
            // Use custom price: amount_out = amount_in * mock_price
            // Assuming mock_price is tokens_out per 1 token_in (scaled by decimals)
            (amount_in as u128)
                .checked_mul(pool_state.mock_price as u128)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(10u128.pow(ctx.accounts.input_token_mint.decimals as u32))
                .ok_or(ErrorCode::ArithmeticOverflow)? as u64
        } else {
            // Use constant product formula
            calculate_swap_amount(
                amount_in,
                pool_state.token_a_vault_amount,
                pool_state.token_b_vault_amount,
            )?
        };

        require!(
            amount_out >= minimum_amount_out,
            ErrorCode::InsufficientOutputAmount
        );

        pool_state.token_a_vault_amount = pool_state
            .token_a_vault_amount
            .checked_add(amount_in)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        pool_state.token_b_vault_amount = pool_state
            .token_b_vault_amount
            .checked_sub(amount_out)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.input_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.input_token_account.to_account_info(),
                    to: ctx.accounts.token_a_vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                    mint: ctx.accounts.input_token_mint.to_account_info(),
                },
            ),
            amount_in,
            ctx.accounts.input_token_mint.decimals,
        )?;

        let authority_seeds = &[
            b"vault_and_lp_mint_auth_seed".as_ref(),
            &[ctx.bumps.authority],
        ];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.output_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.token_b_vault.to_account_info(),
                    to: ctx.accounts.output_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                    mint: ctx.accounts.output_token_mint.to_account_info(),
                },
                &[authority_seeds],
            ),
            amount_out,
            ctx.accounts.output_token_mint.decimals,
        )?;

        Ok(())
    }

    pub fn migrate_pool_state(ctx: Context<MigratePoolState>) -> Result<()> {
        let pool_state = &mut ctx.accounts.pool_state;
        let account_info = pool_state.to_account_info();
        let new_space = 8 + 32 + 32 + 8 + 8 + 1 + 8; // New size: 97 bytes (discriminator + token_a_vault + token_b_vault + token_a_vault_amount + token_b_vault_amount + is_custom_price_mode + mock_price)
        let current_space = account_info.data.borrow().len();

        if current_space < new_space {
            // Resize the account using AccountInfo::resize()
            account_info.resize(new_space)?;

            // Ensure sufficient lamports for rent exemption
            let rent = Rent::get()?;
            let minimum_balance = rent.minimum_balance(new_space);
            let lamports = account_info.lamports();
            if lamports < minimum_balance {
                let additional_lamports = minimum_balance - lamports;
                anchor_lang::solana_program::program::invoke(
                    &anchor_lang::solana_program::system_instruction::transfer(
                        ctx.accounts.user.key,
                        account_info.key,
                        additional_lamports,
                    ),
                    &[
                        ctx.accounts.user.to_account_info(),
                        account_info.clone(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                )?;
            }
        }

        // Initialize new fields
        pool_state.is_custom_price_mode = false;
        pool_state.mock_price = 0;

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
        space = 8 + 32 + 32 + 8 + 8 + 1 + 8, // Added space for is_custom_price_mode (1 byte) and mock_price (8 bytes)
        seeds = [b"pool_state", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    #[account(
        seeds = [b"vault_and_lp_mint_auth_seed"],
        bump,
    )]
    /// CHECK: PDA authority for vaults, verified by seeds
    pub authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = user,
        associated_token::token_program = token_a_program,
    )]
    pub user_token_a: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = user,
        associated_token::token_program = token_b_program,
    )]
    pub user_token_b: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = authority,
        associated_token::token_program = token_a_program,
    )]
    pub token_a_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = authority,
        associated_token::token_program = token_b_program,
    )]
    pub token_b_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_a_mint: InterfaceAccount<'info, Mint>,
    pub token_b_mint: InterfaceAccount<'info, Mint>,
    pub token_a_program: Interface<'info, TokenInterface>,
    pub token_b_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeUserTokenAccounts<'info> {
    // (Unchanged from original)
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = user,
        associated_token::token_program = token_a_program,
    )]
    pub user_token_a: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = user,
        associated_token::token_program = token_b_program,
    )]
    pub user_token_b: InterfaceAccount<'info, TokenAccount>,
    pub token_a_mint: InterfaceAccount<'info, Mint>,
    pub token_b_mint: InterfaceAccount<'info, Mint>,
    pub token_a_program: Interface<'info, TokenInterface>,
    pub token_b_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetMode<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pool_state", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    pub token_a_mint: InterfaceAccount<'info, Mint>,
    pub token_b_mint: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct SetMockPrice<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pool_state", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    pub token_a_mint: InterfaceAccount<'info, Mint>,
    pub token_b_mint: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    // (Unchanged from original)
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"vault_and_lp_mint_auth_seed"],
        bump,
    )]
    /// CHECK: PDA authority for vaults, verified by seeds
    pub authority: UncheckedAccount<'info>,
    /// CHECK: AMM config
    pub amm_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub pool_state: Box<Account<'info, PoolState>>,
    #[account(mut)]
    pub input_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub output_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = input_token_mint,
        associated_token::authority = authority,
        associated_token::token_program = input_token_program,
    )]
    pub token_a_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = output_token_mint,
        associated_token::authority = authority,
        associated_token::token_program = output_token_program,
    )]
    pub token_b_vault: InterfaceAccount<'info, TokenAccount>,
    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,
    pub input_token_mint: InterfaceAccount<'info, Mint>,
    pub output_token_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    /// CHECK: Observation state
    pub observation_state: UncheckedAccount<'info>,
}

#[account]
#[derive(Default)]
pub struct PoolState {
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    pub token_a_vault_amount: u64,
    pub token_b_vault_amount: u64,
    pub is_custom_price_mode: bool, // New: Indicates if custom price mode is enabled
    pub mock_price: u64,            // New: Custom price (tokens_out per 1 token_in, scaled by decimals)
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount cannot be zero")]
    ZeroAmount,
    #[msg("Output amount is less than minimum specified")]
    InsufficientOutputAmount,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
    #[msg("Invalid token program for mint")]
    InvalidTokenProgram,
    #[msg("Mock price not set when enabling custom price mode")]
    MockPriceNotSet,
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


#[derive(Accounts)]
pub struct MigratePoolState<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pool_state", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    pub token_a_mint: InterfaceAccount<'info, Mint>,
    pub token_b_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}