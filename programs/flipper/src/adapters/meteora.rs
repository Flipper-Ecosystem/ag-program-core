use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::TokenAccount;
use crate::adapters::dex_adapter::DexAdapter;
use crate::adapters::adapter_connector_module::{AdapterContext};
use crate::errors::ErrorCode;
use crate::state::{Swap, SwapEvent, SwapResult, PoolInfo};

/// Adapter for interacting with the Meteora DLMM protocol
pub struct MeteoraAdapter {
    pub program_id: Pubkey, // Meteora program ID for CPI calls
}

// Program IDs from anchor-spl
const TOKEN_PROGRAM_ID: Pubkey = anchor_spl::token::ID;
const TOKEN_2022_PROGRAM_ID: Pubkey = anchor_spl::token_2022::ID;

/// Meteora swap2 instruction discriminator
/// This is the first 8 bytes of the sha256 hash of "global:swap2"
const SWAP2_DISCRIMINATOR: [u8; 8] = [65, 75, 63, 76, 235, 91, 91, 136];

/// Arguments for Meteora swap2 instruction
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct Swap2Args {
    pub amount_in: u64,                           // Amount of input tokens to swap
    pub min_amount_out: u64,                      // Minimum amount of output tokens expected
    pub remaining_accounts_info: RemainingAccountsInfo, // Info about remaining accounts (bin arrays)
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
    BinArrays,                                    // Bin array accounts for liquidity distribution
}

impl DexAdapter for MeteoraAdapter {
    /// Execute a swap through Meteora DLMM protocol
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
        remaining_accounts_count: usize,
    ) -> Result<SwapResult> {
        msg!("Executing Meteora swap2, amount: {}", amount);

        const MIN_ACCOUNTS: usize = 16;
        // Ensure minimum required accounts are present
        if remaining_accounts_count < MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get adapter-specific slice of remaining accounts
        let end_index = remaining_accounts_start_index + remaining_accounts_count;
        if ctx.remaining_accounts.len() < end_index {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let remaining_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..end_index];

        // Validate pool is enabled
        let pool_info = Account::<PoolInfo>::try_from(&remaining_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        // Calculate number of bin arrays available (maximum 5 for Meteora, optional)
        // MIN_ACCOUNTS (16) covers accounts 0-15, bin arrays start at index 16
        // Program ID acts as a separator that marks the end of bin arrays
        // Bin arrays are optional (can be 0), but maximum 5 according to Meteora spec
        let mut bin_arrays_count = 0u8;
        const MAX_BIN_ARRAYS: usize = 5;
        const BIN_ARRAYS_START: usize = 16;
        
        // Search for Program ID separator starting from bin arrays start index
        // If separator is found immediately at index 16, bin_arrays_count remains 0 (optional)
        for i in BIN_ARRAYS_START..remaining_accounts.len() {
            if remaining_accounts[i].key() == self.program_id {
                // Found separator, bin arrays end before this index
                // Calculate count: if separator at index 16, count = 0 (no bin arrays)
                // If separator at index 17, count = 1, etc.
                bin_arrays_count = (i - BIN_ARRAYS_START).min(MAX_BIN_ARRAYS) as u8;
                break;
            }
        }
        
        // If separator not found, this indicates malformed account structure
        // In this case, we cannot safely determine bin arrays count
        // This should not happen in normal operation, but we handle it gracefully
        // by assuming no bin arrays (0) to avoid using wrong accounts
        // Note: In practice, separator should always be present

        // Record initial output token balance for calculating swap result
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let initial_output_amount = output_vault_data.amount;

        // Create swap2 instruction arguments
        let swap_args = Swap2Args {
            amount_in: amount,
            min_amount_out: 0, // No slippage protection in this example
            remaining_accounts_info: RemainingAccountsInfo {
                slices: vec![RemainingAccountsSlice {
                    accounts_type: AccountsType::BinArrays,
                    length: bin_arrays_count,
                }],
            },
        };

        // Prepare instruction data with discriminator and serialized arguments
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&SWAP2_DISCRIMINATOR);
        instruction_data.extend_from_slice(&swap_args.try_to_vec()?);

        // Build account metas for the instruction
        // Order must match Meteora swap2 interface exactly
        let mut accounts = vec![
            AccountMeta::new(remaining_accounts[1].key(), false),       // lb_pair
            AccountMeta::new(remaining_accounts[2].key(), false), // bin_array_bitmap_extension
            AccountMeta::new(remaining_accounts[3].key(), false),       // reserve_x
            AccountMeta::new(remaining_accounts[4].key(), false),       // reserve_y
            AccountMeta::new(ctx.input_account.key(), false),           // user_token_in
            AccountMeta::new(ctx.output_account.key(), false),          // user_token_out
            AccountMeta::new_readonly(remaining_accounts[7].key(), false), // token_x_mint
            AccountMeta::new_readonly(remaining_accounts[8].key(), false), // token_y_mint
            AccountMeta::new(remaining_accounts[9].key(), false),       // oracle
            AccountMeta::new(remaining_accounts[10].key(), false),       // host_fee_account
            AccountMeta::new_readonly(ctx.authority.key(), true),       // user (signer)
            AccountMeta::new_readonly(remaining_accounts[11].key(), false), // token_x_program
            AccountMeta::new_readonly(remaining_accounts[12].key(), false), // token_y_program
            AccountMeta::new_readonly(remaining_accounts[13].key(), false), // memo_program
            AccountMeta::new_readonly(remaining_accounts[14].key(), false), // event_authority
            AccountMeta::new_readonly(remaining_accounts[15].key(), false), // program
        ];

        // Add bin arrays to account metas (dynamic part)
        for i in 0..bin_arrays_count {
            accounts.push(AccountMeta::new(remaining_accounts[16 + i as usize].key(), false));
        }

        // Build AccountInfo vector (not references)
        let mut account_infos = vec![
            remaining_accounts[1].clone(),   // lb_pair
            remaining_accounts[2].clone(),   // bin_array_bitmap_extension
            remaining_accounts[3].clone(),   // reserve_x
            remaining_accounts[4].clone(),   // reserve_y
            ctx.input_account.clone(),       // user_token_in
            ctx.output_account.clone(),      // user_token_out
            remaining_accounts[7].clone(),   // token_x_mint
            remaining_accounts[8].clone(),   // token_y_mint
            remaining_accounts[9].clone(),   // oracle
            remaining_accounts[10].clone(),   // host_fee_account
            ctx.authority.clone(),           // user
            remaining_accounts[11].clone(),   // token_x_program
            remaining_accounts[12].clone(),  // token_y_program
            remaining_accounts[13].clone(),  // memo_program
            remaining_accounts[14].clone(),  // event_authority
            remaining_accounts[15].clone(),  // program
        ];

        // Add dynamic bin arrays
        for i in 0..bin_arrays_count {
            account_infos.push(remaining_accounts[16 + i as usize].clone());
        }

        // Create the instruction
        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        };

        // Execute CPI call with proper signer seeds
        // Find PDA for vault authority with proper seed derivation
        let (vault_authority_pda, vault_authority_bump) = Pubkey::find_program_address(
            &[b"vault_authority"],
            &ctx.program_id,
        );

        // Verify that ctx.authority matches our calculated PDA
        if ctx.authority.key() != vault_authority_pda {
            return Err(ErrorCode::InvalidAccount.into());
        }

        let vault_authority_bump = Pubkey::find_program_address(
            &[b"vault_authority"],
            &ctx.program_id,
        ).1;

        // Prepare signer seeds for CPI call
        let authority_seeds: &[&[u8]] = &[b"vault_authority", &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

        invoke_signed(&instruction, &account_infos, signer_seeds)?;

        // Calculate output amount by checking balance difference
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let output_amount = output_vault_data.amount
            .checked_sub(initial_output_amount)
            .ok_or(ErrorCode::InvalidCalculation)?;

        msg!("Meteora swap2 completed, output amount: {}", output_amount);

        Ok(SwapResult { output_amount })
    }

    /// Validate that all required accounts are provided and valid
    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
        remaining_accounts_count: usize,
    ) -> Result<()> {

        const MIN_ACCOUNTS: usize = 16;

        // Ensure minimum required accounts are present
        if remaining_accounts_count < MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get adapter-specific slice of remaining accounts
        let end_index = remaining_accounts_start_index + remaining_accounts_count;
        if ctx.remaining_accounts.len() < end_index {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let remaining_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..end_index];

        // Validate pool is enabled and matches expected address
        let pool_info = Account::<PoolInfo>::try_from(&remaining_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let lb_pair = &remaining_accounts[1];
        if pool_info.pool_address != lb_pair.key() {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate token programs are correct (SPL Token or Token2022)
        let token_x_program = &remaining_accounts[11];
        let token_y_program = &remaining_accounts[12];
        let program = &remaining_accounts[15];

        if program.key() != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        let valid_token_programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
        if !valid_token_programs.contains(&token_x_program.key())
            || !valid_token_programs.contains(&token_y_program.key())
        {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Ensure critical accounts are not default (empty) pubkeys
        if lb_pair.key() == Pubkey::default() {
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