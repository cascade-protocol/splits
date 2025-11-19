//! Tests for close_split_config instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{get_rent, program_account, system_account, token_account, token_program_account},
        error_code, ErrorCode,
        instructions::{build_close_split_config, derive_split_config, derive_vault, PROGRAM_ID},
        serialization::{
            serialize_split_config, RecipientData, UnclaimedAmountData, SPLIT_CONFIG_SIZE,
        },
        setup_mollusk_with_token,
    },
    mollusk_svm::result::Check,
    solana_sdk::{program_error::ProgramError, pubkey::Pubkey},
};

#[test]
fn test_close_split_config_success() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient
    let recipient1 = Pubkey::new_unique();
    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data - no unclaimed amounts
    let split_config_data = serialize_split_config(
        1, // version
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        &[], // no unclaimed
        0,   // no protocol unclaimed
    );

    // Build instruction
    let instruction = build_close_split_config(split_config, vault, authority);

    // Setup account states - vault is empty
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
        (authority, system_account(1_000_000)),
        token_program_account(),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_vault_not_empty_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient
    let recipient1 = Pubkey::new_unique();
    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let split_config_data = serialize_split_config(
        1,
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        &[],
        0,
    );

    // Build instruction
    let instruction = build_close_split_config(split_config, vault, authority);

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
        (authority, system_account(1_000_000)),
        token_program_account(),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::VaultNotEmpty,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_unclaimed_not_empty_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient
    let recipient1 = Pubkey::new_unique();
    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Unclaimed amount - should cause failure
    let unclaimed = vec![UnclaimedAmountData {
        recipient: recipient1,
        amount: 100_000,
        timestamp: 1234567890,
    }];

    // Create account data with unclaimed
    let split_config_data = serialize_split_config(
        1,
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        &unclaimed,
        0,
    );

    // Build instruction
    let instruction = build_close_split_config(split_config, vault, authority);

    // Setup account states - vault is empty but has unclaimed
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
        (authority, system_account(1_000_000)),
        token_program_account(),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::UnclaimedNotEmpty,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_wrong_authority_fails() {
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

    // Recipient
    let recipient1 = Pubkey::new_unique();
    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let split_config_data = serialize_split_config(
        1,
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        &[],
        0,
    );

    // Build instruction with wrong authority
    let instruction = build_close_split_config(split_config, vault, wrong_authority);

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
        (wrong_authority, system_account(1_000_000)),
        token_program_account(),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
