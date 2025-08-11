use anchor_lang::prelude::*; // Core Anchor types and macros
use anchor_lang::solana_program::instruction::Instruction; // Solana instruction struct
use anchor_lang::solana_program::program::invoke_signed; // Solana CPI invocation
use anchor_spl::token::{Token, TokenAccount}; // SPL token types for account deserialization
use crate::adapters::{AdapterContext, DexAdapter}; // Adapter context and trait for swap operations
use crate::errors::ErrorCode; // Custom error codes for the program
use crate::state::{Swap, SwapEvent, SwapResult}; // State structs for swap type, event, and result


// Adapter for interacting with the Meteora DLMM protocol
pub struct MeteoraAdapter {
    pub program_id: Pubkey, // Meteora program ID for CPI calls
    pub pool_addresses: Vec<Pubkey>, // List of supported Meteora pool addresses
}

// SPL Token Program ID (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
const TOKEN_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93,
    0xd9, 0xcb, 0xe1, 0x46, 0x27, 0xc0, 0xf7, 0xf9,
    0xf6, 0x95, 0x01, 0x0a, 0x43, 0x3c, 0x8d, 0x5c,
    0xc1, 0x3f, 0x25, 0x6b, 0xf0, 0x7a, 0x3a, 0x14
]);

// SPL Token2022 Program ID (TokenzQdBNbLqP5W5zr3ePA9Qub3V4y3yW7Nkr3X3Rw)
const TOKEN_2022_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x7a, 0x51, 0x64,
    0x42, 0x4e, 0x62, 0x4c, 0x71, 0x50, 0x35, 0x57,
    0x35, 0x7a, 0x72, 0x33, 0x65, 0x50, 0x41, 0x39,
    0x51, 0x75, 0x62, 0x33, 0x56, 0x34, 0x79, 0x33
]);


// Struct representing the Meteora swap2 instruction data, matching the Meteora IDL
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct MeteoraSwapInstruction {
    pub in_amount: u64, // Input amount for the swap (exact input)
    pub out_amount_min: u64, // Minimum output amount to prevent excessive slippage
    pub host_fee: u64, // Host fee amount (based on HOST_FEE_BPS = 2000 = 20%)
    pub remaining_accounts_info: RemainingAccountsInfo, // Indices for bin array accounts
}

// Struct for remaining accounts info (based on Meteora IDL's RemainingAccountsInfo)
// Specifies indices of bin array accounts in remaining_accounts
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RemainingAccountsInfo {
    pub bin_arrays: Vec<u8>, // Indices for bin array accounts (e.g., [10, 11, 12])
}


impl DexAdapter for MeteoraAdapter {
    // Executes a swap on the Meteora DLMM protocol using a CPI to the swap2 instruction
    // # Arguments
    // * `ctx` - Context containing accounts and program data
    // * `amount` - Input amount for the swap
    // * `remaining_accounts_start_index` - Starting index for Meteora-specific accounts in remaining_accounts
    // # Returns
    // * `Result<SwapResult>` - Result containing the output amount of the swap
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        // Log swap execution details for debugging
        msg!("Executing Meteora swap2, amount: {}", amount);

        // Check if enough accounts are provided for the swap2 instruction (requires 13 accounts: 10 fixed + 3 bin arrays)
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 13 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Extract accounts from remaining_accounts, cloning to ensure ownership
        let lb_pair = ctx.remaining_accounts[remaining_accounts_start_index].clone(); // Meteora pool account
        let bin_array_bitmap_extension = ctx.remaining_accounts[remaining_accounts_start_index + 1].clone(); // Optional bitmap extension

        let reserve_in = ctx.remaining_accounts[remaining_accounts_start_index + 2].clone(); // Pool's input token reserve
        let reserve_out = ctx.remaining_accounts[remaining_accounts_start_index + 3].clone(); // Pool's output token reserve
        let user = ctx.authority.clone(); // User authority (signer)
        let token_x_program = ctx.remaining_accounts[remaining_accounts_start_index + 4].clone(); // Token program for input token
        let token_y_program = ctx.remaining_accounts[remaining_accounts_start_index + 5].clone(); // Token program for output token
        let oracle = ctx.remaining_accounts[remaining_accounts_start_index + 6].clone(); // Oracle account for price data
        let host_fee_account = ctx.remaining_accounts[remaining_accounts_start_index + 7].clone(); // Host fee account
        let event_authority = ctx.remaining_accounts[remaining_accounts_start_index + 8].clone(); // Event authority PDA
        let program = ctx.remaining_accounts[remaining_accounts_start_index + 9].clone(); // Meteora program account
        let bin_array_0 = ctx.remaining_accounts[remaining_accounts_start_index + 10].clone(); // First bin array
        let bin_array_1 = ctx.remaining_accounts[remaining_accounts_start_index + 11].clone(); // Second bin array
        let bin_array_2 = ctx.remaining_accounts[remaining_accounts_start_index + 12].clone(); // Third bin array

        // Deserialize the output token account to get initial balance

        // Construct the Meteora swap2 instruction data
        let swap_instruction = MeteoraSwapInstruction {
            in_amount: amount, // Input amount
            out_amount_min: 0, // Set to 0 for exact input swap (slippage handled externally)
            host_fee: 0, // Set to 0 for no host fee (configurable based on HOST_FEE_BPS)
            remaining_accounts_info: RemainingAccountsInfo {
                bin_arrays: vec![10, 11, 12], // Indices for bin array accounts
            },
        };

        // Prepare accounts for the CPI to the Meteora program
        let accounts = vec![
            AccountMeta::new(lb_pair.key(), false), // Pool account (mutable)
            AccountMeta::new_readonly(bin_array_bitmap_extension.key(), false), // Optional bitmap extension
            AccountMeta::new(ctx.input_account.key(), false), // input_token_account
            AccountMeta::new(ctx.output_account.key(), false), // output_token_account
            AccountMeta::new(reserve_in.key(), false), // Input reserve (mutable)
            AccountMeta::new(reserve_out.key(), false), // Output reserve (mutable)
            AccountMeta::new_readonly(user.key(), true), // User authority (signer)
            AccountMeta::new_readonly(token_x_program.key(), false), // Input token program
            AccountMeta::new_readonly(token_y_program.key(), false), // Output token program
            AccountMeta::new_readonly(oracle.key(), false), // Oracle (read-only)
            AccountMeta::new(host_fee_account.key(), false), // Host fee account (mutable)
            AccountMeta::new_readonly(event_authority.key(), false), // Event authority PDA
            AccountMeta::new_readonly(program.key(), false), // Meteora program
            AccountMeta::new(bin_array_0.key(), false), // Bin array 0 (mutable)
            AccountMeta::new(bin_array_1.key(), false), // Bin array 1 (mutable)
            AccountMeta::new(bin_array_2.key(), false), // Bin array 2 (mutable)
        ];

        // Serialize instruction data with swap2 discriminator from Meteora IDL
        let instruction_data = swap_instruction.try_to_vec()?;
        let discriminator = [252, 110, 166, 246, 76, 6, 71, 241];
        let mut full_instruction_data = Vec::new();
        full_instruction_data.extend_from_slice(&discriminator);
        full_instruction_data.extend_from_slice(&instruction_data);

        // Create the instruction
        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: full_instruction_data,
        };

        // Execute the CPI to the Meteora program
        invoke_signed(
            &instruction,
            &[
                lb_pair,
                bin_array_bitmap_extension,
                ctx.input_account.clone(), // input_token_account
                ctx.output_account.clone(), // output_token_account
                reserve_in,
                reserve_out,
                user,
                token_x_program,
                token_y_program,
                oracle,
                host_fee_account,
                event_authority,
                program,
                bin_array_0,
                bin_array_1,
                bin_array_2,
            ],
            &[], // No additional signers needed
        )?;

        // Check output token account balance to determine output amount
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let output_amount = output_vault_data.amount;

        // Log the output amount for debugging
        msg!("Swap output amount: {}", output_amount);

        // Return the swap result
        Ok(SwapResult { output_amount })
    }

    // Validates accounts for a Meteora swap2 to ensure they are correct before executing the CPI
    // # Arguments
    // * `ctx` - Context containing accounts
    // * `remaining_accounts_start_index` - Starting index for Meteora-specific accounts
    // # Returns
    // * `Result<()>` - Ok if valid, error otherwise
    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        // Check if enough accounts are provided (requires 13 accounts)
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 13 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Extract Meteora-specific accounts from remaining_accounts
        let lb_pair = &ctx.remaining_accounts[remaining_accounts_start_index]; // Pool account
        let bin_array_bitmap_extension = &ctx.remaining_accounts[remaining_accounts_start_index + 1]; // Optional bitmap extension
        let token_owner_account_in = &ctx.input_account; // Input token account
        let token_owner_account_out = &ctx.output_account; // Output token account
        let reserve_in = &ctx.remaining_accounts[remaining_accounts_start_index + 2]; // Input reserve
        let reserve_out = &ctx.remaining_accounts[remaining_accounts_start_index + 3]; // Output reserve
        let token_x_program = &ctx.remaining_accounts[remaining_accounts_start_index + 4]; // Input token program
        let token_y_program = &ctx.remaining_accounts[remaining_accounts_start_index + 5]; // Output token program
        let oracle = &ctx.remaining_accounts[remaining_accounts_start_index + 6]; // Oracle
        let host_fee_account = &ctx.remaining_accounts[remaining_accounts_start_index + 7]; // Host fee account
        let event_authority = &ctx.remaining_accounts[remaining_accounts_start_index + 8]; // Event authority
        let program = &ctx.remaining_accounts[remaining_accounts_start_index + 9]; // Meteora program
        let bin_array_0 = &ctx.remaining_accounts[remaining_accounts_start_index + 10]; // Bin array 0
        let bin_array_1 = &ctx.remaining_accounts[remaining_accounts_start_index + 11]; // Bin array 1
        let bin_array_2 = &ctx.remaining_accounts[remaining_accounts_start_index + 12]; // Bin array 2

        // Validate that the pool account is a supported Meteora pool
        if !self.pool_addresses.contains(&lb_pair.key()) {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate that the program account matches the Meteora program ID
        if program.key() != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Validate token programs (Token or Token2022)
        let valid_token_programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
        if !valid_token_programs.contains(&token_x_program.key())
            || !valid_token_programs.contains(&token_y_program.key())
        {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Validate that no accounts have a zero Pubkey, ensuring they are properly initialized
        if lb_pair.key() == Pubkey::default()
            || bin_array_bitmap_extension.key() == Pubkey::default()
            || token_owner_account_in.key() == Pubkey::default()
            || token_owner_account_out.key() == Pubkey::default()
            || reserve_in.key() == Pubkey::default()
            || reserve_out.key() == Pubkey::default()
            || token_x_program.key() == Pubkey::default()
            || token_y_program.key() == Pubkey::default()
            || oracle.key() == Pubkey::default()
            || host_fee_account.key() == Pubkey::default()
            || event_authority.key() == Pubkey::default()
            || program.key() == Pubkey::default()
            || bin_array_0.key() == Pubkey::default()
            || bin_array_1.key() == Pubkey::default()
            || bin_array_2.key() == Pubkey::default()
        {
            return Err(ErrorCode::InvalidAccount.into());
        }

        // Optional: Validate pool account ownership (uncomment if needed)
        // if lb_pair.owner != &self.program_id {
        //     return Err(ErrorCode::InvalidPoolAddress.into());
        // }

        Ok(())
    }

    // Validates that the CPI program ID matches the expected Meteora program ID
    // # Arguments
    // * `program_id` - Program ID to validate
    // # Returns
    // * `Result<()>` - Ok if valid, error if mismatched
    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()> {
        if *program_id != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }
        Ok(())
    }
}