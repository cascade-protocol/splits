use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, TokenAccount, TokenInterface};

use crate::{errors::ErrorCode, events::SplitConfigClosed, state::SplitConfig};

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
        mut,
        constraint = vault.key() == split_config.load()?.vault @ ErrorCode::InvalidVault,
        constraint = vault.amount == 0 @ ErrorCode::VaultNotEmpty
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub authority: Signer<'info>,

    /// CHECK: Validated against stored rent_payer in handler
    #[account(mut)]
    pub rent_destination: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
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
    let config_rent = ctx.accounts.split_config.to_account_info().lamports();
    let vault_rent = ctx.accounts.vault.to_account_info().lamports();

    // Capture PDA data before dropping borrow
    let authority_pubkey = split_config.authority;
    let mint_pubkey = split_config.mint;
    let unique_id = split_config.unique_id;
    let bump = split_config.bump;

    // Drop the borrow before CPI
    drop(split_config);

    // Close vault via CPI to token program
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"split_config",
        authority_pubkey.as_ref(),
        mint_pubkey.as_ref(),
        unique_id.as_ref(),
        &[bump],
    ]];

    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.rent_destination.to_account_info(),
            authority: ctx.accounts.split_config.to_account_info(),
        },
        signer_seeds,
    ))?;

    emit!(SplitConfigClosed {
        config: config_key,
        authority: authority_key,
        rent_recovered: config_rent + vault_rent,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
