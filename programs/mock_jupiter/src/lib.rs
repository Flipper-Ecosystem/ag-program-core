use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint, TokenAccount, TokenInterface,
    transfer_checked, TransferChecked
};

declare_id!("EbgGVffJ6wAsJUj73jkZaNLRgXyFLTuPDzGvRGyT39wv");

/// Route plan step matching Jupiter's structure
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RoutePlanStep {
    pub swap: Swap,
    pub percent: u8,
    pub input_index: u8,
    pub output_index: u8,
}

/// Swap types matching Jupiter's enum
/// Simplified for mock - only includes common types
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Swap {
    Saber,
    SaberAddDecimalsDeposit,
    SaberAddDecimalsWithdraw,
    TokenSwap,
    Sencha,
    Step,
    Cropper,
    Raydium,
    Crema { a_to_b: bool },
    Lifinity,
    Mercurial,
    Cykura,
    Serum { side: Side },
    MarinadeDeposit,
    MarinadeUnstake,
    Aldrin { side: Side },
    AldrinV2 { side: Side },
    Whirlpool { a_to_b: bool },
    Invariant { x_to_y: bool },
    Meteora,
    GooseFX,
    DeltaFi { stable: bool },
    Balansol,
    MarcoPolo { x_to_y: bool },
    Dradex { side: Side },
    LifinityV2,
    RaydiumClmm,
    Openbook { side: Side },
    Phoenix { side: Side },
    Symmetry { from_token_id: u64, to_token_id: u64 },
    TokenSwapV2,
    HeliumTreasuryManagementRedeemV0,
    StakeDexStakeWrappedSol,
    StakeDexSwapViaStake { bridge_stake_seed: u32 },
    GooseFXV2,
    Perps,
    PerpsAddLiquidity,
    PerpsRemoveLiquidity,
    MeteoraDlmm,
    OpenBookV2 { side: Side },
    RaydiumClmmV2,
}

/// Side enum for order book DEXes
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Side {
    Bid,
    Ask,
}

#[program]
pub mod mock_jupiter {
    use super::*;

    /// Mock of Jupiter's shared_accounts_route for CPI calls.
    /// Uses standard Anchor deserialization - no manual parsing needed!
    pub fn shared_accounts_route<'info>(
        ctx: Context<'_, '_, 'info, 'info, SharedAccountsRoute<'info>>,
        id: u8,
        route_plan: Vec<RoutePlanStep>,
        in_amount: u64,
        quoted_out_amount: u64,
        slippage_bps: u16,
        platform_fee_bps: u8,
    ) -> Result<u64> {
        require!(ctx.accounts.vault_authority.is_signer, MockJupiterError::InvalidAuthority);
        require!(in_amount > 0, MockJupiterError::InvalidAmount);
        require!(quoted_out_amount > 0, MockJupiterError::InvalidAmount);
        require!(slippage_bps <= 10_000, MockJupiterError::InvalidSlippage);
        require!(!route_plan.is_empty(), MockJupiterError::EmptyRoutePlan);

        // Mock: Simulate 1.5x output (150% of input)
        let simulated_output = in_amount
            .checked_mul(15)
            .ok_or(MockJupiterError::MathOverflow)?
            .checked_div(10)
            .ok_or(MockJupiterError::MathOverflow)?;
        let actual_output = std::cmp::min(simulated_output, quoted_out_amount);

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.mock_pool.to_account_info(),
                    to: ctx.accounts.vault_destination.to_account_info(),
                    authority: ctx.accounts.mock_pool_authority.to_account_info(),
                    mint: ctx.accounts.destination_mint.to_account_info(),
                },
            ),
            actual_output,
            ctx.accounts.destination_mint.decimals,
        )?;

        msg!("Mock Jupiter: shared_accounts_route completed. Output: {}", actual_output);
        Ok(actual_output)
    }

    /// Legacy route instruction (explicit args); kept for backward compatibility in tests that need it.
    pub fn route<'info>(
        ctx: Context<'_, '_, 'info, 'info, Route<'info>>,
        route_plan: Vec<RoutePlanStep>,
        in_amount: u64,
        quoted_out_amount: u64,
        slippage_bps: u16,
        platform_fee_bps: u8,
    ) -> Result<u64> {
        msg!("Mock Jupiter: route");
        require!(in_amount > 0, MockJupiterError::InvalidAmount);
        require!(quoted_out_amount > 0, MockJupiterError::InvalidAmount);
        require!(slippage_bps <= 10_000, MockJupiterError::InvalidSlippage);
        require!(!route_plan.is_empty(), MockJupiterError::EmptyRoutePlan);
        require!(
            ctx.accounts.user_source_token_account.amount >= in_amount,
            MockJupiterError::InsufficientBalance
        );

        let simulated_output = in_amount
            .checked_mul(15)
            .ok_or(MockJupiterError::MathOverflow)?
            .checked_div(10)
            .ok_or(MockJupiterError::MathOverflow)?;
        let actual_output = std::cmp::min(simulated_output, quoted_out_amount);

        require!(ctx.remaining_accounts.len() >= 2, MockJupiterError::MissingLiquidityPool);
        let liquidity_pool = &ctx.remaining_accounts[0];
        let pool_authority = &ctx.remaining_accounts[1];
        let pool_token_account = InterfaceAccount::<TokenAccount>::try_from(liquidity_pool)?;
        require!(
            pool_token_account.mint == ctx.accounts.destination_mint.key(),
            MockJupiterError::InvalidMint
        );
        require!(
            pool_token_account.amount >= actual_output,
            MockJupiterError::InsufficientBalance
        );

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: liquidity_pool.to_account_info(),
                    to: ctx.accounts.user_destination_token_account.to_account_info(),
                    authority: pool_authority.to_account_info(),
                    mint: ctx.accounts.destination_mint.to_account_info(),
                },
            ),
            actual_output,
            ctx.accounts.destination_mint.decimals,
        )?;

        msg!("Mock Jupiter: route completed. Output: {}", actual_output);
        Ok(actual_output)
    }
}


/// Mock shared_accounts_route: account order matches Jupiter IDL so Flipper can pass
/// the same remaining_accounts list. 0..12 = Jupiter fixed, 13=pool, 14=pool_authority.
#[derive(Accounts)]
pub struct SharedAccountsRoute<'info> {
    pub token_program: Interface<'info, TokenInterface>,
    /// program_authority (Jupiter PDA - placeholder in mock, not a signer)
    /// CHECK: Jupiter program authority
    pub program_authority: AccountInfo<'info>,
    /// user_transfer_authority (Flipper's vault_authority PDA - THIS is the signer)
    /// CHECK: validated as signer
    pub vault_authority: AccountInfo<'info>,
    /// CHECK: source_token_account
    pub source_token_account: AccountInfo<'info>,
    /// CHECK: program_source_token_account
    pub vault_source: AccountInfo<'info>,
    pub vault_destination: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: destination_token_account
    pub destination_token_account: AccountInfo<'info>,
    /// CHECK: source_mint
    pub source_mint: AccountInfo<'info>,
    pub destination_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: optional platform_fee
    pub platform_fee_account: AccountInfo<'info>,
    /// CHECK: optional token_2022
    pub token_2022_program: AccountInfo<'info>,
    /// CHECK: event_authority
    pub event_authority: AccountInfo<'info>,
    /// CHECK: program
    pub program: AccountInfo<'info>,
    /// Mock liquidity pool (destination mint tokens)
    /// CHECK: validated as token account in instruction
    pub mock_pool: AccountInfo<'info>,
    /// CHECK: pool authority for mock transfer
    pub mock_pool_authority: AccountInfo<'info>,
}

/// Jupiter route instruction accounts (legacy, explicit layout).
#[derive(Accounts)]
pub struct Route<'info> {
    /// SPL Token or Token-2022 program
    pub token_program: Interface<'info, TokenInterface>,
    
    /// User/authority initiating the swap (vault_authority PDA in Flipper's case)
    /// This account must sign the transaction
    pub user_transfer_authority: Signer<'info>,
    
    /// User's source token account (vault_source in Flipper)
    /// Tokens will be taken from this account
    #[account(
        mut,
        constraint = user_source_token_account.owner == user_transfer_authority.key() @ MockJupiterError::InvalidAuthority
    )]
    pub user_source_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// User's destination token account (vault_destination in Flipper)
    /// Tokens will be sent to this account
    #[account(mut)]
    pub user_destination_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// Optional destination token account override
    /// CHECK: Can be same as user_destination_token_account
    #[account(mut)]
    pub destination_token_account: AccountInfo<'info>,
    
    /// Destination token mint
    pub destination_mint: InterfaceAccount<'info, Mint>,
    
    /// Optional platform fee account
    /// CHECK: Optional account for collecting platform fees
    pub platform_fee_account: Option<AccountInfo<'info>>,
    
    /// Event authority PDA for Jupiter events
    /// CHECK: Jupiter event authority, not validated in mock
    pub event_authority: AccountInfo<'info>,
    
    /// Jupiter program itself
    /// CHECK: The Jupiter program ID
    pub program: AccountInfo<'info>,
}

#[error_code]
pub enum MockJupiterError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid slippage")]
    InvalidSlippage,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Empty route plan")]
    EmptyRoutePlan,
    #[msg("Missing liquidity pool account")]
    MissingLiquidityPool,
    #[msg("Missing pool authority")]
    MissingPoolAuthority,
    #[msg("Invalid mint")]
    InvalidMint,
}
