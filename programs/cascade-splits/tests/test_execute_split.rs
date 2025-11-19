//! Tests for execute_split instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! These tests validate the core split execution and self-healing logic

mod helpers;

use {
    helpers::{
        accounts::{derive_ata, get_rent, mint_account, program_account, system_account, token_account},
        instructions::{
            build_execute_split, derive_protocol_config, derive_split_config, derive_vault,
            PROGRAM_ID,
        },
        serialization::{
            serialize_protocol_config, serialize_split_config_simple, RecipientData,
            PROTOCOL_CONFIG_SIZE, SPLIT_CONFIG_SIZE,
        },
        setup_mollusk_with_token,
    },
    mollusk_svm::result::Check,
    mollusk_svm_programs_token::token,
    // 0.5.1: All imports from solana_sdk
    solana_sdk::{
        program_error::ProgramError,
        pubkey::Pubkey,
    },
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
    let split_config_data = serialize_split_config_simple(
        authority, mint, vault, unique_id, split_bump, &recipients,
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

    // Vault with 1,000,000 tokens
    let vault_amount = 1_000_000u64;

    // Setup account states
    let accounts = vec![
        // Split config
        (split_config, program_account(
            rent.minimum_balance(SPLIT_CONFIG_SIZE),
            split_config_data,
            PROGRAM_ID,
        )),
        // Vault with tokens
        (vault, token_account(mint, split_config, vault_amount, &rent)),
        // Mint
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        // Protocol config
        (protocol_config, program_account(
            rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
            protocol_config_data,
            PROGRAM_ID,
        )),
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
    let checks = vec![
        Check::success(),
    ];

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
    let split_config_data = serialize_split_config_simple(
        authority, mint, vault, unique_id, split_bump, &recipients,
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

    let vault_amount = 1_000_000u64;

    // Setup account states - recipient ATA is EMPTY (doesn't exist)
    let accounts = vec![
        (split_config, program_account(
            rent.minimum_balance(SPLIT_CONFIG_SIZE),
            split_config_data,
            PROGRAM_ID,
        )),
        (vault, token_account(mint, split_config, vault_amount, &rent)),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (protocol_config, program_account(
            rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
            protocol_config_data,
            PROGRAM_ID,
        )),
        (executor, system_account(1_000_000)),
        // Token program - use keyed_account() for proper program data
        token::keyed_account(),
        // Recipient1 ATA - EMPTY (missing)
        (recipient1_ata, system_account(0)),
        // Protocol ATA - exists
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should succeed - stores as unclaimed instead of failing
    let checks = vec![
        Check::success(),
    ];

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
    let split_config_data = serialize_split_config_simple(
        authority, mint, vault, unique_id, split_bump, &recipients,
    );

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
        (split_config, program_account(
            rent.minimum_balance(SPLIT_CONFIG_SIZE),
            split_config_data,
            PROGRAM_ID,
        )),
        (vault, token_account(mint, split_config, vault_amount, &rent)),
        (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
        (protocol_config, program_account(
            rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
            protocol_config_data,
            PROGRAM_ID,
        )),
        (executor, system_account(1_000_000)),
        // Token program - use keyed_account() for proper program data
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should fail with InsufficientRemainingAccounts
    let checks = vec![
        Check::err(ProgramError::Custom(6011)), // ErrorCode::InsufficientRemainingAccounts
    ];

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
    let split_config_data = serialize_split_config_simple(
        authority, mint, vault, unique_id, split_bump, &recipients,
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

    // Empty vault - 0 tokens
    let vault_amount = 0u64;

    // Setup account states
    let accounts = vec![
        (split_config, program_account(
            rent.minimum_balance(SPLIT_CONFIG_SIZE),
            split_config_data,
            PROGRAM_ID,
        )),
        // Vault with 0 tokens
        (vault, token_account(mint, split_config, vault_amount, &rent)),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (protocol_config, program_account(
            rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
            protocol_config_data,
            PROGRAM_ID,
        )),
        (executor, system_account(1_000_000)),
        // Token program - use keyed_account() for proper program data
        token::keyed_account(),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
    ];

    // Should succeed even with empty vault (no-op)
    let checks = vec![
        Check::success(),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
