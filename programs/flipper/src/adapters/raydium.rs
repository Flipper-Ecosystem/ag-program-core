use std::str::FromStr;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_spl::token::{Token, TokenAccount};
use crate::adapters::{AdapterContext, dex_adapter::DexAdapter};
use crate::errors::ErrorCode;
use crate::state::SwapResult;
use anchor_lang::solana_program::instruction::Instruction; // Solana instruction struct

// Adapter for interacting with the Raydium CPMM protocol
pub struct RaydiumAdapter {
    pub program_id: Pubkey,       // Program ID of the Raydium CPMM protocol
}

// Raydium CPMM swap instruction data
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RaydiumSwapInstruction {
    pub amount_specified: u64,
    pub other_amount_threshold: u64,
}

// Implementation of the DexAdapter trait for Raydium CPMM
impl DexAdapter for RaydiumAdapter {
    // Executes a swap on the Raydium CPMM protocol
    // # Arguments
    // * `ctx` - Context with account references for the swap
    // * `amount` - Input token amount to swap
    // * `remaining_accounts_start_index` - Index for accessing remaining accounts
    // # Returns
    // * `Result<SwapResult>` - Result with the output amount
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        // Log swap execution for debugging
        msg!("Executing Raydium CPMM swap with amount: {}", amount);

        // Validate sufficient accounts (14 accounts required for Raydium CPMM swap)
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 14 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get pool account and validate it
        let pool_account = &ctx.remaining_accounts[remaining_accounts_start_index];

        // Raydium CPMM swap accounts (based on IDL):
        // 0. payer (vault authority)
        // 1. authority (PDA)
        // 2. amm_config
        // 3. pool_state (writable)
        // 4. input_token_account (writable, vault)
        // 5. output_token_account (writable, vault or user account)
        // 6. input_vault (writable)
        // 7. output_vault (writable)
        // 8. token_program
        // 9. token_program_2022
        // 10. input_token_mint
        // 11. output_token_mint
        // 12. input_vault_program
        // 13. output_vault_program
        // 14. observation (writable)
        let accounts = vec![
            AccountMeta::new_readonly(ctx.authority.key(), true), // payer
            AccountMeta::new_readonly(ctx.remaining_accounts[remaining_accounts_start_index + 1].key(), false), // authority PDA
            AccountMeta::new_readonly(ctx.remaining_accounts[remaining_accounts_start_index + 2].key(), false), // amm_config
            AccountMeta::new(ctx.remaining_accounts[remaining_accounts_start_index].key(), false), // pool_state
            AccountMeta::new(ctx.input_account.key(), false), // input_token_account
            AccountMeta::new(ctx.output_account.key(), false), // output_token_account
            AccountMeta::new(ctx.remaining_accounts[remaining_accounts_start_index + 3].key(), false), // input_vault
            AccountMeta::new(ctx.remaining_accounts[remaining_accounts_start_index + 4].key(), false), // output_vault
            AccountMeta::new_readonly(ctx.token_program.key(), false), // token_program
            AccountMeta::new_readonly(anchor_lang::solana_program::pubkey::Pubkey::from_str("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb").unwrap(), false), // token_program_2022
            AccountMeta::new_readonly(ctx.remaining_accounts[remaining_accounts_start_index + 5].key(), false), // input_token_mint
            AccountMeta::new_readonly(ctx.remaining_accounts[remaining_accounts_start_index + 6].key(), false), // output_token_mint
            AccountMeta::new_readonly(ctx.remaining_accounts[remaining_accounts_start_index + 7].key(), false), // input_vault_program
            AccountMeta::new_readonly(ctx.remaining_accounts[remaining_accounts_start_index + 8].key(), false), // output_vault_program
            AccountMeta::new(ctx.remaining_accounts[remaining_accounts_start_index + 9].key(), false), // observation
        ];

        // Construct Raydium CPMM swap instruction
        let swap_instruction_data = RaydiumSwapInstruction {
            amount_specified: amount,
            other_amount_threshold: 0, // Set to 0 for simplicity; adjust for slippage control
        };
        let instruction_data = swap_instruction_data.try_to_vec()?;

        // Raydium CPMM swap instruction discriminator from IDL
        let discriminator = [246, 198, 69, 84, 45, 183, 178, 109];
        let mut full_instruction_data = Vec::new();
        full_instruction_data.extend_from_slice(&discriminator);
        full_instruction_data.extend_from_slice(&instruction_data);

        // Create the instruction
        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: full_instruction_data,
        };

        invoke_signed(
            &instruction,
            &[
                ctx.authority.clone(),
                ctx.remaining_accounts[remaining_accounts_start_index + 1].clone(), // authority PDA
                ctx.remaining_accounts[remaining_accounts_start_index + 2].clone(), // amm_config
                ctx.remaining_accounts[remaining_accounts_start_index].clone(), // pool_state
                ctx.input_account.clone(), // input_token_account
                ctx.output_account.clone(), // output_token_account
                ctx.remaining_accounts[remaining_accounts_start_index + 3].clone(), // input_vault
                ctx.remaining_accounts[remaining_accounts_start_index + 4].clone(), // output_vault
                ctx.token_program.clone(), // token_program
                ctx.remaining_accounts[remaining_accounts_start_index + 5].clone(), // input_token_mint
                ctx.remaining_accounts[remaining_accounts_start_index + 6].clone(), // output_token_mint
                ctx.remaining_accounts[remaining_accounts_start_index + 7].clone(), // input_vault_program
                ctx.remaining_accounts[remaining_accounts_start_index + 8].clone(), // output_vault_program
                ctx.remaining_accounts[remaining_accounts_start_index + 9].clone(), // observation
            ],
            &[], // No additional signers needed
        )?;

        // Check output token account balance to determine output amount
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let output_amount = output_vault_data.amount;

        msg!("Raydium CPMM swap completed. Output amount: {}", output_amount);

        Ok(SwapResult { output_amount })
    }

    // Validates accounts for a Raydium CPMM swap
    // # Arguments
    // * `ctx` - Context with account references to validate
    // * `remaining_accounts_start_index` - Index for accessing remaining accounts
    // # Returns
    // * `Result<()>` - Ok if accounts are valid, error if insufficient or incorrect
    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        // Check if enough remaining accounts are provided (14 for Raydium CPMM)
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 14 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Validate pool account address
        let pool_account = &ctx.remaining_accounts[remaining_accounts_start_index];


        // Validate pool account ownership
        if pool_account.owner != &self.program_id {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate token vaults
        let input_vault = &ctx.remaining_accounts[remaining_accounts_start_index + 3];
        let output_vault = &ctx.remaining_accounts[remaining_accounts_start_index + 4];
        if input_vault.owner != &self.program_id || output_vault.owner != &self.program_id {
            return Err(ErrorCode::InvalidVaultAddress.into());
        }

        // Validate input and output token accounts
        let input_token_account = TokenAccount::try_deserialize(&mut ctx.input_account.data.borrow().as_ref())?;
        let output_token_account = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        if input_token_account.mint != ctx.remaining_accounts[remaining_accounts_start_index + 5].key()
            || output_token_account.mint != ctx.remaining_accounts[remaining_accounts_start_index + 6].key() {
            return Err(ErrorCode::InvalidMint.into());
        }

        // Validate authority PDA
        let authority = &ctx.remaining_accounts[remaining_accounts_start_index + 1];
        let expected_authority = Pubkey::find_program_address(
            &[b"vault_and_lp_mint_auth_seed"],
            &self.program_id,
        ).0;
        if authority.key() != expected_authority {
            return Err(ErrorCode::InvalidAuthority .into());
        }

        // Validate observation account
        let observation = &ctx.remaining_accounts[remaining_accounts_start_index + 9];
        if observation.owner != &self.program_id {
            return Err(ErrorCode::InvalidAuthority .into());
        }

        Ok(())
    }

    // Validates the CPI program ID for Raydium CPMM
    // # Arguments
    // * `program_id` - Program ID to validate against
    // # Returns
    // * `Result<()>` - Ok if valid, error if mismatched
    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()> {
        if *program_id != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }
        Ok(())
    }
}