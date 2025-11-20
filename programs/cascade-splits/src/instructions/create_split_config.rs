use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::{MAX_RECIPIENTS, MIN_RECIPIENTS, REQUIRED_SPLIT_TOTAL, SPLIT_CONFIG_SIZE},
    errors::ErrorCode,
    events::SplitConfigCreated,
    state::{Recipient, SplitConfig, UnclaimedAmount},
    utils::validate_recipient_ata,
};

#[derive(Accounts)]
#[instruction(mint: Pubkey, recipients: Vec<RecipientInput>)]
pub struct CreateSplitConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = SPLIT_CONFIG_SIZE,
        seeds = [
            b"split_config",
            authority.key().as_ref(),
            mint.as_ref(),
            unique_id.key().as_ref()
        ],
        bump
    )]
    pub split_config: AccountLoader<'info, SplitConfig>,

    /// CHECK: Used only as PDA seed for uniqueness
    pub unique_id: AccountInfo<'info>,

    /// Authority that will control this split config
    pub authority: Signer<'info>,

    /// Account paying rent for split_config and vault (can be same as authority or different)
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        constraint = mint_account.key() == mint @ ErrorCode::RecipientATAWrongMint
    )]
    pub mint_account: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint_account,
        associated_token::authority = split_config,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Input struct for recipients (used in instruction parameters)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RecipientInput {
    pub address: Pubkey,
    pub percentage_bps: u16,
}

/// Creates a new split configuration with vault
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, CreateSplitConfig<'info>>,
    mint: Pubkey,
    recipients: Vec<RecipientInput>,
) -> Result<()> {
    let recipient_count = recipients.len();

    // Validate recipient count
    require!(
        (MIN_RECIPIENTS..=MAX_RECIPIENTS).contains(&recipient_count),
        ErrorCode::InvalidRecipientCount
    );

    // Validate percentages sum to 9900 bps (99%)
    let total_bps: u32 = recipients
        .iter()
        .try_fold(0u32, |acc, r| acc.checked_add(r.percentage_bps as u32))
        .ok_or(ErrorCode::MathOverflow)?;

    require!(total_bps == REQUIRED_SPLIT_TOTAL as u32, ErrorCode::InvalidSplitTotal);

    // Validate each recipient and check for duplicates
    for (i, recipient) in recipients.iter().enumerate() {
        // No zero addresses
        require!(recipient.address != Pubkey::default(), ErrorCode::ZeroAddress);

        // No zero percentages
        require!(recipient.percentage_bps > 0, ErrorCode::ZeroPercentage);

        // No duplicates
        for other in recipients.iter().skip(i + 1) {
            require!(
                recipient.address != other.address,
                ErrorCode::DuplicateRecipient
            );
        }
    }

    // Validate recipient ATAs exist (remaining_accounts should contain ATAs in order)
    require!(
        ctx.remaining_accounts.len() >= recipient_count,
        ErrorCode::InsufficientRemainingAccounts
    );

    for (i, recipient) in recipients.iter().enumerate() {
        let ata_info = &ctx.remaining_accounts[i];
        validate_recipient_ata(ata_info, &recipient.address, &mint)?;
    }

    // Initialize split config
    let split_config = &mut ctx.accounts.split_config.load_init()?;

    split_config.version = 1;
    split_config.authority = ctx.accounts.authority.key();
    split_config.mint = mint;
    split_config.vault = ctx.accounts.vault.key();
    split_config.unique_id = ctx.accounts.unique_id.key();
    split_config.bump = ctx.bumps.split_config;
    split_config.recipient_count = recipient_count as u8;
    split_config.protocol_unclaimed = 0;
    split_config.last_activity = 0;
    split_config.rent_payer = ctx.accounts.payer.key();

    // Copy recipients to fixed array
    for (i, recipient) in recipients.iter().enumerate() {
        split_config.recipients[i] = Recipient {
            address: recipient.address,
            percentage_bps: recipient.percentage_bps,
        };
    }

    // Initialize remaining recipient slots to default
    for i in recipient_count..MAX_RECIPIENTS {
        split_config.recipients[i] = Recipient::default();
    }

    // Initialize unclaimed amounts to default
    for i in 0..MAX_RECIPIENTS {
        split_config.unclaimed_amounts[i] = UnclaimedAmount::default();
    }

    emit!(SplitConfigCreated {
        config: ctx.accounts.split_config.key(),
        authority: ctx.accounts.authority.key(),
        mint,
        vault: ctx.accounts.vault.key(),
        unique_id: ctx.accounts.unique_id.key(),
        recipient_count: recipient_count as u8,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
