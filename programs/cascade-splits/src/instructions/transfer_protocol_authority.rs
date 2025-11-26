use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, events::ProtocolAuthorityTransferProposed, state::ProtocolConfig};

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

/// Proposes protocol authority transfer to a new address (two-step pattern)
/// Only callable by current protocol authority
/// New authority must call accept_protocol_authority to complete transfer
/// Can be overwritten by calling again with different address
/// Set to Pubkey::default() to cancel pending transfer
pub fn handler(ctx: Context<TransferProtocolAuthority>, new_authority: Pubkey) -> Result<()> {
    let protocol_config = &mut ctx.accounts.protocol_config.load_mut()?;

    protocol_config.pending_authority = new_authority;

    emit!(ProtocolAuthorityTransferProposed {
        authority: ctx.accounts.authority.key(),
        pending_authority: new_authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
