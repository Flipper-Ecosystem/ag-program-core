use anchor_lang::prelude::*;

declare_id!("Fa6sgRmBda2UJpBT1tV3bq27JkLjuRYvnt6TxWqAJT5F");

#[program]
pub mod mock_whirlpools {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
