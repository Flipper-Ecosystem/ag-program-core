use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{Token, TokenAccount};
use crate::adapters::{AdapterContext, DexAdapter};
use crate::errors::ErrorCode;
use crate::state::{Swap, SwapEvent, SwapResult, PoolInfo};

// Adapter for interacting with the Meteora DLMM protocol
pub struct MeteoraAdapter {
    pub program_id: Pubkey, // Meteora program ID for CPI calls
}

// SPL Token Program ID
const TOKEN_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93,
    0xd9, 0xcb, 0xe1, 0x46, 0x27, 0xc0, 0xf7, 0xf9,
    0xf6, 0x95, 0x01, 0x0a, 0x43, 0x3c, 0x8d, 0x5c,
    0xc1, 0x3f, 0x25, 0x6b, 0xf0, 0x7a, 0x3a, 0x14
]);

// SPL Token2022 Program ID
const TOKEN_2022_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x7a, 0x51, 0x64,
    0x42, 0x4e, 0x62, 0x4c, 0x71, 0x50, 0x35, 0x57,
    0x35, 0x7a, 0x72, 0x33, 0x65, 0x50, 0x41, 0x39,
    0x51, 0x75, 0x62, 0x33, 0x56, 0x34, 0x79, 0x33
]);

// Struct representing the Meteora swap2 instruction data
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct MeteoraSwapInstruction {
    pub in_amount: u64,
    pub out_amount_min: u64,
    pub host_fee: u64,
    pub remaining_accounts_info: RemainingAccountsInfo,
}

// Struct for remaining accounts info
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RemainingAccountsInfo {
    pub bin_arrays: Vec<u8>,
}

impl DexAdapter for MeteoraAdapter {
    fn execute_swap(
        &self,
        ctx: AdapterContext,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult> {
        msg!("Executing Meteora swap2, amount: {}", amount);

        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 13 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let pool_info_account = &ctx.remaining_accounts[remaining_accounts_start_index];
        let pool_info = Account::<PoolInfo>::try_from(pool_info_account)?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let lb_pair = ctx.remaining_accounts[remaining_accounts_start_index].clone();
        let bin_array_bitmap_extension = ctx.remaining_accounts[remaining_accounts_start_index + 1].clone();
        let reserve_in = ctx.remaining_accounts[remaining_accounts_start_index + 2].clone();
        let reserve_out = ctx.remaining_accounts[remaining_accounts_start_index + 3].clone();
        let user = ctx.authority.clone();
        let token_x_program = ctx.remaining_accounts[remaining_accounts_start_index + 4].clone();
        let token_y_program = ctx.remaining_accounts[remaining_accounts_start_index + 5].clone();
        let oracle = ctx.remaining_accounts[remaining_accounts_start_index + 6].clone();
        let host_fee_account = ctx.remaining_accounts[remaining_accounts_start_index + 7].clone();
        let event_authority = ctx.remaining_accounts[remaining_accounts_start_index + 8].clone();
        let program = ctx.remaining_accounts[remaining_accounts_start_index + 9].clone();
        let bin_array_0 = ctx.remaining_accounts[remaining_accounts_start_index + 10].clone();
        let bin_array_1 = ctx.remaining_accounts[remaining_accounts_start_index + 11].clone();
        let bin_array_2 = ctx.remaining_accounts[remaining_accounts_start_index + 12].clone();

        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let initial_output_amount = output_vault_data.amount;

        let swap_instruction = MeteoraSwapInstruction {
            in_amount: amount,
            out_amount_min: 0,
            host_fee: 0,
            remaining_accounts_info: RemainingAccountsInfo {
                bin_arrays: vec![10, 11, 12],
            },
        };

        let instruction = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(lb_pair.key(), false),
                AccountMeta::new_readonly(bin_array_bitmap_extension.key(), false),
                AccountMeta::new(reserve_in.key(), false),
                AccountMeta::new(reserve_out.key(), false),
                AccountMeta::new_readonly(user.key(), true),
                AccountMeta::new_readonly(token_x_program.key(), false),
                AccountMeta::new_readonly(token_y_program.key(), false),
                AccountMeta::new_readonly(oracle.key(), false),
                AccountMeta::new(host_fee_account.key(), false),
                AccountMeta::new_readonly(event_authority.key(), false),
                AccountMeta::new_readonly(program.key(), false),
                AccountMeta::new_readonly(bin_array_0.key(), false),
                AccountMeta::new_readonly(bin_array_1.key(), false),
                AccountMeta::new_readonly(bin_array_2.key(), false),
            ],
            data: swap_instruction.try_to_vec()?,
        };

        invoke_signed(
            &instruction,
            &[
                lb_pair,
                bin_array_bitmap_extension,
                ctx.input_account.clone(),
                ctx.output_account.clone(),
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
            &[],
        )?;

        let output_vault_data = TokenAccount::try_deserialize(&mut ctx.output_account.data.borrow().as_ref())?;
        let output_amount = output_vault_data.amount.checked_sub(initial_output_amount).ok_or(ErrorCode::InvalidCalculation)?;

        msg!("Swap output amount: {}", output_amount);
        
        Ok(SwapResult { output_amount })
    }

    fn validate_accounts(
        &self,
        ctx: AdapterContext,
        remaining_accounts_start_index: usize,
    ) -> Result<()> {
        if ctx.remaining_accounts.len() < remaining_accounts_start_index + 13 {
            return Err(ErrorCode::NotEnoughAccountKeys.into());
        }

        let pool_info_account = &ctx.remaining_accounts[remaining_accounts_start_index];
        let pool_info = Account::<PoolInfo>::try_from(pool_info_account)?;
        if !pool_info.enabled {
            return Err(ErrorCode::PoolDisabled.into());
        }

        let lb_pair = &ctx.remaining_accounts[remaining_accounts_start_index];
        if pool_info.pool_address != lb_pair.key() {
            return Err(ErrorCode::InvalidPoolAddress.into());
        }

        let bin_array_bitmap_extension = &ctx.remaining_accounts[remaining_accounts_start_index + 1];
        let token_owner_account_in = &ctx.input_account;
        let token_owner_account_out = &ctx.output_account;
        let reserve_in = &ctx.remaining_accounts[remaining_accounts_start_index + 2];
        let reserve_out = &ctx.remaining_accounts[remaining_accounts_start_index + 3];
        let token_x_program = &ctx.remaining_accounts[remaining_accounts_start_index + 4];
        let token_y_program = &ctx.remaining_accounts[remaining_accounts_start_index + 5];
        let oracle = &ctx.remaining_accounts[remaining_accounts_start_index + 6];
        let host_fee_account = &ctx.remaining_accounts[remaining_accounts_start_index + 7];
        let event_authority = &ctx.remaining_accounts[remaining_accounts_start_index + 8];
        let program = &ctx.remaining_accounts[remaining_accounts_start_index + 9];
        let bin_array_0 = &ctx.remaining_accounts[remaining_accounts_start_index + 10];
        let bin_array_1 = &ctx.remaining_accounts[remaining_accounts_start_index + 11];
        let bin_array_2 = &ctx.remaining_accounts[remaining_accounts_start_index + 12];

        if program.key() != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

        let valid_token_programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
        if !valid_token_programs.contains(&token_x_program.key())
            || !valid_token_programs.contains(&token_y_program.key())
        {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }

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

        Ok(())
    }

    fn validate_cpi(&self, program_id: &Pubkey) -> Result<()> {
        if *program_id != self.program_id {
            return Err(ErrorCode::InvalidCpiInterface.into());
        }
        Ok(())
    }
}