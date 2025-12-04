use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{Token, TokenAccount};
use crate::adapters::adapter_connector_module::{AdapterContext};
use crate::adapters::dex_adapter::DexAdapter;
use crate::errors::ErrorCode;
use crate::state::{Swap, SwapEvent, SwapResult, PoolInfo};

pub struct WhirlpoolAdapter {
    pub program_id: Pubkey,
    pub a_to_b: bool
}

const TOKEN_PROGRAM_ID: Pubkey = anchor_spl::token::ID;
const TOKEN_2022_PROGRAM_ID: Pubkey = anchor_spl::token_2022::ID;

const SWAP_V2_DISCRIMINATOR: [u8; 8] = [43, 4, 237, 11, 26, 201, 30, 98];

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SwapV2Args {
    pub amount: u64,
    pub other_amount_threshold: u64,
    pub sqrt_price_limit: u128,
    pub amount_specified_is_input: bool,
    pub a_to_b: bool,
    pub remaining_accounts_info: Option<RemainingAccountsInfo>,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RemainingAccountsSlice {
    pub accounts_type: AccountsType,
    pub length: u8,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub enum AccountsType {
    TransferHookA,
    TransferHookB,
    TransferHookReward,
    TransferHookInput,
    TransferHookIntermediate,
    TransferHookOutput,
    SupplementalTickArrays,
    SupplementalTickArraysOne,
    SupplementalTickArraysTwo,
}

impl DexAdapter for WhirlpoolAdapter {
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
        remaining_accounts_count: usize,
    ) -> Result<SwapResult> {
        msg!("Executing Whirlpool swapV2, amount: {}", amount);

        const MIN_ACCOUNTS: usize = 15;

        if remaining_accounts_count < MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let end_index = remaining_accounts_start_index + remaining_accounts_count;
        if ctx.remaining_accounts.len() < end_index {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let adapter_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..end_index];

        // Validate pool_info (index 0) - check that pool is enabled
        let pool_info = Account::<PoolInfo>::try_from(&adapter_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        // Record initial output token balance
        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let initial_output_amount = output_vault_data.amount;

        // Calculate supplemental tick arrays (up to 3: -200, 200, 300)
        // MIN_ACCOUNTS (15) covers accounts 0-14, supplemental tick arrays start at index 15
        // The last account in remaining_accounts is program id, which should not be counted as tick array
        // Use saturating_sub to prevent underflow when remaining_accounts_count == MIN_ACCOUNTS
        let supplemental_tick_arrays_count = remaining_accounts_count
            .saturating_sub(MIN_ACCOUNTS)
            .saturating_sub(1) // Exclude last account (program id)
            .min(3) as u8;
        

        // Create swap args
        let swap_args = SwapV2Args {
            amount,
            other_amount_threshold: 0,
            sqrt_price_limit: 0,
            amount_specified_is_input: true,
            a_to_b: self.a_to_b,
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

        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&SWAP_V2_DISCRIMINATOR);
        instruction_data.extend_from_slice(&swap_args.try_to_vec()?);

        // Build account metas in SwapV2 order
        let mut accounts = vec![
            AccountMeta::new_readonly(adapter_accounts[1].key(), false),    // token_program_a
            AccountMeta::new_readonly(adapter_accounts[2].key(), false),    // token_program_b
            AccountMeta::new_readonly(adapter_accounts[3].key(), false),    // memo_program
            AccountMeta::new_readonly(ctx.authority.key(), true),           // token_authority
            AccountMeta::new(adapter_accounts[4].key(), false),             // whirlpool
            AccountMeta::new_readonly(adapter_accounts[5].key(), false),    // token_mint_a
            AccountMeta::new_readonly(adapter_accounts[6].key(), false),    // token_mint_b
            AccountMeta::new(ctx.input_account.key(), false),               // token_owner_account_a
            AccountMeta::new(adapter_accounts[8].key(), false),             // token_vault_a
            AccountMeta::new(ctx.output_account.key(), false),              // token_owner_account_b
            AccountMeta::new(adapter_accounts[10].key(), false),             // token_vault_b
            AccountMeta::new(adapter_accounts[11].key(), false),             // tick_array_0
            AccountMeta::new(adapter_accounts[12].key(), false),             // tick_array_1
            AccountMeta::new(adapter_accounts[13].key(), false),            // tick_array_2
            AccountMeta::new_readonly(adapter_accounts[14].key(), false),   // oracle
        ];


        // Add supplemental tick arrays
        for i in 0..supplemental_tick_arrays_count {
            accounts.push(AccountMeta::new(adapter_accounts[15 + i as usize].key(), false));
        }

        // Build AccountInfo vector
        let mut account_infos = vec![
            adapter_accounts[1].clone(),     // token_program_a
            adapter_accounts[2].clone(),     // token_program_b
            adapter_accounts[3].clone(),     // memo_program
            ctx.authority.clone(),           // token_authority
            adapter_accounts[4].clone(),     // whirlpool
            adapter_accounts[5].clone(),     // token_mint_a
            adapter_accounts[6].clone(),     // token_mint_b
            ctx.input_account.clone(),       // token_owner_account_a
            adapter_accounts[8].clone(),     // token_vault_a
            ctx.output_account.clone(),      // token_owner_account_b
            adapter_accounts[10].clone(),     // token_vault_b
            adapter_accounts[11].clone(),     // tick_array_0
            adapter_accounts[12].clone(),     // tick_array_1
            adapter_accounts[13].clone(),    // tick_array_2
            adapter_accounts[14].clone(),    // oracle
        ];

        for i in 0..supplemental_tick_arrays_count {
            account_infos.push(adapter_accounts[15 + i as usize].clone());
        }


        let instruction = Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        };

        // Find vault authority bump
        let vault_authority_bump = Pubkey::find_program_address(
            &[b"vault_authority"],
            &ctx.program_id,
        ).1;


        // Prepare signer seeds for CPI call
        let authority_seeds: &[&[u8]] = &[b"vault_authority", &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[authority_seeds];

        invoke_signed(&instruction, &account_infos, signer_seeds)?;

        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let output_amount = output_vault_data.amount
            .checked_sub(initial_output_amount)
            .ok_or(ErrorCode::InvalidCalculation)?;

        msg!("Whirlpool swapV2 completed, output amount: {}", output_amount);

        Ok(SwapResult { output_amount })
    }

    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
        remaining_accounts_count: usize,
    ) -> Result<()> {
        const MIN_ACCOUNTS: usize = 15;

        if remaining_accounts_count < MIN_ACCOUNTS {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let end_index = remaining_accounts_start_index + remaining_accounts_count;
        if ctx.remaining_accounts.len() < end_index {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let adapter_accounts = &ctx.remaining_accounts[remaining_accounts_start_index..end_index];

        // Validate pool_info (index 0)
        let pool_info = Account::<PoolInfo>::try_from(&adapter_accounts[0])?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let whirlpool = &adapter_accounts[4];
        if pool_info.pool_address != whirlpool.key() {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        // Validate token programs
        let token_program_a = &adapter_accounts[1];
        let token_program_b = &adapter_accounts[2];

        let valid_token_programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
        if !valid_token_programs.contains(&token_program_a.key())
            || !valid_token_programs.contains(&token_program_b.key())
        {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        // Validate whirlpool ownership
        if whirlpool.owner != &self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }


        // Validate tick arrays (indices 11, 12, 13 match execute_swap)
        for i in 11..=13 {
            if adapter_accounts[i].key() == Pubkey::default() {
                return Err(ErrorCode::InvalidAccount.into());
            }
        }

        Ok(())
    }

    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()> {
        if *program_id != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }
        Ok(())
    }
}