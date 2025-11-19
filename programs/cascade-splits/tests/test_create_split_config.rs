//! Tests for create_split_config instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! This instruction requires Token and Associated Token programs for vault creation
//!
//! LIMITATION: All create_split_config tests are ignored because:
//! 1. The instruction CPIs into Associated Token Program to create vault ATA
//! 2. Mollusk only supports Token program, not ATA program
//! 3. Anchor's account init happens before handler validation, so even error tests fail
//! Run `anchor test` for full integration testing of this instruction.

mod helpers;

use {
    helpers::{
        accounts::{
            derive_ata, get_rent, mint_account, system_account, token_account,
            uninitialized_account,
        },
        error_code, ErrorCode,
        instructions::{
            build_create_split_config, derive_split_config, derive_vault, RecipientInput,
            PROGRAM_ID,
        },
        serialization::SPLIT_CONFIG_SIZE,
        setup_mollusk_with_token,
    },
    mollusk_svm::result::Check,
    mollusk_svm_programs_token::{associated_token, token},
    solana_sdk::{account::Account, program_error::ProgramError, pubkey::Pubkey, system_program},
};

#[test]
fn test_create_split_config_single_recipient_success() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient with 99% (9900 bps)
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);

    let recipients = vec![RecipientInput {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Build instruction
    let instruction = build_create_split_config(
        split_config,
        vault,
        authority,
        unique_id,
        mint,
        &recipients,
        &[recipient1_ata],
    );

    // Setup account states - must match instruction account order
    let accounts = vec![
        // 0. split_config - uninitialized (will be init)
        (split_config, uninitialized_account()),
        // 1. unique_id
        (unique_id, system_account(0)),
        // 2. authority - needs lamports for rent
        (authority, system_account(10_000_000_000)),
        // 3. mint_account
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        // 4. vault - uninitialized (will be init as ATA)
        (vault, uninitialized_account()),
        // 5. token_program - use keyed_account() for proper program data
        token::keyed_account(),
        // 6. associated_token_program
        associated_token::keyed_account(),
        // 7. system_program
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
        // remaining_accounts: recipient ATAs
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
    ];

    // Validate
    let checks = vec![
        Check::success(),
        // Check split_config was created
        Check::account(&split_config)
            .owner(&PROGRAM_ID)
            .space(SPLIT_CONFIG_SIZE)
            .build(),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_invalid_split_total_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient with wrong percentage (not 99%)
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);

    let recipients = vec![RecipientInput {
        address: recipient1,
        percentage_bps: 5000, // Only 50%, should be 99%
    }];

    // Build instruction
    let instruction = build_create_split_config(
        split_config,
        vault,
        authority,
        unique_id,
        mint,
        &recipients,
        &[recipient1_ata],
    );

    // Setup account states - must match instruction account order
    let accounts = vec![
        (split_config, uninitialized_account()),
        (unique_id, system_account(0)),
        (authority, system_account(10_000_000_000)),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (vault, uninitialized_account()),
        token::keyed_account(),
        associated_token::keyed_account(),
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
    ];

    // Should fail with InvalidSplitTotal
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::InvalidSplitTotal))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_zero_recipients_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Empty recipients
    let recipients: Vec<RecipientInput> = vec![];

    // Build instruction
    let instruction = build_create_split_config(
        split_config,
        vault,
        authority,
        unique_id,
        mint,
        &recipients,
        &[],
    );

    // Setup account states - must match instruction account order
    let accounts = vec![
        (split_config, uninitialized_account()),
        (unique_id, system_account(0)),
        (authority, system_account(10_000_000_000)),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (vault, uninitialized_account()),
        token::keyed_account(),
        associated_token::keyed_account(),
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
    ];

    // Should fail with InvalidRecipientCount
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::InvalidRecipientCount))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_duplicate_recipients_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Duplicate recipient
    let recipient1 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);

    let recipients = vec![
        RecipientInput {
            address: recipient1,
            percentage_bps: 5000,
        },
        RecipientInput {
            address: recipient1, // Duplicate!
            percentage_bps: 4900,
        },
    ];

    // Build instruction
    let instruction = build_create_split_config(
        split_config,
        vault,
        authority,
        unique_id,
        mint,
        &recipients,
        &[recipient1_ata, recipient1_ata], // Same ATA twice
    );

    // Setup account states - must match instruction account order
    let accounts = vec![
        (split_config, uninitialized_account()),
        (unique_id, system_account(0)),
        (authority, system_account(10_000_000_000)),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (vault, uninitialized_account()),
        token::keyed_account(),
        associated_token::keyed_account(),
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
    ];

    // Should fail with DuplicateRecipient
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::DuplicateRecipient))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_zero_address_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient with zero address
    let zero_address = Pubkey::default();
    let zero_ata = derive_ata(&zero_address, &mint);

    let recipients = vec![RecipientInput {
        address: zero_address, // Zero address!
        percentage_bps: 9900,
    }];

    // Build instruction
    let instruction = build_create_split_config(
        split_config,
        vault,
        authority,
        unique_id,
        mint,
        &recipients,
        &[zero_ata],
    );

    // Setup account states - must match instruction account order
    let accounts = vec![
        (split_config, uninitialized_account()),
        (unique_id, system_account(0)),
        (authority, system_account(10_000_000_000)),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (vault, uninitialized_account()),
        token::keyed_account(),
        associated_token::keyed_account(),
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
        (zero_ata, token_account(mint, zero_address, 0, &rent)),
    ];

    // Should fail with ZeroAddress
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::ZeroAddress))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_zero_percentage_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipients with one having zero percentage
    let recipient1 = Pubkey::new_unique();
    let recipient2 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let recipient2_ata = derive_ata(&recipient2, &mint);

    let recipients = vec![
        RecipientInput {
            address: recipient1,
            percentage_bps: 0, // Zero percentage!
        },
        RecipientInput {
            address: recipient2,
            percentage_bps: 9900,
        },
    ];

    // Build instruction
    let instruction = build_create_split_config(
        split_config,
        vault,
        authority,
        unique_id,
        mint,
        &recipients,
        &[recipient1_ata, recipient2_ata],
    );

    // Setup account states - must match instruction account order
    let accounts = vec![
        (split_config, uninitialized_account()),
        (unique_id, system_account(0)),
        (authority, system_account(10_000_000_000)),
        (mint, mint_account(Some(authority), 6, 0, &rent)),
        (vault, uninitialized_account()),
        token::keyed_account(),
        associated_token::keyed_account(),
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
        (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
        (recipient2_ata, token_account(mint, recipient2, 0, &rent)),
    ];

    // Should fail with ZeroPercentage
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::ZeroPercentage))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
