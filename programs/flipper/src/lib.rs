mod state;
mod errors;
mod adapters;

use anchor_lang::prelude::*;

declare_id!("5958qddzZjU34CHUD4bisVBiYgDQ6EREwBLgpbVaSLX7");

#[program]
pub mod flipper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
