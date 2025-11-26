use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token,
    token_2022::{self, spl_token_2022::state::AccountState},
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{errors::ErrorCode, state::Recipient};

/// Calculate recipient's share of the total amount
/// Returns None on overflow
#[cfg(test)]
pub fn calculate_recipient_amount(total: u64, percentage_bps: u16) -> Option<u64> {
    (total as u128)
        .checked_mul(percentage_bps as u128)?
        .checked_div(10000)?
        .try_into()
        .ok()
}

/// Sum all recipient basis points
/// Returns None on overflow
#[cfg(test)]
pub fn sum_recipient_bps(recipients: &[Recipient]) -> Option<u32> {
    recipients
        .iter()
        .try_fold(0u32, |acc, r| acc.checked_add(r.percentage_bps as u32))
}

/// Validates recipient ATA and transfers tokens
/// Returns error if ATA is invalid; caller should check data_is_empty() first
#[allow(clippy::too_many_arguments)]
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

    // Derive and validate canonical ATA address
    let expected_ata = get_associated_token_address_with_program_id(
        &recipient.address,
        &mint.key(),
        &token_program.key(),
    );
    require!(
        recipient_ata_info.key() == expected_ata,
        ErrorCode::RecipientATAInvalid
    );

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

/// Check if token account is frozen
pub fn is_account_frozen(account_info: &AccountInfo) -> bool {
    TokenAccount::try_deserialize(&mut &account_info.data.borrow()[..])
        .map(|acc| acc.state == AccountState::Frozen)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculate_amount_normal() {
        // 50% of 1,000,000
        assert_eq!(calculate_recipient_amount(1_000_000, 5000), Some(500_000));
        // 99% of 1,000,000
        assert_eq!(calculate_recipient_amount(1_000_000, 9900), Some(990_000));
        // 1% of 1,000,000
        assert_eq!(calculate_recipient_amount(1_000_000, 100), Some(10_000));
    }

    #[test]
    fn calculate_amount_rounds_down() {
        // 0.01% of 100 = 0.01, rounds to 0
        assert_eq!(calculate_recipient_amount(100, 1), Some(0));
        // 1% of 99 = 0.99, rounds to 0
        assert_eq!(calculate_recipient_amount(99, 100), Some(0));
        // 50% of 1 = 0.5, rounds to 0
        assert_eq!(calculate_recipient_amount(1, 5000), Some(0));
    }

    #[test]
    fn calculate_amount_zero() {
        assert_eq!(calculate_recipient_amount(0, 5000), Some(0));
        assert_eq!(calculate_recipient_amount(1_000_000, 0), Some(0));
        assert_eq!(calculate_recipient_amount(0, 0), Some(0));
    }

    #[test]
    fn calculate_amount_max_values() {
        // Max u64 with 100% - should fit in u64
        assert_eq!(calculate_recipient_amount(u64::MAX, 10000), Some(u64::MAX));
        // Max u64 with 99%
        let expected = (u64::MAX as u128 * 9900 / 10000) as u64;
        assert_eq!(calculate_recipient_amount(u64::MAX, 9900), Some(expected));
    }

    #[test]
    fn sum_bps_normal() {
        let recipients = [
            Recipient { address: Pubkey::default(), percentage_bps: 5000 },
            Recipient { address: Pubkey::default(), percentage_bps: 4900 },
        ];
        assert_eq!(sum_recipient_bps(&recipients), Some(9900));
    }

    #[test]
    fn sum_bps_single() {
        let recipients = [
            Recipient { address: Pubkey::default(), percentage_bps: 9900 },
        ];
        assert_eq!(sum_recipient_bps(&recipients), Some(9900));
    }

    #[test]
    fn sum_bps_empty() {
        let recipients: [Recipient; 0] = [];
        assert_eq!(sum_recipient_bps(&recipients), Some(0));
    }

    #[test]
    fn sum_bps_max_recipients() {
        // 20 recipients at 495 bps each = 9900
        let recipients: Vec<Recipient> = (0..20)
            .map(|_| Recipient { address: Pubkey::default(), percentage_bps: 495 })
            .collect();
        assert_eq!(sum_recipient_bps(&recipients), Some(9900));
    }

    #[test]
    fn sum_bps_no_overflow() {
        // u16 max (65535) * 20 = 1,310,700 < u32::MAX
        let recipients: Vec<Recipient> = (0..20)
            .map(|_| Recipient { address: Pubkey::default(), percentage_bps: u16::MAX })
            .collect();
        assert_eq!(sum_recipient_bps(&recipients), Some(20 * u16::MAX as u32));
    }
}
