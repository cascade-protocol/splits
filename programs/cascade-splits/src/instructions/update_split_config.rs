use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::{MAX_RECIPIENTS, MIN_RECIPIENTS, REQUIRED_SPLIT_TOTAL},
    errors::ErrorCode,
    events::SplitConfigUpdated,
    state::{Recipient, SplitConfig, UnclaimedAmount},
    utils::validate_recipient_ata,
};

use super::create_split_config::RecipientInput;

#[derive(Accounts)]
pub struct UpdateSplitConfig<'info> {
    #[account(
        mut,
        seeds = [
            b"split_config",
            split_config.load()?.authority.as_ref(),
            split_config.load()?.mint.as_ref(),
            split_config.load()?.unique_id.as_ref()
        ],
        bump = split_config.load()?.bump,
        constraint = split_config.load()?.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub split_config: AccountLoader<'info, SplitConfig>,

    #[account(
        constraint = vault.key() == split_config.load()?.vault @ ErrorCode::InvalidVault,
        constraint = vault.amount == 0 @ ErrorCode::VaultNotEmpty
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = mint.key() == split_config.load()?.mint @ ErrorCode::RecipientATAWrongMint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Updates split configuration with new recipients
/// Requires vault to be empty
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateSplitConfig<'info>>,
    new_recipients: Vec<RecipientInput>,
) -> Result<()> {
    let split_config = &mut ctx.accounts.split_config.load_mut()?;

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

    let old_recipient_count = split_config.recipient_count;
    let new_recipient_count = new_recipients.len();

    // Validate recipient count
    require!(
        (MIN_RECIPIENTS..=MAX_RECIPIENTS).contains(&new_recipient_count),
        ErrorCode::InvalidRecipientCount
    );

    // Validate percentages sum to 9900 bps (99%)
    let total_bps: u32 = new_recipients
        .iter()
        .try_fold(0u32, |acc, r| acc.checked_add(r.percentage_bps as u32))
        .ok_or(ErrorCode::MathOverflow)?;

    require!(
        total_bps == REQUIRED_SPLIT_TOTAL as u32,
        ErrorCode::InvalidSplitTotal
    );

    // Validate each recipient and check for duplicates
    for (i, recipient) in new_recipients.iter().enumerate() {
        // No zero addresses
        require!(
            recipient.address != Pubkey::default(),
            ErrorCode::ZeroAddress
        );

        // No zero percentages
        require!(recipient.percentage_bps > 0, ErrorCode::ZeroPercentage);

        // No duplicates
        for other in new_recipients.iter().skip(i + 1) {
            require!(
                recipient.address != other.address,
                ErrorCode::DuplicateRecipient
            );
        }
    }

    // Validate recipient ATAs exist
    require!(
        ctx.remaining_accounts.len() >= new_recipient_count,
        ErrorCode::InsufficientRemainingAccounts
    );

    let mint_key = ctx.accounts.mint.key();
    for (i, recipient) in new_recipients.iter().enumerate() {
        let ata_info = &ctx.remaining_accounts[i];
        validate_recipient_ata(ata_info, &recipient.address, &mint_key)?;
    }

    // Update recipients
    split_config.recipient_count = new_recipient_count as u8;

    for (i, recipient) in new_recipients.iter().enumerate() {
        split_config.recipients[i] = Recipient {
            address: recipient.address,
            percentage_bps: recipient.percentage_bps,
        };
    }

    // Clear remaining slots
    for i in new_recipient_count..MAX_RECIPIENTS {
        split_config.recipients[i] = Recipient::default();
    }

    // Reset unclaimed amounts
    for i in 0..MAX_RECIPIENTS {
        split_config.unclaimed_amounts[i] = UnclaimedAmount::default();
    }

    emit!(SplitConfigUpdated {
        config: ctx.accounts.split_config.key(),
        authority: ctx.accounts.authority.key(),
        old_recipient_count,
        new_recipient_count: new_recipient_count as u8,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
