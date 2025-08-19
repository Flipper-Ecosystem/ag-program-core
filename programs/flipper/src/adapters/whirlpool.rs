use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{Token, TokenAccount};
use crate::adapters::adapter_connector_module::{AdapterContext};
use crate::adapters::dex_adapter::DexAdapter;
use crate::errors::ErrorCode;
use crate::state::{Swap, SwapEvent, SwapResult, PoolInfo};

/// Adapter for interacting with the Whirlpool protocol
pub struct WhirlpoolAdapter {
    pub program_id: Pubkey, // Whirlpool program ID for CPI calls
    pub a_to_b: bool
}

// Program IDs from anchor-spl
const TOKEN_PROGRAM_ID: Pubkey = anchor_spl::token::ID;
const TOKEN_2022_PROGRAM_ID: Pubkey = anchor_spl::token_2022::ID;

/// Whirlpool swapV2 instruction discriminator
/// This is the first 8 bytes of the sha256 hash of "global:swapV2"
/// From IDL: swapV2 is at index 48, so we calculate the discriminator
const SWAP_V2_DISCRIMINATOR: [u8; 8] = [43, 4, 237, 11, 26, 201, 30, 98];

/// Arguments for Whirlpool swapV2 instruction
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SwapV2Args {
    pub amount: u64,                              // Amount of input tokens to swap
    pub other_amount_threshold: u64,              // Minimum amount of output tokens expected
    pub sqrt_price_limit: u128,                   // Price limit for the swap (0 for no limit)
    pub amount_specified_is_input: bool,          // True if amount is input, false if output
    pub a_to_b: bool,                            // Swap direction (true: A to B, false: B to A)
    pub remaining_accounts_info: Option<RemainingAccountsInfo>, // Info about remaining accounts
}

/// Information about remaining accounts structure
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,      // Array of account slices
}

/// Describes a slice of remaining accounts
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RemainingAccountsSlice {
    pub accounts_type: AccountsType,              // Type of accounts in this slice
    pub length: u8,                               // Number of accounts in this slice
}

/// Types of accounts that can be in remaining accounts
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub enum AccountsType {
    TransferHookA,
    TransferHookB,
    TransferHookReward,
    TransferHookInput,
    TransferHookIntermediate,
    TransferHookOutput,
    SupplementalTickArrays,                      // Additional tick arrays for large swaps
    SupplementalTickArraysOne,
    SupplementalTickArraysTwo,
}

impl DexAdapter for WhirlpoolAdapter {
    /// Execute a swap through Whirlpool protocol
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        msg!("Executing Whirlpool swapV2, amount: {}", amount);

        // Ensure we have at least 16 required accounts for swapV2
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 16 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get slice of remaining accounts starting from our index for efficient access
        let remaining_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..];

        // Validate pool is enabled
        let pool_info = Account::<PoolInfo>::try_from(&remaining_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        // Calculate number of supplemental tick arrays available (max 20 allowed by Whirlpool)
        let supplemental_tick_arrays_count = ((remaining_accounts.len() - 16).min(20)) as u8;

        // Record initial output token balance for calculating swap result
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let initial_output_amount = output_vault_data.amount;

        // Determine swap direction based on token accounts
        let whirlpool_data = &remaining_accounts[1].data.borrow();
        let token_mint_a = Pubkey::try_from(&whirlpool_data[73..105]).map_err(|_| ErrorCode::InvalidAccount)?;
        let token_mint_b = Pubkey::try_from(&whirlpool_data[137..169]).map_err(|_| ErrorCode::InvalidAccount)?;

        let input_mint_data = TokenAccount::try_deserialize(&mut ctx.input_account.data.borrow().as_ref())?;
        let a_to_b = input_mint_data.mint == token_mint_a;

        if (self.a_to_b != a_to_b) {
            return Err(ErrorCode::InvalidMint.into());
        }

        // Create swapV2 instruction arguments
        let swap_args = SwapV2Args {
            amount,
            other_amount_threshold: 0, // No slippage protection in this example
            sqrt_price_limit: 0,       // No price limit
            amount_specified_is_input: true, // Always exact input
            a_to_b,
            remaining_accounts_info: if supplemental_tick_arrays_count > 0 {
                Some(RemainingAccountsInfo {
                    slices: vec![RemainingAccountsSlice {
                        accounts_type: AccountsType::SupplementalTickArrays,
                        length: supplemental_tick_arrays_count,
                    }],
                })
            } else {
                None
            },
        };

        // Prepare instruction data with discriminator and serialized arguments
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&SWAP_V2_DISCRIMINATOR);
        instruction_data.extend_from_slice(&swap_args.try_to_vec()?);

        // Build account metas for the swapV2 instruction
        // Order must match Whirlpool swapV2 interface exactly
        let mut accounts = vec![
            AccountMeta::new_readonly(remaining_accounts[2].key(), false),  // tokenProgramA
            AccountMeta::new_readonly(remaining_accounts[3].key(), false),  // tokenProgramB
            AccountMeta::new_readonly(remaining_accounts[4].key(), false),  // memoProgram
            AccountMeta::new_readonly(ctx.authority.key(), true),           // tokenAuthority (signer)
            AccountMeta::new(remaining_accounts[1].key(), false),           // whirlpool
            AccountMeta::new_readonly(remaining_accounts[5].key(), false),  // tokenMintA
            AccountMeta::new_readonly(remaining_accounts[6].key(), false),  // tokenMintB
            AccountMeta::new(ctx.input_account.key(), false),               // tokenOwnerAccountA/B (input)
            AccountMeta::new(remaining_accounts[7].key(), false),           // tokenVaultA
            AccountMeta::new(ctx.output_account.key(), false),              // tokenOwnerAccountB/A (output)
            AccountMeta::new(remaining_accounts[8].key(), false),           // tokenVaultB
            AccountMeta::new(remaining_accounts[9].key(), false),           // tickArray0
            AccountMeta::new(remaining_accounts[10].key(), false),          // tickArray1
            AccountMeta::new(remaining_accounts[11].key(), false),          // tickArray2
            AccountMeta::new(remaining_accounts[12].key(), false),          // oracle
        ];

        // Add supplemental tick arrays to account metas (dynamic part)
        for i in 0..supplemental_tick_arrays_count {
            accounts.push(AccountMeta::new(remaining_accounts[16 + i as usize].key(), false));
        }

        // Build AccountInfo vector
        let mut account_infos = vec![
            remaining_accounts[2].clone(),   // tokenProgramA
            remaining_accounts[3].clone(),   // tokenProgramB
            remaining_accounts[4].clone(),   // memoProgram
            ctx.authority.clone(),           // tokenAuthority
            remaining_accounts[1].clone(),   // whirlpool
            remaining_accounts[5].clone(),   // tokenMintA
            remaining_accounts[6].clone(),   // tokenMintB
            ctx.input_account.clone(),       // tokenOwnerAccount (input)
            remaining_accounts[7].clone(),   // tokenVaultA
            ctx.output_account.clone(),      // tokenOwnerAccount (output)
            remaining_accounts[8].clone(),   // tokenVaultB
            remaining_accounts[9].clone(),   // tickArray0
            remaining_accounts[10].clone(),  // tickArray1
            remaining_accounts[11].clone(),  // tickArray2
            remaining_accounts[12].clone(),  // oracle
        ];

        // Add dynamic supplemental tick arrays
        for i in 0..supplemental_tick_arrays_count {
            account_infos.push(remaining_accounts[16 + i as usize].clone());
        }

        // Create the instruction
        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        };

        // Find PDA for vault authority with proper seed derivation
        let (vault_authority_pda, vault_authority_bump) = Pubkey::find_program_address(
            &[b"vault_authority"],
            &ctx.program_id,
        );

        // Verify that ctx.authority matches our calculated PDA
        if ctx.authority.key() != vault_authority_pda {
            return Err(ErrorCode::InvalidAccount.into());
        }

        // Execute CPI call with proper signer seeds
        let authority_seeds: &[&[u8]] = &[b"vault_authority", &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

        invoke_signed(&instruction, &account_infos, signer_seeds)?;

        // Calculate output amount by checking balance difference
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let output_amount = output_vault_data.amount
            .checked_sub(initial_output_amount)
            .ok_or(ErrorCode::InvalidCalculation)?;

        msg!("Whirlpool swapV2 completed, output amount: {}", output_amount);

        Ok(SwapResult { output_amount })
    }

    /// Validate that all required accounts are provided and valid
    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        // Ensure minimum required accounts are present
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 16 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get efficient slice access
        let remaining_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..];

        // Validate pool is enabled and matches expected address
        let pool_info = Account::<PoolInfo>::try_from(&remaining_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let whirlpool = &remaining_accounts[1];
        if pool_info.pool_address != whirlpool.key() {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate token programs are correct (SPL Token or Token2022)
        let token_program_a = &remaining_accounts[2];
        let token_program_b = &remaining_accounts[3];

        let valid_token_programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
        if !valid_token_programs.contains(&token_program_a.key())
            || !valid_token_programs.contains(&token_program_b.key())
        {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Validate whirlpool program ownership
        if whirlpool.owner != &self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Ensure critical accounts are not default (empty) pubkeys
        if whirlpool.key() == Pubkey::default()
            || remaining_accounts[7].key() == Pubkey::default() // tokenVaultA
            || remaining_accounts[8].key() == Pubkey::default() // tokenVaultB
        {
            return Err(ErrorCode::InvalidAccount.into());
        }

        // Validate tick arrays are not default
        for i in 9..=11 {
            if remaining_accounts[i].key() == Pubkey::default() {
                return Err(ErrorCode::InvalidAccount.into());
            }
        }

        // Validate oracle account
        if remaining_accounts[12].key() == Pubkey::default() {
            return Err(ErrorCode::InvalidAccount.into());
        }

        Ok(())
    }

    /// Validate CPI call is targeting correct program
    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()> {
        if *program_id != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }
        Ok(())
    }
}