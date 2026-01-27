use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface, transfer_checked, TransferChecked},
};

declare_id!("CZUz9mp2h2gStQ7tKzvAjyCvW3tUgBXcSA6E6atHXxCD");

#[program]
pub mod mock_whirlpool_swap {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        initial_token_a_amount: u64,
        initial_token_b_amount: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.token_mint_a.to_account_info().owner == &ctx.accounts.token_program_a.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(
            ctx.accounts.token_mint_b.to_account_info().owner == &ctx.accounts.token_program_b.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(initial_token_a_amount > 0, ErrorCode::ZeroAmount);
        require!(initial_token_b_amount > 0, ErrorCode::ZeroAmount);

        let whirlpool = &mut ctx.accounts.whirlpool;
        whirlpool.token_mint_a = ctx.accounts.token_mint_a.key();
        whirlpool.token_mint_b = ctx.accounts.token_mint_b.key();
        whirlpool.token_vault_a = ctx.accounts.token_vault_a.key();
        whirlpool.token_vault_b = ctx.accounts.token_vault_b.key();
        whirlpool.token_vault_a_amount = initial_token_a_amount;
        whirlpool.token_vault_b_amount = initial_token_b_amount;
        whirlpool.sqrt_price = 4295048016;
        whirlpool.liquidity = initial_token_a_amount as u128 * initial_token_b_amount as u128;
        whirlpool.tick_current_index = 0;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program_a.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_a.to_account_info(),
                    to: ctx.accounts.token_vault_a.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: ctx.accounts.token_mint_a.to_account_info(),
                },
            ),
            initial_token_a_amount,
            ctx.accounts.token_mint_a.decimals,
        )?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program_b.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_b.to_account_info(),
                    to: ctx.accounts.token_vault_b.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: ctx.accounts.token_mint_b.to_account_info(),
                },
            ),
            initial_token_b_amount,
            ctx.accounts.token_mint_b.decimals,
        )?;

        // Initialize tick arrays
        let tick_array_0 = &mut ctx.accounts.tick_array_0;
        tick_array_0.whirlpool = whirlpool.key();
        tick_array_0.start_tick_index = -100;

        let tick_array_1 = &mut ctx.accounts.tick_array_1;
        tick_array_1.whirlpool = whirlpool.key();
        tick_array_1.start_tick_index = 0;

        let tick_array_2 = &mut ctx.accounts.tick_array_2;
        tick_array_2.whirlpool = whirlpool.key();
        tick_array_2.start_tick_index = 100;

        Ok(())
    }

    pub fn initialize_supplemental_tick_array(
        ctx: Context<InitializeSupplementalTickArray>,
        start_tick_index: i32,
    ) -> Result<()> {
        let tick_array = &mut ctx.accounts.tick_array;
        tick_array.whirlpool = ctx.accounts.whirlpool.key();
        tick_array.start_tick_index = start_tick_index;
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

        require!(
            ctx.accounts.token_mint_a.to_account_info().owner == &ctx.accounts.token_program_a.key(),
            ErrorCode::InvalidTokenProgram
        );
        require!(
            ctx.accounts.token_mint_b.to_account_info().owner == &ctx.accounts.token_program_b.key(),
            ErrorCode::InvalidTokenProgram
        );

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

        let token_mint_a_key = ctx.accounts.token_mint_a.key();
        let token_mint_b_key = ctx.accounts.token_mint_b.key();

        if a_to_b {
            whirlpool.token_vault_a_amount = whirlpool
                .token_vault_a_amount
                .checked_add(amount_in)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            whirlpool.token_vault_b_amount = whirlpool
                .token_vault_b_amount
                .checked_sub(amount_out)
                .ok_or(ErrorCode::ArithmeticOverflow)?;

            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program_a.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.token_owner_account_a.to_account_info(),
                        to: ctx.accounts.token_vault_a.to_account_info(),
                        authority: ctx.accounts.token_authority.to_account_info(),
                        mint: ctx.accounts.token_mint_a.to_account_info(),
                    },
                ),
                amount_in,
                ctx.accounts.token_mint_a.decimals,
            )?;

            let authority_seeds = &[
                b"whirlpool".as_ref(),
                token_mint_a_key.as_ref(),
                token_mint_b_key.as_ref(),
                &[ctx.bumps.whirlpool],
            ];
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program_b.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.token_vault_b.to_account_info(),
                        to: ctx.accounts.token_owner_account_b.to_account_info(),
                        authority: ctx.accounts.whirlpool.to_account_info(),
                        mint: ctx.accounts.token_mint_b.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                amount_out,
                ctx.accounts.token_mint_b.decimals,
            )?;
        } else {
            whirlpool.token_vault_b_amount = whirlpool
                .token_vault_b_amount
                .checked_add(amount_in)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            whirlpool.token_vault_a_amount = whirlpool
                .token_vault_a_amount
                .checked_sub(amount_out)
                .ok_or(ErrorCode::ArithmeticOverflow)?;

            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program_b.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.token_owner_account_b.to_account_info(),
                        to: ctx.accounts.token_vault_b.to_account_info(),
                        authority: ctx.accounts.token_authority.to_account_info(),
                        mint: ctx.accounts.token_mint_b.to_account_info(),
                    },
                ),
                amount_in,
                ctx.accounts.token_mint_b.decimals,
            )?;

            let authority_seeds = &[
                b"whirlpool".as_ref(),
                token_mint_a_key.as_ref(),
                token_mint_b_key.as_ref(),
                &[ctx.bumps.whirlpool],
            ];
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program_a.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.token_vault_a.to_account_info(),
                        to: ctx.accounts.token_owner_account_a.to_account_info(),
                        authority: ctx.accounts.whirlpool.to_account_info(),
                        mint: ctx.accounts.token_mint_a.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                amount_out,
                ctx.accounts.token_mint_a.decimals,
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
        init,
        payer = user,
        space = 8 + std::mem::size_of::<TickArray>(),
        seeds = [b"tick_array", whirlpool.key().as_ref(), &(-100i32).to_le_bytes()],
        bump,
    )]
    pub tick_array_0: Account<'info, TickArray>,

    #[account(
        init,
        payer = user,
        space = 8 + std::mem::size_of::<TickArray>(),
        seeds = [b"tick_array", whirlpool.key().as_ref(), &0i32.to_le_bytes()],
        bump,
    )]
    pub tick_array_1: Account<'info, TickArray>,

    #[account(
        init,
        payer = user,
        space = 8 + std::mem::size_of::<TickArray>(),
        seeds = [b"tick_array", whirlpool.key().as_ref(), &100i32.to_le_bytes()],
        bump,
    )]
    pub tick_array_2: Account<'info, TickArray>,

    #[account(mut)]
    pub user_token_a: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_mint_a,
        associated_token::authority = whirlpool,
        associated_token::token_program = token_program_a,
    )]
    pub token_vault_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_mint_b,
        associated_token::authority = whirlpool,
        associated_token::token_program = token_program_b,
    )]
    pub token_vault_b: InterfaceAccount<'info, TokenAccount>,

    pub token_mint_a: InterfaceAccount<'info, Mint>,
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(start_tick_index: i32)]
pub struct InitializeSupplementalTickArray<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: We only need to read the whirlpool key
    pub whirlpool: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<TickArray>(),
        seeds = [b"tick_array", whirlpool.key().as_ref(), &start_tick_index.to_le_bytes()],
        bump,
    )]
    pub tick_array: Account<'info, TickArray>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SwapV2<'info> {
    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,

    /// CHECK: Memo program (optional)
    pub memo_program: UncheckedAccount<'info>,

    pub token_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"whirlpool", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()],
        bump,
    )]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    pub token_mint_a: InterfaceAccount<'info, Mint>,
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub token_owner_account_a: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub token_vault_a: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub token_owner_account_b: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub token_vault_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"tick_array", whirlpool.key().as_ref(), &(-100i32).to_le_bytes()],
        bump,
    )]
    pub tick_array_0: Account<'info, TickArray>,

    #[account(
        mut,
        seeds = [b"tick_array", whirlpool.key().as_ref(), &0i32.to_le_bytes()],
        bump,
    )]
    pub tick_array_1: Account<'info, TickArray>,

    #[account(
        mut,
        seeds = [b"tick_array", whirlpool.key().as_ref(), &100i32.to_le_bytes()],
        bump,
    )]
    pub tick_array_2: Account<'info, TickArray>,

    /// CHECK: Oracle account (optional)
    #[account(mut)]
    pub oracle: UncheckedAccount<'info>

}

#[account]
#[derive(Default)]
pub struct Whirlpool {
    pub token_mint_a: Pubkey,
    pub token_mint_b: Pubkey,
    pub token_vault_a: Pubkey,
    pub token_vault_b: Pubkey,
    pub token_vault_a_amount: u64,
    pub token_vault_b_amount: u64,
    pub sqrt_price: u128,
    pub liquidity: u128,
    pub tick_current_index: i32,
}

#[account]
#[derive(Default)]
pub struct TickArray {
    pub whirlpool: Pubkey,
    pub start_tick_index: i32,
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
    #[msg("Invalid token program for mint")]
    InvalidTokenProgram,
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