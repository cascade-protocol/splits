use anchor_lang::prelude::*;

use crate::{
    errors::ErrorCode,
    events::ProtocolAuthorityTransferred,
    state::ProtocolConfig,
};

#[derive(Accounts)]
pub struct TransferProtocolAuthority<'info> {
    #[account(
        mut,
        seeds = [b"protocol_config"],
        bump = protocol_config.load()?.bump,
        constraint = protocol_config.load()?.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

/// Transfers protocol authority to a new address
/// Only callable by current protocol authority
/// Use for transferring to multisig or new governance
pub fn handler(ctx: Context<TransferProtocolAuthority>, new_authority: Pubkey) -> Result<()> {
    let protocol_config = &mut ctx.accounts.protocol_config.load_mut()?;
    let old_authority = protocol_config.authority;

    protocol_config.authority = new_authority;

    emit!(ProtocolAuthorityTransferred {
        old_authority,
        new_authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
