use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{Token, TokenAccount};
use crate::adapters::adapter_connector_module::{AdapterContext};
use crate::adapters::dex_adapter::DexAdapter;
use crate::errors::ErrorCode;
use crate::state::{Swap, SwapEvent, SwapResult, PoolInfo};

/// Adapter for interacting with the Raydium CPMM protocol
pub struct RaydiumAdapter {
    pub program_id: Pubkey, // Raydium CPMM program ID for CPI calls
}

// Program IDs
const TOKEN_PROGRAM_ID: Pubkey = anchor_spl::token::ID;
const TOKEN_2022_PROGRAM_ID: Pubkey = anchor_spl::token_2022::ID;

/// Raydium CPMM swap_base_input instruction discriminator
/// This is the first 8 bytes of the sha256 hash of "global:swap_base_input"
const SWAP_BASE_INPUT_DISCRIMINATOR: [u8; 8] = [143, 190, 90, 218, 196, 30, 51, 222];

/// Arguments for Raydium CPMM swap_base_input instruction
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SwapBaseInputArgs {
    pub amount_in: u64,             // Amount of input tokens to swap
    pub minimum_amount_out: u64,    // Minimum amount of output tokens expected
}

impl DexAdapter for RaydiumAdapter {
    /// Execute a swap through Raydium CPMM protocol
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        msg!("Executing Raydium CPMM swap_base_input, amount: {}", amount);

        // Ensure we have at least the required accounts for swap_base_input
        // From IDL: payer, authority, amm_config, pool_state, input_token_account,
        // output_token_account, input_vault, output_vault, input_token_program,
        // output_token_program, input_token_mint, output_token_mint, observation_state
        const MIN_ACCOUNTS: usize = 12;
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get slice of remaining accounts starting from our index
        let remaining_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..];

        // Validate pool is enabled
        let pool_info = Account::<PoolInfo>::try_from(&remaining_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        // Record initial output token balance for calculating swap result
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let initial_output_amount = output_vault_data.amount;

        // Create swap_base_input instruction arguments
        let swap_args = SwapBaseInputArgs {
            amount_in: amount,
            minimum_amount_out: 0, // No slippage protection in this example
        };

        // Prepare instruction data with discriminator and serialized arguments
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&SWAP_BASE_INPUT_DISCRIMINATOR);
        instruction_data.extend_from_slice(&swap_args.try_to_vec()?);

        // Build account metas for the instruction
        // Order must match Raydium CPMM swap_base_input interface exactly
        let accounts = vec![
            AccountMeta::new_readonly(ctx.authority.key(), true),       // payer (signer)
            AccountMeta::new_readonly(remaining_accounts[1].key(), false), // authority (PDA)
            AccountMeta::new_readonly(remaining_accounts[2].key(), false), // amm_config
            AccountMeta::new(remaining_accounts[3].key(), false),       // pool_state
            AccountMeta::new(ctx.input_account.key(), false),           // input_token_account
            AccountMeta::new(ctx.output_account.key(), false),          // output_token_account
            AccountMeta::new(remaining_accounts[4].key(), false),       // input_vault
            AccountMeta::new(remaining_accounts[5].key(), false),       // output_vault
            AccountMeta::new_readonly(remaining_accounts[6].key(), false), // input_token_program
            AccountMeta::new_readonly(remaining_accounts[7].key(), false), // output_token_program
            AccountMeta::new_readonly(remaining_accounts[8].key(), false), // input_token_mint
            AccountMeta::new_readonly(remaining_accounts[9].key(), false), // output_token_mint
            AccountMeta::new(remaining_accounts[10].key(), false),      // observation_state
        ];

        // Build AccountInfo vector
        let account_infos = vec![
            ctx.authority.clone(),          // payer
            remaining_accounts[1].clone(),  // authority
            remaining_accounts[2].clone(),  // amm_config
            remaining_accounts[3].clone(),  // pool_state
            ctx.input_account.clone(),      // input_token_account
            ctx.output_account.clone(),     // output_token_account
            remaining_accounts[4].clone(),  // input_vault
            remaining_accounts[5].clone(),  // output_vault
            remaining_accounts[6].clone(),  // input_token_program
            remaining_accounts[7].clone(),  // output_token_program
            remaining_accounts[8].clone(),  // input_token_mint
            remaining_accounts[9].clone(),  // output_token_mint
            remaining_accounts[10].clone(), // observation_state
        ];

        // Create the instruction
        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        };

        // Execute CPI call with proper signer seeds
        let (vault_authority_pda, vault_authority_bump) = Pubkey::find_program_address(
            &[b"vault_authority"],
            &ctx.program_id,
        );

        let authority_seeds: &[&[u8]] = &[b"vault_authority", &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

        invoke_signed(&instruction, &account_infos, signer_seeds)?;

        // Calculate output amount by checking balance difference
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let output_amount = output_vault_data.amount
            .checked_sub(initial_output_amount)
            .ok_or(ErrorCode::InvalidCalculation)?;

        msg!("Raydium CPMM swap_base_input completed, output amount: {}", output_amount);

        Ok(SwapResult { output_amount })
    }

    /// Validate that all required accounts are provided and valid
    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        const MIN_ACCOUNTS: usize = 12;

        // Ensure minimum required accounts are present
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get efficient slice access
        let remaining_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..];

        // Validate pool is enabled and matches expected address
        let pool_info = Account::<PoolInfo>::try_from(&remaining_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let pool_state = &remaining_accounts[3];
        if pool_info.pool_address != pool_state.key() {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate authority PDA (seeds = [b"vault_and_lp_mint_auth_seed"])
        let authority = &remaining_accounts[1];
        let expected_authority = Pubkey::find_program_address(
            &[b"vault_and_lp_mint_auth_seed"],
            &self.program_id,
        ).0;

        if authority.key() != expected_authority {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Validate token programs are correct (SPL Token or Token2022)
        let input_token_program = &remaining_accounts[6];
        let output_token_program = &remaining_accounts[7];

        let valid_token_programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
        if !valid_token_programs.contains(&input_token_program.key())
            || !valid_token_programs.contains(&output_token_program.key())
        {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Ensure critical accounts are not default (empty) pubkeys
        if pool_state.key() == Pubkey::default() {
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