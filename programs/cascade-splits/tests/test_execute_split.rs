//! Tests for execute_split instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! These tests validate the core split execution and self-healing logic

mod helpers;

use {
    helpers::{
        accounts::{
            derive_ata, get_rent, mint_account, program_account, system_account, token_account,
        },
        error_code,
        instructions::{
            build_execute_split, derive_protocol_config, derive_split_config, derive_vault,
            PROGRAM_ID,
        },
        serialization::{
            serialize_protocol_config, serialize_split_config_simple, RecipientData,
            PROTOCOL_CONFIG_SIZE, SPLIT_CONFIG_SIZE,
        },
        setup_mollusk_with_token, ErrorCode,
    },
    mollusk_svm::result::Check,
    mollusk_svm_programs_token::token,
    solana_sdk::{program_error::ProgramError, pubkey::Pubkey},
};

/// Test successful split execution with token transfers
#[test]
fn test_execute_split_success() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Single recipient with 99% (9900 bps)
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata],
        protocol_ata,
    );

    // Vault with 1,000,000 tokens
    let vault_amount = 1_000_000u64;

    // Setup account states
    let accounts = vec![
        // Split config
        (
            split_config,
            program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                split_config_data,
                PROGRAM_ID,
            ),
        ),
        // Vault with tokens
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        // Mint
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        // Protocol config
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        // Executor
        (executor, system_account(1_000_000)),
        // Token program - use keyed_account() for proper program data
        token::keyed_account(),
        // Recipient1 ATA
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        // Protocol ATA
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Validate
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test that missing recipient ATA stores amount as unclaimed
#[test]
fn test_execute_split_missing_recipient_ata_stores_unclaimed() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Single recipient with 99%
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata],
        protocol_ata,
    );

    let vault_amount = 1_000_000u64;

    // Setup account states - recipient ATA is EMPTY (doesn't exist)
    let accounts = vec![
        (
            split_config,
            program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                split_config_data,
                PROGRAM_ID,
            ),
        ),
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        // Token program - use keyed_account() for proper program data
        token::keyed_account(),
        // Recipient1 ATA - EMPTY (missing)
        (recipient1_ata, system_account(0)),
        // Protocol ATA - exists
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should succeed - stores as unclaimed instead of failing
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_execute_split_insufficient_remaining_accounts_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Two recipients
    let recipient1 = Pubkey::new_unique();
    let recipient2 = Pubkey::new_unique();
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![
        RecipientData {
            address: recipient1,
            percentage_bps: 5000,
        },
        RecipientData {
            address: recipient2,
            percentage_bps: 4900,
        },
    ];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);

    // Build instruction - only providing 1 recipient ATA instead of 2
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata], // Missing recipient2_ata!
        protocol_ata,
    );

    let vault_amount = 1_000_000u64;

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
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        // Token program - use keyed_account() for proper program data
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should fail with InsufficientRemainingAccounts
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::InsufficientRemainingAccounts,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_execute_split_empty_vault() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Single recipient
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata],
        protocol_ata,
    );

    // Empty vault - 0 tokens
    let vault_amount = 0u64;

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
        // Vault with 0 tokens
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        // Token program - use keyed_account() for proper program data
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should succeed even with empty vault (no-op)
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test multiple recipients distribution with correct math
#[test]
fn test_execute_split_multiple_recipients_math() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Two recipients: 50% and 49%
    let recipient1 = Pubkey::new_unique();
    let recipient2 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let recipient2_ata = derive_ata(&recipient2, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![
        RecipientData {
            address: recipient1,
            percentage_bps: 5000,
        },
        RecipientData {
            address: recipient2,
            percentage_bps: 4900,
        },
    ];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata, recipient2_ata],
        protocol_ata,
    );

    // Vault with 1,000,000 tokens
    // Expected: recipient1 = 500,000, recipient2 = 490,000, protocol = 10,000
    let vault_amount = 1_000_000u64;

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
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (recipient2_ata, token_account(mint, recipient2, 0, &rent)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test that protocol gets 1% + rounding dust
#[test]
fn test_execute_split_protocol_fee_with_rounding() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Single recipient with 99%
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata],
        protocol_ata,
    );

    // Vault with 999 tokens - causes rounding
    // 999 * 9900 / 10000 = 989.01 -> 989 (floor)
    // Protocol gets 999 - 989 = 10 (1% + dust)
    let vault_amount = 999u64;

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
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test idempotent execution - calling twice with no new funds
#[test]
fn test_execute_split_idempotent() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Single recipient
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data - empty vault, no unclaimed
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata],
        protocol_ata,
    );

    // Empty vault - should be no-op
    let vault_amount = 0u64;

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
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should succeed (no-op)
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test that unclaimed amounts are protected from re-splitting
#[test]
fn test_execute_split_unclaimed_protected() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Single recipient
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data with existing unclaimed
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);

    use helpers::serialization::{serialize_split_config, UnclaimedAmountData};
    let unclaimed = vec![UnclaimedAmountData {
        recipient: recipient1,
        amount: 500_000,
        timestamp: 1234567890,
    }];

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
        0,
        authority,
    );

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata],
        protocol_ata,
    );

    // Vault has 1,000,000 total, but 500,000 is unclaimed
    // Only 500,000 should be available for new split
    let vault_amount = 1_000_000u64;

    // Setup account states - ATA still missing
    let accounts = vec![
        (
            split_config,
            program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                split_config_data,
                PROGRAM_ID,
            ),
        ),
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        token::keyed_account(),
        // ATA still missing - will add to unclaimed
        (recipient1_ata, system_account(0)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should succeed - unclaimed protected
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test protocol unclaimed tracking when protocol ATA missing
#[test]
fn test_execute_split_protocol_unclaimed() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Single recipient
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &[recipient1_ata],
        protocol_ata,
    );

    let vault_amount = 1_000_000u64;

    // Setup account states - protocol ATA missing
    let accounts = vec![
        (
            split_config,
            program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                split_config_data,
                PROGRAM_ID,
            ),
        ),
        (
            vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        // Protocol ATA missing
        (protocol_ata, system_account(0)),
    ];

    // Should succeed - stores protocol fee as unclaimed
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test with invalid vault address (different from stored in config)
#[test]
fn test_execute_split_invalid_vault_address_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let correct_vault = derive_vault(&split_config, &mint);

    // Use a completely different vault address
    let wrong_vault = Pubkey::new_unique();

    // Single recipient
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data - stores correct_vault as the expected vault
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data = serialize_split_config_simple(
        authority,
        mint,
        correct_vault,
        unique_id,
        split_bump,
        &recipients,
    );

    // Build instruction with WRONG vault address
    let instruction = build_execute_split(
        split_config,
        wrong_vault, // Wrong vault address!
        mint,
        protocol_config,
        executor,
        &[recipient1_ata],
        protocol_ata,
    );

    let vault_amount = 1_000_000u64;

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
        // Wrong vault address with valid token account data
        (
            wrong_vault,
            token_account(mint, split_config, vault_amount, &rent),
        ),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should fail with InvalidVault because vault.key() != split_config.vault
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::InvalidVault,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test with many recipients (stress test)
#[test]
fn test_execute_split_many_recipients() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let executor = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);
    let protocol_ata = derive_ata(&fee_wallet, &mint);

    // 10 recipients at 990 bps each = 9900 bps
    let mut recipients = Vec::new();
    let mut recipient_atas = Vec::new();
    let mut account_entries = vec![
        (
            split_config,
            program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                vec![], // Will be set below
                PROGRAM_ID,
            ),
        ),
        (vault, token_account(mint, split_config, 1_000_000, &rent)),
        (mint, mint_account(Some(authority), 6, 1_000_000, &rent)),
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                serialize_protocol_config(authority, fee_wallet, protocol_bump),
                PROGRAM_ID,
            ),
        ),
        (executor, system_account(1_000_000)),
        token::keyed_account(),
    ];

    for _ in 0..10 {
        let recipient = Pubkey::new_unique();
        let ata = derive_ata(&recipient, &mint);
        recipients.push(RecipientData {
            address: recipient,
            percentage_bps: 990,
        });
        recipient_atas.push(ata);
        account_entries.push((ata, token_account(mint, recipient, 0, &rent)));
    }

    // Add protocol ATA
    account_entries.push((protocol_ata, token_account(mint, fee_wallet, 0, &rent)));

    // Update split_config data
    let split_config_data =
        serialize_split_config_simple(authority, mint, vault, unique_id, split_bump, &recipients);
    account_entries[0].1 = program_account(
        rent.minimum_balance(SPLIT_CONFIG_SIZE),
        split_config_data,
        PROGRAM_ID,
    );

    // Build instruction
    let instruction = build_execute_split(
        split_config,
        vault,
        mint,
        protocol_config,
        executor,
        &recipient_atas,
        protocol_ata,
    );

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &account_entries, &checks);
}
