use anchor_lang::prelude::*;
use anchor_spl::{
    token,
    token_2022,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{errors::ErrorCode, state::Recipient};

/// Validates recipient ATA and transfers tokens
/// Returns error if ATA is invalid; caller should check data_is_empty() first
pub fn validate_and_send_to_recipient<'info>(
    recipient_ata_info: &'info AccountInfo<'info>,
    recipient: &Recipient,
    amount: u64,
    mint: &InterfaceAccount<'info, Mint>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    split_config_info: &AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Validate account exists and has data
    require!(!recipient_ata_info.data_is_empty(), ErrorCode::RecipientATADoesNotExist);

    // Validate account is owned by token program (SPL Token or Token-2022)
    let valid_owner = recipient_ata_info.owner == &token::ID
        || recipient_ata_info.owner == &token_2022::ID;
    require!(valid_owner, ErrorCode::InvalidTokenProgram);

    // Try to deserialize as token account
    let recipient_ata = InterfaceAccount::<'info, TokenAccount>::try_from(recipient_ata_info)
        .map_err(|_| ErrorCode::RecipientATAInvalid)?;

    // Verify owner and mint match expected values
    require!(recipient_ata.owner == recipient.address, ErrorCode::RecipientATAWrongOwner);
    require!(recipient_ata.mint == mint.key(), ErrorCode::RecipientATAWrongMint);

    // Transfer tokens
    let cpi_accounts = TransferChecked {
        from: vault.to_account_info(),
        mint: mint.to_account_info(),
        to: recipient_ata.to_account_info(),
        authority: split_config_info.clone(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, amount, mint.decimals)?;

    Ok(())
}

/// Validates that a recipient ATA exists and is correctly configured
/// Used during config creation to ensure recipients are ready
pub fn validate_recipient_ata<'info>(
    ata_info: &AccountInfo<'info>,
    recipient_address: &Pubkey,
    mint: &Pubkey,
) -> Result<()> {
    // Must have data
    require!(!ata_info.data_is_empty(), ErrorCode::RecipientATADoesNotExist);

    // Must be owned by token program
    let valid_owner = ata_info.owner == &token::ID || ata_info.owner == &token_2022::ID;
    require!(valid_owner, ErrorCode::InvalidTokenProgram);

    // Try to deserialize
    let token_account = TokenAccount::try_deserialize(&mut &ata_info.data.borrow()[..])
        .map_err(|_| ErrorCode::RecipientATAInvalid)?;

    // Verify owner matches recipient
    require!(token_account.owner == *recipient_address, ErrorCode::RecipientATAWrongOwner);

    // Verify mint matches
    require!(token_account.mint == *mint, ErrorCode::RecipientATAWrongMint);

    Ok(())
}
