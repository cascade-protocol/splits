use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, events::ProtocolAuthorityTransferAccepted, state::ProtocolConfig};

#[derive(Accounts)]
pub struct AcceptProtocolAuthority<'info> {
    #[account(
        mut,
        seeds = [b"protocol_config"],
        bump = protocol_config.load()?.bump,
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,

    pub new_authority: Signer<'info>,
}

/// Accepts a pending protocol authority transfer (two-step pattern)
/// Only callable by the pending authority
/// Completes the transfer and clears pending_authority
pub fn handler(ctx: Context<AcceptProtocolAuthority>) -> Result<()> {
    let protocol_config = &mut ctx.accounts.protocol_config.load_mut()?;

    // Verify there is a pending transfer
    require!(
        protocol_config.pending_authority != Pubkey::default(),
        ErrorCode::NoPendingTransfer
    );

    // Verify signer is the pending authority
    require!(
        protocol_config.pending_authority == ctx.accounts.new_authority.key(),
        ErrorCode::Unauthorized
    );

    let old_authority = protocol_config.authority;
    let new_authority = ctx.accounts.new_authority.key();

    // Complete the transfer
    protocol_config.authority = new_authority;
    protocol_config.pending_authority = Pubkey::default();

    emit!(ProtocolAuthorityTransferAccepted {
        old_authority,
        new_authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
