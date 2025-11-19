use anchor_lang::prelude::*;

use crate::{
    errors::ErrorCode,
    events::ProtocolConfigUpdated,
    state::ProtocolConfig,
};

#[derive(Accounts)]
pub struct UpdateProtocolConfig<'info> {
    #[account(
        mut,
        seeds = [b"protocol_config"],
        bump = protocol_config.load()?.bump,
        constraint = protocol_config.load()?.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

/// Updates the protocol fee wallet
/// Only callable by current protocol authority
pub fn handler(ctx: Context<UpdateProtocolConfig>, new_fee_wallet: Pubkey) -> Result<()> {
    // Validate fee wallet is not zero address
    require!(new_fee_wallet != Pubkey::default(), ErrorCode::ZeroAddress);

    let protocol_config = &mut ctx.accounts.protocol_config.load_mut()?;
    let old_fee_wallet = protocol_config.fee_wallet;

    protocol_config.fee_wallet = new_fee_wallet;

    emit!(ProtocolConfigUpdated {
        authority: ctx.accounts.authority.key(),
        old_fee_wallet,
        new_fee_wallet,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
