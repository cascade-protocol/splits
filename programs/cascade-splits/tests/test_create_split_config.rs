//! Tests for create_split_config instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! This instruction requires Token and Associated Token programs for vault creation

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

#[test]
fn test_create_split_config_multiple_recipients_success() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Two recipients totaling 99%
    let recipient1 = Pubkey::new_unique();
    let recipient2 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let recipient2_ata = derive_ata(&recipient2, &mint);

    let recipients = vec![
        RecipientInput {
            address: recipient1,
            percentage_bps: 5000,
        },
        RecipientInput {
            address: recipient2,
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
        &[recipient1_ata, recipient2_ata],
    );

    // Setup account states
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

    // Validate
    let checks = vec![
        Check::success(),
        Check::account(&split_config)
            .owner(&PROGRAM_ID)
            .space(SPLIT_CONFIG_SIZE)
            .build(),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_max_recipients_success() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // 20 recipients - maximum allowed
    // 19 recipients at 495 bps each = 9405 bps
    // 1 recipient at 495 bps = 495 bps
    // Total = 9900 bps
    let mut recipients = Vec::new();
    let mut recipient_atas = Vec::new();
    let mut account_entries = vec![
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

    for _ in 0..20 {
        let recipient = Pubkey::new_unique();
        let ata = derive_ata(&recipient, &mint);
        recipients.push(RecipientInput {
            address: recipient,
            percentage_bps: 495, // 20 * 495 = 9900
        });
        recipient_atas.push(ata);
        account_entries.push((ata, token_account(mint, recipient, 0, &rent)));
    }

    // Build instruction
    let instruction = build_create_split_config(
        split_config,
        vault,
        authority,
        unique_id,
        mint,
        &recipients,
        &recipient_atas,
    );

    // Validate
    let checks = vec![
        Check::success(),
        Check::account(&split_config)
            .owner(&PROGRAM_ID)
            .space(SPLIT_CONFIG_SIZE)
            .build(),
    ];

    mollusk.process_and_validate_instruction(&instruction, &account_entries, &checks);
}

#[test]
fn test_create_split_config_too_many_recipients_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // 21 recipients - exceeds maximum
    let mut recipients = Vec::new();
    let mut recipient_atas = Vec::new();
    let mut account_entries = vec![
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

    for i in 0..21 {
        let recipient = Pubkey::new_unique();
        let ata = derive_ata(&recipient, &mint);
        // Distribute percentages to sum to 9900 even with 21 recipients
        // First 20: 471 each = 9420, 21st: 480 = 9900
        let bps = if i < 20 { 471 } else { 480 };
        recipients.push(RecipientInput {
            address: recipient,
            percentage_bps: bps,
        });
        recipient_atas.push(ata);
        account_entries.push((ata, token_account(mint, recipient, 0, &rent)));
    }

    // Build instruction
    let instruction = build_create_split_config(
        split_config,
        vault,
        authority,
        unique_id,
        mint,
        &recipients,
        &recipient_atas,
    );

    // Should fail with InvalidRecipientCount
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::InvalidRecipientCount))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &account_entries, &checks);
}

#[test]
fn test_create_split_config_recipient_ata_does_not_exist_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient with missing ATA
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

    // Setup account states - ATA is empty/uninitialized
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
        // ATA doesn't exist - empty account
        (recipient1_ata, system_account(0)),
    ];

    // Should fail with RecipientATADoesNotExist
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::RecipientATADoesNotExist))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_recipient_ata_wrong_owner_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient
    let recipient1 = Pubkey::new_unique();
    let wrong_owner = Pubkey::new_unique();
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

    // Setup account states - ATA has wrong owner
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
        // ATA exists but has wrong owner
        (recipient1_ata, token_account(mint, wrong_owner, 0, &rent)),
    ];

    // Should fail with RecipientATAWrongOwner
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::RecipientATAWrongOwner))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_recipient_ata_wrong_mint_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let wrong_mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient
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

    // Setup account states - ATA has wrong mint
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
        // ATA exists but has wrong mint
        (recipient1_ata, token_account(wrong_mint, recipient1, 0, &rent)),
    ];

    // Should fail with RecipientATAWrongMint
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::RecipientATAWrongMint))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_create_split_config_total_over_99_percent_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipients totaling 100% (10000 bps) instead of 99%
    let recipient1 = Pubkey::new_unique();
    let recipient2 = Pubkey::new_unique();
    let recipient1_ata = derive_ata(&recipient1, &mint);
    let recipient2_ata = derive_ata(&recipient2, &mint);

    let recipients = vec![
        RecipientInput {
            address: recipient1,
            percentage_bps: 5000,
        },
        RecipientInput {
            address: recipient2,
            percentage_bps: 5000, // Total = 10000 instead of 9900
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

    // Setup account states
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

    // Should fail with InvalidSplitTotal
    let checks = vec![
        Check::err(ProgramError::Custom(error_code(ErrorCode::InvalidSplitTotal))),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
