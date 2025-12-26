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

/// Meteora swap instruction discriminator
/// This is the first 8 bytes of the sha256 hash of "global:swap"
const SWAP_DISCRIMINATOR: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];

/// Arguments for Meteora swap instruction
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SwapArgs {
    pub amount_in: u64,                           // Amount of input tokens to swap
    pub min_amount_out: u64,                      // Minimum amount of output tokens expected
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
        msg!("Executing Meteora swap, amount: {}", amount);
        msg!("Meteora adapter: start_index={}, count={}, total_remaining={}", 
             remaining_accounts_start_index, remaining_accounts_count, ctx.remaining_accounts.len());

        const MIN_ACCOUNTS: usize = 15; // swap имеет 15 основных аккаунтов (без memo_program)
        // Ensure minimum required accounts are present
        if remaining_accounts_count < MIN_ACCOUNTS {
            msg!("Error: Not enough accounts. Required: {}, Got: {}", MIN_ACCOUNTS, remaining_accounts_count);
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let end_index = remaining_accounts_start_index + remaining_accounts_count;
        if ctx.remaining_accounts.len() < end_index {
            msg!("Error: Remaining accounts array too short. Required end_index: {}, Array length: {}", 
                 end_index, ctx.remaining_accounts.len());
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let adapter_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..end_index];
        msg!("Meteora adapter: adapter_accounts length={}", adapter_accounts.len());

        // Validate pool is enabled
        let pool_info = Account::<PoolInfo>::try_from(&adapter_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        // Calculate number of bin arrays available (maximum 5 for Meteora, optional)
        // adapter_accounts[0] = Pool Info (not used in instruction)
        // adapter_accounts[1-14] = Basic Meteora accounts (14 accounts, but we use ctx.input_account and ctx.output_account)
        // In instruction: 15 basic accounts (lb_pair through program)
        // adapter_accounts[14] = Program (first program_id)
        // adapter_accounts[15-N] = Bin arrays (between two program_id)
        // adapter_accounts[N+1] = Program ID (second program_id) - marks end of bin arrays
        // adapter_accounts[N+2] = Output Vault (not included in adapter_accounts)
        const MAX_BIN_ARRAYS: usize = 5;
        const BIN_ARRAYS_START: usize = 15; // Bin arrays start at index 15 in adapter_accounts (after first program at index 14)
        const PROGRAM_INDEX: usize = 14; // First program_id is at index 14
        
        // Find the second program_id to determine where bin arrays end
        // Bin arrays are between two program_id accounts
        let mut bin_arrays_count = 0;
        if remaining_accounts_count > BIN_ARRAYS_START {
            // Look for second program_id starting from BIN_ARRAYS_START
            for i in BIN_ARRAYS_START..adapter_accounts.len() {
                if adapter_accounts[i].key() == self.program_id {
                    // Found second program_id, bin arrays are between first and second program_id
                    bin_arrays_count = (i - BIN_ARRAYS_START).min(MAX_BIN_ARRAYS) as u8;
                    break;
                }
            }
            // If no second program_id found, assume all accounts after first program are bin arrays
            // (but limit to MAX_BIN_ARRAYS)
            if bin_arrays_count == 0 && remaining_accounts_count > BIN_ARRAYS_START {
                bin_arrays_count = ((remaining_accounts_count - BIN_ARRAYS_START).min(MAX_BIN_ARRAYS)) as u8;
            }
        }
        
        msg!("Meteora adapter: bin_arrays_count={}, BIN_ARRAYS_START={}, adapter_accounts.len()={}", 
             bin_arrays_count, BIN_ARRAYS_START, adapter_accounts.len());

        // Record initial output token balance for calculating swap result
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let initial_output_amount = output_vault_data.amount;

        // Create swap instruction arguments (без remaining_accounts_info для swap)
        let swap_args = SwapArgs {
            amount_in: amount,
            min_amount_out: 0,
        };

        // Prepare instruction data with discriminator and serialized arguments
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&SWAP_DISCRIMINATOR);
        instruction_data.extend_from_slice(&swap_args.try_to_vec()?);

        // Build account metas for the instruction
        // Order must match Meteora swap interface exactly according to IDL:
        // 1. lb_pair (writable)
        // 2. bin_array_bitmap_extension (optional, writable)
        // 3. reserve_x (writable)
        // 4. reserve_y (writable)
        // 5. user_token_in (writable) - from ctx.input_account
        // 6. user_token_out (writable) - from ctx.output_account
        // 7. token_x_mint (readonly)
        // 8. token_y_mint (readonly)
        // 9. oracle (writable)
        // 10. host_fee_in (optional, writable)
        // 11. user (signer, readonly)
        // 12. token_x_program (readonly)
        // 13. token_y_program (readonly)
        // 14. event_authority (readonly, PDA)
        // 15. program (readonly)
        // 16+ bin arrays (if present, as remaining accounts without RemainingAccountsInfo)
        let mut accounts = vec![
            AccountMeta::new(adapter_accounts[1].key(), false),       // lb_pair
            AccountMeta::new(adapter_accounts[2].key(), false),       // bin_array_bitmap_extension
            AccountMeta::new(adapter_accounts[3].key(), false),       // reserve_x
            AccountMeta::new(adapter_accounts[4].key(), false),       // reserve_y
            AccountMeta::new(ctx.input_account.key(), false),          // user_token_in (from ctx)
            AccountMeta::new(ctx.output_account.key(), false),         // user_token_out (from ctx)
            AccountMeta::new_readonly(adapter_accounts[7].key(), false), // token_x_mint
            AccountMeta::new_readonly(adapter_accounts[8].key(), false), // token_y_mint
            AccountMeta::new(adapter_accounts[9].key(), false),       // oracle
            AccountMeta::new(adapter_accounts[10].key(), false),       // host_fee_in
            AccountMeta::new_readonly(ctx.authority.key(), true),      // user (signer)
            AccountMeta::new_readonly(adapter_accounts[11].key(), false), // token_x_program
            AccountMeta::new_readonly(adapter_accounts[12].key(), false), // token_y_program
            AccountMeta::new_readonly(adapter_accounts[13].key(), false), // event_authority (PDA)
            AccountMeta::new_readonly(adapter_accounts[14].key(), false), // program
        ];
        
        // Add bin arrays to account metas (dynamic part, если есть)
        // Bin arrays are between first program_id (index 15) and second program_id
        if bin_arrays_count > 0 {
            let bin_arrays_end = BIN_ARRAYS_START + bin_arrays_count as usize;
            if bin_arrays_end > adapter_accounts.len() {
                msg!("Error: bin_arrays_end ({}) > adapter_accounts.len() ({})", bin_arrays_end, adapter_accounts.len());
                return Err(ErrorCode::NotEnoughAccountKeys.into());
            }
            msg!("Meteora adapter: Adding {} bin arrays to accounts, starting from index {}", bin_arrays_count, accounts.len());
            for i in 0..bin_arrays_count {
                let bin_array_index = BIN_ARRAYS_START + i as usize;
                msg!("Meteora adapter: Adding bin_array[{}] from adapter_accounts[{}]: {}", i, bin_array_index, adapter_accounts[bin_array_index].key());
                accounts.push(AccountMeta::new(adapter_accounts[bin_array_index].key(), false));
            }
        }
        
        msg!("Meteora adapter: Total accounts: {}", accounts.len());

        // Build AccountInfo vector (not references)
        // Order must match accounts vector exactly (15 accounts + bin arrays)
        let mut account_infos = vec![
            adapter_accounts[1].clone(),    // lb_pair
            adapter_accounts[2].clone(),    // bin_array_bitmap_extension
            adapter_accounts[3].clone(),    // reserve_x
            adapter_accounts[4].clone(),    // reserve_y
            ctx.input_account.clone(),      // user_token_in
            ctx.output_account.clone(),     // user_token_out
            adapter_accounts[7].clone(),    // token_x_mint
            adapter_accounts[8].clone(),    // token_y_mint
            adapter_accounts[9].clone(),    // oracle
            adapter_accounts[10].clone(),   // host_fee_in
            ctx.authority.clone(),          // user
            adapter_accounts[11].clone(),   // token_x_program
            adapter_accounts[12].clone(),  // token_y_program
            adapter_accounts[13].clone(),  // event_authority
            adapter_accounts[14].clone(),  // program
        ];
        
        // Add bin arrays to account_infos (dynamic part, если есть)
        // Bin arrays are between first program_id (index 15) and second program_id
        if bin_arrays_count > 0 {
            msg!("Meteora adapter: Adding {} bin arrays to account_infos, starting from index {}", bin_arrays_count, account_infos.len());
            for i in 0..bin_arrays_count {
                let bin_array_index = BIN_ARRAYS_START + i as usize;
                account_infos.push(adapter_accounts[bin_array_index].clone());
            }
        }
        
        msg!("Meteora adapter: Total account_infos: {}", account_infos.len());

        // Create the instruction
        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        };
        
        msg!("Meteora adapter: Created instruction with {} accounts, {} account_infos", instruction.accounts.len(), account_infos.len());

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

        msg!("Meteora swap completed, output amount: {}", output_amount);

        Ok(SwapResult { output_amount })
    }

    /// Validate that all required accounts are provided and valid
    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
        remaining_accounts_count: usize,
    ) -> Result<()> {

        const MIN_ACCOUNTS: usize = 15; // swap имеет 15 основных аккаунтов (без memo_program)

        // Ensure minimum required accounts are present
        if remaining_accounts_count < MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        // Get adapter-specific slice of remaining accounts
        let end_index = remaining_accounts_start_index + remaining_accounts_count;
        if ctx.remaining_accounts.len() < end_index {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let adapter_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..end_index];

        // Validate pool is enabled and matches expected address
        let pool_info = Account::<PoolInfo>::try_from(&adapter_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let lb_pair = &adapter_accounts[1];
        if pool_info.pool_address != lb_pair.key() {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate token programs are correct (SPL Token or Token2022)
        let token_x_program = &adapter_accounts[11];
        let token_y_program = &adapter_accounts[12];
        let program = &adapter_accounts[14]; // program is at index 14

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