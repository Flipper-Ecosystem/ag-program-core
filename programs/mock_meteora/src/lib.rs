use anchor_lang::prelude::*;

declare_id!("699YWVLRa4T5Mxs3iNJGnpwP24JNckt25vW1pEMc5xrA");

#[program]
pub mod mock_meteora {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
