use anchor_lang::prelude::*; // Core Anchor types and macros
use crate::adapters::{AdapterContext, dex_adapter::DexAdapter}; // Adapter context and trait
use crate::errors::ErrorCode; // Custom error codes for the program
use crate::state::SwapResult; // Struct to return swap output amount
use anchor_lang::solana_program::program::invoke_signed; // Solana CPI invocation
use anchor_lang::solana_program::instruction::Instruction; // Solana instruction struct
use anchor_spl::token::{TokenAccount, Token}; // SPL token types for account deserialization

// Struct representing the Whirlpool swap instruction data, matching the Whirlpool program's IDL
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct WhirlpoolSwapInstruction {
    pub amount: u64, // Input amount for the swap (exact input)
    pub other_amount_threshold: u64, // Minimum output amount to prevent excessive slippage
    pub sqrt_price_limit: u128, // Maximum/minimum price limit for the swap (0 for no limit)
    pub amount_specified_is_input: bool, // True if amount is input, false if output
    pub a_to_b: bool, // Swap direction (true: token A to B, false: token B to A)
}

// Adapter for interacting with the Whirlpool DEX protocol
pub struct WhirlpoolAdapter {
    pub program_id: Pubkey, // Whirlpool program ID (whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc)
    pub a_to_b: bool, // Swap direction (true for A-to-B, false for B-to-A)
}

// Implementation of the DexAdapter trait for Whirlpool
impl DexAdapter for WhirlpoolAdapter {
    // Executes a swap on the Whirlpool protocol using a CPI to the Whirlpool program
    fn execute_swap(
        &self,
        ctx: AdapterContext, // Context containing accounts and program data
        amount: u64, // Input amount for the swap
        remaining_accounts_start_index: usize, // Starting index for DEX-specific accounts in remaining_accounts
    ) -> Result<SwapResult> {
        // Log swap execution details for debugging
        msg!("Executing Whirlpool swap, a_to_b: {}, amount: {}", self.a_to_b, amount);

        // Check if enough accounts are provided for the Whirlpool swap (requires 9 accounts: pool, token program, token accounts, vaults, 3 tick arrays, oracle)
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 7 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Extract accounts from remaining_accounts, as provided by the Jupiter router
        let pool_account = &ctx.remaining_accounts[remaining_accounts_start_index]; // Whirlpool pool account
        let token_program = &ctx.token_program; // SPL token program
        let token_owner_account_a = &ctx.remaining_accounts[remaining_accounts_start_index + 1]; // Input token account
        let token_owner_account_b = &ctx.remaining_accounts[remaining_accounts_start_index + 2]; // Output token account
        let token_vault_a = &ctx.remaining_accounts[remaining_accounts_start_index + 3]; // Pool's token vault A
        let token_vault_b = &ctx.remaining_accounts[remaining_accounts_start_index + 4]; // Pool's token vault B
        let tick_array_0 = &ctx.remaining_accounts[remaining_accounts_start_index + 5]; // First tick array (contains current tick)
        let tick_array_1 = &ctx.remaining_accounts[remaining_accounts_start_index + 6]; // Second tick array (for price range crossing)
        let tick_array_2 = &ctx.remaining_accounts[remaining_accounts_start_index + 7]; // Third tick array (for price range crossing)
        let oracle = &ctx.remaining_accounts[remaining_accounts_start_index + 8]; // Oracle account for price data

        // Deserialize the output token account to get its initial balance before the swap
        let output_account: Account<TokenAccount> = Account::try_from(token_owner_account_b)?;
        let initial_balance = output_account.amount;
        // Log initial balance for debugging
        msg!("Initial output balance: {}", initial_balance);

        // Construct the Whirlpool swap instruction data
        // Note: other_amount_threshold is set to 0, disabling slippage protection (to be improved with swap_quote_a)
        let swap_instruction = WhirlpoolSwapInstruction {
            amount, // Input amount
            other_amount_threshold: 0, // Set to 0 for exact input swap (no minimum output enforced)
            sqrt_price_limit: 0, // No price limit for simplicity (allows swap at any price)
            amount_specified_is_input: true, // Specifies amount is input (exact input swap)
            a_to_b: self.a_to_b, // Swap direction
        };

        // Prepare accounts for the CPI to the Whirlpool program
        // AccountMeta specifies each account's properties (is_writable, is_signer)
        let accounts = vec![
            AccountMeta::new_readonly(ctx.authority.key(), true), // Authority (signer)
            AccountMeta::new_readonly(token_program.key(), false), // Token program
            AccountMeta::new(pool_account.key(), false), // Pool account (mutable for state updates)
            AccountMeta::new(token_owner_account_a.key(), false), // Input token account (mutable)
            AccountMeta::new(token_owner_account_b.key(), false), // Output token account (mutable)
            AccountMeta::new(token_vault_a.key(), false), // Token vault A (mutable)
            AccountMeta::new(token_vault_b.key(), false), // Token vault B (mutable)
            AccountMeta::new(tick_array_0.key(), false), // Tick array 0 (mutable for tick updates)
            AccountMeta::new(tick_array_1.key(), false), // Tick array 1 (mutable for tick updates)
            AccountMeta::new(tick_array_2.key(), false), // Tick array 2 (mutable for tick updates)
            AccountMeta::new_readonly(oracle.key(), false), // Oracle (read-only for price data)
        ];


        let instruction_data = swap_instruction.try_to_vec()?;
        // TODO: Whilpool  swap instruction discriminator from IDL, change it to right
        let discriminator =  [246, 198, 69, 84, 45, 183, 178, 109];
        let mut full_instruction_data = Vec::new();
        full_instruction_data.extend_from_slice(&discriminator);
        full_instruction_data.extend_from_slice(&instruction_data);

        // Create the instruction
        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: full_instruction_data,
        };

        // Execute the CPI to the Whirlpool program
        invoke_signed(
            &instruction,
            &[
                ctx.authority.clone(),
                token_program.clone(),
                pool_account.clone(),
                token_owner_account_a.clone(),
                token_owner_account_b.clone(),
                token_vault_a.clone(),
                token_vault_b.clone(),
                tick_array_0.clone(),
                tick_array_1.clone(),
                tick_array_2.clone(),
                oracle.clone(),
            ],
            &[], // No additional signers needed
        )?;

        // Reload the output token account to get its balance after the swap
        let output_account: Account<TokenAccount> = Account::try_from(token_owner_account_b)?;
        let final_balance = output_account.amount;
        // Log final balance for debugging
        msg!("Final output balance: {}", final_balance);

        // Calculate the output amount as the difference between final and initial balances
        // Returns InvalidCalculation if final_balance < initial_balance, indicating a swap failure
        let output_amount = final_balance
            .checked_sub(initial_balance)
            .ok_or_else(|| {
                msg!("Invalid swap output: final_balance ({}) < initial_balance ({})", final_balance, initial_balance);
                ErrorCode::InvalidCalculation
            })?;

        // Log the output amount for debugging
        msg!("Swap output amount: {}", output_amount);

        // Return the swap result with the calculated output amount
        Ok(SwapResult { output_amount })
    }

    // Validates accounts for a Whirlpool swap to ensure they are correct before executing the CPI
    fn validate_accounts(
        &self,
        ctx: AdapterContext, // Context containing accounts
        remaining_accounts_start_index: usize, // Starting index for DEX-specific accounts
    ) -> Result<()> {
        // Check if enough accounts are provided (requires 9 accounts)
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 7 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Validate that the pool account is a supported Whirlpool pool
        let pool_account = &ctx.remaining_accounts[remaining_accounts_start_index];
 

        // Optional: Validate pool account ownership (uncomment if needed)
        // Ensures the pool account is owned by the Whirlpool program
        // if pool_account.owner != &self.program_id {
        //     return Err(ErrorCode::InvalidPoolAddress.into());
        // }

        // Extract Whirlpool-specific accounts from remaining_accounts
        let token_owner_account_a = &ctx.remaining_accounts[remaining_accounts_start_index + 1]; // Input token account
        let token_owner_account_b = &ctx.remaining_accounts[remaining_accounts_start_index + 2]; // Output token account
        let token_vault_a = &ctx.remaining_accounts[remaining_accounts_start_index + 3]; // Token vault A
        let token_vault_b = &ctx.remaining_accounts[remaining_accounts_start_index + 4]; // Token vault B
        let tick_array_0 = &ctx.remaining_accounts[remaining_accounts_start_index + 5]; // Tick array 0
        let tick_array_1 = &ctx.remaining_accounts[remaining_accounts_start_index + 6]; // Tick array 1
        let tick_array_2 = &ctx.remaining_accounts[remaining_accounts_start_index + 7]; // Tick array 2
        let oracle = &ctx.remaining_accounts[remaining_accounts_start_index + 8]; // Oracle account

        // Validate that no accounts have a zero Pubkey, ensuring they are properly initialized
        // This prevents invalid accounts from being used in the swap
        if token_owner_account_a.key() == Pubkey::default()
            || token_owner_account_b.key() == Pubkey::default()
            || token_vault_a.key() == Pubkey::default()
            || token_vault_b.key() == Pubkey::default()
            || tick_array_0.key() == Pubkey::default()
            || tick_array_1.key() == Pubkey::default()
            || tick_array_2.key() == Pubkey::default()
            || oracle.key() == Pubkey::default()
        {
            return Err(ErrorCode::InvalidAccount.into());
        }

        // Return Ok if all validations pass
        Ok(())
    }

    // Validates that the CPI program ID matches the expected Whirlpool program ID
    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()> {
        if *program_id != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }
        Ok(())
    }
}