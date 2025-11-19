//! Tests for update_split_config instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{
            derive_ata, get_rent, mint_account, program_account, system_account, token_account,
            token_program_account,
        },
        error_code, ErrorCode,
        instructions::{
            build_update_split_config, derive_split_config, derive_vault, RecipientInput,
            PROGRAM_ID,
        },
        serialization::{serialize_split_config_simple, RecipientData, SPLIT_CONFIG_SIZE},
        setup_mollusk_with_token,
    },
    mollusk_svm::result::Check,
    solana_sdk::{program_error::ProgramError, pubkey::Pubkey},
};

#[test]
fn test_update_split_config_success() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Original recipient
    let recipient1 = Pubkey::new_unique();
    let original_recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // New recipients
    let new_recipient1 = Pubkey::new_unique();
    let new_recipient2 = Pubkey::new_unique();
    let new_recipient1_ata = derive_ata(&new_recipient1, &mint);
    let new_recipient2_ata = derive_ata(&new_recipient2, &mint);

    let new_recipients = vec![
        RecipientInput {
            address: new_recipient1,
            percentage_bps: 5000,
        },
        RecipientInput {
            address: new_recipient2,
            percentage_bps: 4900,
        },
    ];

    // Create account data
    let split_config_data = serialize_split_config_simple(
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &original_recipients,
    );

    // Build instruction
    let instruction = build_update_split_config(
        split_config,
        vault,
        authority,
        mint,
        &new_recipients,
        &[new_recipient1_ata, new_recipient2_ata],
    );

    // Setup account states
    let accounts = vec![
        (
            split_config,
            program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                split_config_data,
                PROGRAM_ID,
            ),
        ),
        (vault, token_account(mint, split_config, 0, &rent)),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (authority, system_account(1_000_000)),
        token_program_account(),
        (
            new_recipient1_ata,
            token_account(mint, new_recipient1, 0, &rent),
        ),
        (
            new_recipient2_ata,
            token_account(mint, new_recipient2, 0, &rent),
        ),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_update_split_config_wrong_authority_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let wrong_authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Original recipient
    let recipient1 = Pubkey::new_unique();
    let original_recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // New recipients
    let new_recipient1 = Pubkey::new_unique();
    let new_recipient1_ata = derive_ata(&new_recipient1, &mint);

    let new_recipients = vec![RecipientInput {
        address: new_recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let split_config_data = serialize_split_config_simple(
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &original_recipients,
    );

    // Build instruction with wrong authority
    let instruction = build_update_split_config(
        split_config,
        vault,
        wrong_authority,
        mint,
        &new_recipients,
        &[new_recipient1_ata],
    );

    // Setup account states
    let accounts = vec![
        (
            split_config,
            program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                split_config_data,
                PROGRAM_ID,
            ),
        ),
        (vault, token_account(mint, split_config, 0, &rent)),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (wrong_authority, system_account(1_000_000)),
        token_program_account(),
        (
            new_recipient1_ata,
            token_account(mint, new_recipient1, 0, &rent),
        ),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_update_split_config_vault_not_empty_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Original recipient
    let recipient1 = Pubkey::new_unique();
    let original_recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // New recipients
    let new_recipient1 = Pubkey::new_unique();
    let new_recipient1_ata = derive_ata(&new_recipient1, &mint);

    let new_recipients = vec![RecipientInput {
        address: new_recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let split_config_data = serialize_split_config_simple(
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &original_recipients,
    );

    // Build instruction
    let instruction = build_update_split_config(
        split_config,
        vault,
        authority,
        mint,
        &new_recipients,
        &[new_recipient1_ata],
    );

    // Setup account states - vault has tokens (should fail)
    let accounts = vec![
        (
            split_config,
            program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                split_config_data,
                PROGRAM_ID,
            ),
        ),
        (vault, token_account(mint, split_config, 1_000_000, &rent)),
        (mint, mint_account(Some(authority), 6, 1_000_000, &rent)),
        (authority, system_account(1_000_000)),
        token_program_account(),
        (
            new_recipient1_ata,
            token_account(mint, new_recipient1, 0, &rent),
        ),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::VaultNotEmpty,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
