use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token, token_2022,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    errors::ErrorCode,
    events::SplitExecuted,
    state::{ProtocolConfig, SplitConfig},
    utils::{is_account_frozen, validate_and_send_to_recipient},
};

#[derive(Accounts)]
pub struct ExecuteSplit<'info> {
    #[account(
        mut,
        seeds = [
            b"split_config",
            split_config.load()?.authority.as_ref(),
            split_config.load()?.mint.as_ref(),
            split_config.load()?.unique_id.as_ref()
        ],
        bump = split_config.load()?.bump
    )]
    pub split_config: AccountLoader<'info, SplitConfig>,

    #[account(
        mut,
        constraint = vault.key() == split_config.load()?.vault @ ErrorCode::InvalidVault
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = mint.key() == split_config.load()?.mint @ ErrorCode::RecipientATAWrongMint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.load()?.bump
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,

    /// CHECK: Intentionally not a Signer - permissionless execution allows anyone to trigger
    /// distribution (e.g., recipients, bots, facilitators). The executor field is used only
    /// for event attribution and has no security implications.
    pub executor: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Executes a payment split with self-healing unclaimed recovery
/// Permissionless - anyone can call
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, ExecuteSplit<'info>>) -> Result<()> {
    let vault_balance = ctx.accounts.vault.amount;
    let protocol_fee_wallet = ctx.accounts.protocol_config.load()?.fee_wallet;

    // Phase 1: Read all needed data and DROP borrow before CPIs
    let (
        recipient_count,
        authority,
        mint_key,
        unique_id,
        bump,
        recipients,
        mut unclaimed_amounts,
        mut protocol_unclaimed,
    ) = {
        let config = ctx.accounts.split_config.load()?;
        let count = config.recipient_count as usize;

        // Bounds check (recipients + protocol_ata)
        require!(
            ctx.remaining_accounts.len() > count,
            ErrorCode::InsufficientRemainingAccounts
        );

        (
            count,
            config.authority,
            config.mint,
            config.unique_id,
            config.bump,
            config.recipients[..count].to_vec(),
            config.unclaimed_amounts[..count].to_vec(),
            config.protocol_unclaimed,
        )
    }; // ← Borrow DROPPED here

    // Calculate available funds (protect all unclaimed)
    let total_unclaimed: u64 = unclaimed_amounts
        .iter()
        .filter(|u| u.amount > 0)
        .try_fold(0u64, |acc, u| acc.checked_add(u.amount))
        .ok_or(ErrorCode::MathOverflow)?;

    let available_to_split = vault_balance
        .checked_sub(total_unclaimed)
        .ok_or(ErrorCode::MathUnderflow)?
        .checked_sub(protocol_unclaimed)
        .ok_or(ErrorCode::MathUnderflow)?;

    // Setup PDA signer
    let seeds = &[
        b"split_config".as_ref(),
        authority.as_ref(),
        mint_key.as_ref(),
        unique_id.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Phase 2: All CPIs - no borrow held
    let mut distributed = 0u64;
    let mut held_as_unclaimed = 0u64;

    if available_to_split > 0 {
        for i in 0..recipient_count {
            let recipient = &recipients[i];
            // Floor division intentionally rounds down - rounding dust goes to protocol fee.
            // For very small amounts, recipients may receive 0 tokens (skipped below).
            // This is acceptable: dust accumulates to protocol rather than being lost,
            // and no minimum balance check is enforced to allow idempotent no-op calls.
            let amount: u64 = (available_to_split as u128)
                .checked_mul(recipient.percentage_bps as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(10000u128)
                .ok_or(ErrorCode::MathOverflow)?
                .try_into()
                .map_err(|_| ErrorCode::MathOverflow)?;

            if amount == 0 {
                continue; // Skip zero-amount transfers (from rounding or tiny vault balance)
            }

            let ata = &ctx.remaining_accounts[i];

            // Pre-validate: check if ATA exists or is frozen (~100 CU vs ~1000 CU for failed CPI)
            if ata.data_is_empty() || is_account_frozen(ata) {
                // Hold as unclaimed (update local copy)
                unclaimed_amounts[i].recipient = recipient.address;
                unclaimed_amounts[i].amount = unclaimed_amounts[i]
                    .amount
                    .checked_add(amount)
                    .ok_or(ErrorCode::MathOverflow)?;
                unclaimed_amounts[i].timestamp = Clock::get()?.unix_timestamp;

                held_as_unclaimed = held_as_unclaimed
                    .checked_add(amount)
                    .ok_or(ErrorCode::MathOverflow)?;

                #[cfg(feature = "verbose")]
                msg!(
                    "Recipient {} ATA missing, holding {} as unclaimed",
                    recipient.address,
                    amount
                );
            } else {
                // Validate and transfer - no borrow held, CPI is safe
                validate_and_send_to_recipient(
                    ata,
                    recipient,
                    amount,
                    &ctx.accounts.mint,
                    &ctx.accounts.vault,
                    &ctx.accounts.split_config.to_account_info(),
                    &ctx.accounts.token_program,
                    signer_seeds,
                )?;

                distributed = distributed
                    .checked_add(amount)
                    .ok_or(ErrorCode::MathOverflow)?;
            }
        }
    }

    // Protocol fee (1% + dust)
    let protocol_fee = available_to_split
        .checked_sub(distributed)
        .ok_or(ErrorCode::MathUnderflow)?
        .checked_sub(held_as_unclaimed)
        .ok_or(ErrorCode::MathUnderflow)?;

    let mut protocol_fee_sent = 0u64;

    if protocol_fee > 0 {
        let protocol_ata = ctx.remaining_accounts.last().unwrap();

        // Derive expected protocol ATA
        let expected_protocol_ata = get_associated_token_address_with_program_id(
            &protocol_fee_wallet,
            &ctx.accounts.mint.key(),
            &ctx.accounts.token_program.key(),
        );

        // Validate address
        require!(
            protocol_ata.key() == expected_protocol_ata,
            ErrorCode::InvalidProtocolFeeRecipient
        );

        // Validate writable
        require!(
            protocol_ata.is_writable,
            ErrorCode::InvalidProtocolFeeRecipient
        );

        if protocol_ata.data_is_empty() || is_account_frozen(protocol_ata) {
            // Protocol ATA missing - add to protocol_unclaimed (update local copy)
            protocol_unclaimed = protocol_unclaimed
                .checked_add(protocol_fee)
                .ok_or(ErrorCode::MathOverflow)?;

            #[cfg(feature = "verbose")]
            msg!(
                "Protocol ATA missing, holding {} as unclaimed",
                protocol_fee
            );
        } else {
            // Validate and transfer to protocol
            let valid_owner =
                protocol_ata.owner == &token::ID || protocol_ata.owner == &token_2022::ID;
            require!(valid_owner, ErrorCode::InvalidProtocolFeeRecipient);

            let protocol_token_account =
                InterfaceAccount::<'info, TokenAccount>::try_from(protocol_ata)
                    .map_err(|_| ErrorCode::InvalidProtocolFeeRecipient)?;

            require!(
                protocol_token_account.owner == protocol_fee_wallet,
                ErrorCode::InvalidProtocolFeeRecipient
            );
            require!(
                protocol_token_account.mint == ctx.accounts.mint.key(),
                ErrorCode::InvalidProtocolFeeRecipient
            );

            // Transfer protocol fee - no borrow held, CPI is safe
            let cpi_accounts = TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: protocol_token_account.to_account_info(),
                authority: ctx.accounts.split_config.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token_interface::transfer_checked(cpi_ctx, protocol_fee, ctx.accounts.mint.decimals)?;

            protocol_fee_sent = protocol_fee;
        }
    }

    // Self-healing: attempt to clear recipient unclaimed
    let mut unclaimed_cleared = 0u64;

    for i in 0..recipient_count {
        let unclaimed_amount = unclaimed_amounts[i].amount;
        if unclaimed_amount > 0 {
            let ata = &ctx.remaining_accounts[i];

            if ata.data_is_empty() || is_account_frozen(ata) {
                continue; // Still missing or frozen
            }

            // Transfer unclaimed - no borrow held, CPI is safe
            let recipient = &recipients[i];
            validate_and_send_to_recipient(
                ata,
                recipient,
                unclaimed_amount,
                &ctx.accounts.mint,
                &ctx.accounts.vault,
                &ctx.accounts.split_config.to_account_info(),
                &ctx.accounts.token_program,
                signer_seeds,
            )?;

            // Clear entry (update local copy)
            unclaimed_amounts[i].amount = 0;
            unclaimed_cleared = unclaimed_cleared
                .checked_add(unclaimed_amount)
                .ok_or(ErrorCode::MathOverflow)?;
        }
    }

    // Self-healing: attempt to clear protocol unclaimed
    let mut protocol_unclaimed_cleared = 0u64;

    if protocol_unclaimed > 0 {
        let protocol_ata = ctx.remaining_accounts.last().unwrap();

        if !protocol_ata.data_is_empty() && !is_account_frozen(protocol_ata) {
            let amount = protocol_unclaimed;

            // Validate and transfer
            let valid_owner =
                protocol_ata.owner == &token::ID || protocol_ata.owner == &token_2022::ID;
            if valid_owner {
                if let Ok(protocol_token_account) =
                    InterfaceAccount::<'info, TokenAccount>::try_from(protocol_ata)
                {
                    if protocol_token_account.owner == protocol_fee_wallet
                        && protocol_token_account.mint == ctx.accounts.mint.key()
                    {
                        let cpi_accounts = TransferChecked {
                            from: ctx.accounts.vault.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                            to: protocol_token_account.to_account_info(),
                            authority: ctx.accounts.split_config.to_account_info(),
                        };
                        let cpi_ctx = CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            cpi_accounts,
                            signer_seeds,
                        );
                        token_interface::transfer_checked(
                            cpi_ctx,
                            amount,
                            ctx.accounts.mint.decimals,
                        )?;

                        protocol_unclaimed = 0;
                        protocol_unclaimed_cleared = amount;
                    }
                }
            }
        }
    }

    // Phase 3: Mutable borrow to write back state updates
    {
        let mut config = ctx.accounts.split_config.load_mut()?;
        for (i, unclaimed) in unclaimed_amounts.iter().enumerate() {
            config.unclaimed_amounts[i] = *unclaimed;
        }
        config.protocol_unclaimed = protocol_unclaimed;
        config.last_activity = Clock::get()?.unix_timestamp;
    } // ← Borrow DROPPED here

    emit!(SplitExecuted {
        config: ctx.accounts.split_config.key(),
        vault: ctx.accounts.vault.key(),
        total_amount: vault_balance,
        recipients_distributed: distributed,
        protocol_fee: protocol_fee_sent,
        held_as_unclaimed,
        unclaimed_cleared,
        protocol_unclaimed_cleared,
        executor: ctx.accounts.executor.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
