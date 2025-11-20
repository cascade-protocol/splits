use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    errors::ErrorCode,
    events::SplitConfigClosed,
    state::SplitConfig,
};

#[derive(Accounts)]
pub struct CloseSplitConfig<'info> {
    #[account(
        mut,
        seeds = [
            b"split_config",
            split_config.load()?.authority.as_ref(),
            split_config.load()?.mint.as_ref(),
            split_config.load()?.unique_id.as_ref()
        ],
        bump = split_config.load()?.bump,
        constraint = split_config.load()?.authority == authority.key() @ ErrorCode::Unauthorized,
        close = rent_destination
    )]
    pub split_config: AccountLoader<'info, SplitConfig>,

    #[account(
        constraint = vault.key() == split_config.load()?.vault @ ErrorCode::InvalidVault,
        constraint = vault.amount == 0 @ ErrorCode::VaultNotEmpty
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub authority: Signer<'info>,

    /// CHECK: Validated against stored rent_payer in handler
    #[account(mut)]
    pub rent_destination: AccountInfo<'info>,
}

/// Closes split config and recovers rent
/// Requires vault to be empty and all unclaimed cleared
pub fn handler(ctx: Context<CloseSplitConfig>) -> Result<()> {
    let split_config = ctx.accounts.split_config.load()?;

    // Validate rent destination matches stored rent_payer
    require!(
        ctx.accounts.rent_destination.key() == split_config.rent_payer,
        ErrorCode::InvalidRentDestination
    );

    // Check that all unclaimed amounts are zero
    for i in 0..split_config.recipient_count as usize {
        require!(
            split_config.unclaimed_amounts[i].amount == 0,
            ErrorCode::UnclaimedNotEmpty
        );
    }
    require!(
        split_config.protocol_unclaimed == 0,
        ErrorCode::UnclaimedNotEmpty
    );

    let config_key = ctx.accounts.split_config.key();
    let authority_key = ctx.accounts.authority.key();
    let rent_recovered = ctx.accounts.split_config.to_account_info().lamports();

    // Drop the borrow before close
    drop(split_config);

    emit!(SplitConfigClosed {
        config: config_key,
        authority: authority_key,
        rent_recovered,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
