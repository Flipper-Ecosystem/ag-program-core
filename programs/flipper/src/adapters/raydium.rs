use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token_interface::TokenAccount;
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
        remaining_accounts_count: usize,
    ) -> Result<SwapResult> {

        const MIN_ACCOUNTS: usize = 11;

        if remaining_accounts_count < MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get adapter-specific slice of remaining accounts
        let end_index = remaining_accounts_start_index + remaining_accounts_count;
        if ctx.remaining_accounts.len() < end_index {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let adapter_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..end_index];

        // Validate pool is enabled (pool_info is at index 0)
        let pool_info = Account::<PoolInfo>::try_from(&adapter_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        // Record initial output token balance for calculating swap result
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let initial_output_amount = output_vault_data.amount;

        // Create swap_base_input instruction arguments
        let swap_args = SwapBaseInputArgs {
            amount_in: amount,
            minimum_amount_out: 0,
        };

        // Prepare instruction data
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&SWAP_BASE_INPUT_DISCRIMINATOR);
        instruction_data.extend_from_slice(&swap_args.try_to_vec()?);

        // Build account metas using adapter_accounts (skip pool_info at index 0)
        let accounts = vec![
            AccountMeta::new_readonly(ctx.authority.key(), true),           // payer (signer)
            AccountMeta::new_readonly(adapter_accounts[1].key(), false),    // authority (PDA)
            AccountMeta::new_readonly(adapter_accounts[2].key(), false),    // amm_config
            AccountMeta::new(adapter_accounts[3].key(), false),             // pool_state
            AccountMeta::new(ctx.input_account.key(), false),               // input_token_account
            AccountMeta::new(ctx.output_account.key(), false),              // output_token_account
            AccountMeta::new(adapter_accounts[4].key(), false),             // input_vault
            AccountMeta::new(adapter_accounts[5].key(), false),             // output_vault
            AccountMeta::new_readonly(adapter_accounts[6].key(), false),    // input_token_program
            AccountMeta::new_readonly(adapter_accounts[7].key(), false),    // output_token_program
            AccountMeta::new_readonly(adapter_accounts[8].key(), false),    // input_token_mint
            AccountMeta::new_readonly(adapter_accounts[9].key(), false),    // output_token_mint
            AccountMeta::new(adapter_accounts[10].key(), false),            // observation_state
        ];

        // Build AccountInfo vector
        let account_infos = vec![
            ctx.authority.clone(),          // payer
            adapter_accounts[1].clone(),    // authority
            adapter_accounts[2].clone(),    // amm_config
            adapter_accounts[3].clone(),    // pool_state
            ctx.input_account.clone(),      // input_token_account
            ctx.output_account.clone(),     // output_token_account
            adapter_accounts[4].clone(),    // input_vault
            adapter_accounts[5].clone(),    // output_vault
            adapter_accounts[6].clone(),    // input_token_program
            adapter_accounts[7].clone(),    // output_token_program
            adapter_accounts[8].clone(),    // input_token_mint
            adapter_accounts[9].clone(),    // output_token_mint
            adapter_accounts[10].clone(),   // observation_state
        ];

        // Create the instruction
        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        };

        // Find vault authority PDA and verify that ctx.authority matches it
        let (vault_authority_pda, vault_authority_bump) = Pubkey::find_program_address(
            &[b"vault_authority"],
            &ctx.program_id,
        );

        // Verify that ctx.authority matches our calculated PDA
        if ctx.authority.key() != vault_authority_pda {
            return Err(ErrorCode::InvalidAccount.into());
        }

        // Prepare signer seeds for CPI call
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

    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
        remaining_accounts_count: usize,
    ) -> Result<()> {
        const MIN_ACCOUNTS: usize = 11;

        if remaining_accounts_count < MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get adapter-specific slice of remaining accounts
        let end_index = remaining_accounts_start_index + remaining_accounts_count;
        if ctx.remaining_accounts.len() < end_index {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let adapter_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..end_index];

        // Validate pool is enabled (pool_info is at index 0)
        let pool_info = Account::<PoolInfo>::try_from(&adapter_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let pool_state = &adapter_accounts[3]; // pool_state is at index 3 in adapter_accounts
        if pool_info.pool_address != pool_state.key() {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate authority PDA
        let authority = &adapter_accounts[1];
        let expected_authority = Pubkey::find_program_address(
            &[b"vault_and_lp_mint_auth_seed"],
            &self.program_id,
        ).0;

        if authority.key() != expected_authority {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Validate token programs are correct
        let input_token_program = &adapter_accounts[6];
        let output_token_program = &adapter_accounts[7];

        let valid_token_programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
        if !valid_token_programs.contains(&input_token_program.key())
            || !valid_token_programs.contains(&output_token_program.key())
        {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Ensure critical accounts are not default
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