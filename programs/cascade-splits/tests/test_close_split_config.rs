//! Tests for close_split_config instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{get_rent, program_account, system_account, token_account},
        error_code,
        instructions::{
            build_close_split_config, build_close_split_config_with_destination,
            derive_split_config, derive_vault, PROGRAM_ID,
        },
        serialization::{
            serialize_split_config, serialize_split_config_with_payer, RecipientData,
            UnclaimedAmountData, SPLIT_CONFIG_SIZE,
        },
        setup_mollusk_with_token, ErrorCode,
    },
    mollusk_svm::result::Check,
    mollusk_svm_programs_token::token,
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
        &[],       // no unclaimed
        0,         // no protocol unclaimed
        0,         // no last_activity
        authority, // rent_payer is authority
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
        (authority, system_account(0)), // rent_destination
        token::keyed_account(),
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
        0,
        authority,
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
        (authority, system_account(0)), // rent_destination
        token::keyed_account(),
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
        0,
        authority,
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
        (authority, system_account(0)), // rent_destination
        token::keyed_account(),
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
        0,
        authority,
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
        (authority, system_account(0)), // rent_destination (correct)
        token::keyed_account(),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_protocol_unclaimed_not_empty_fails() {
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

    // Create account data with protocol unclaimed
    let split_config_data = serialize_split_config(
        1,
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        &[],     // no recipient unclaimed
        100_000, // protocol unclaimed - should cause failure
        0,
        authority,
    );

    // Build instruction
    let instruction = build_close_split_config(split_config, vault, authority);

    // Setup account states - vault is empty but has protocol unclaimed
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
        (authority, system_account(0)), // rent_destination
        token::keyed_account(),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::UnclaimedNotEmpty,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_wrong_rent_destination_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let rent_payer = Pubkey::new_unique(); // Different from authority
    let wrong_destination = Pubkey::new_unique();
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

    // Create account data with separate rent_payer
    let split_config_data = serialize_split_config_with_payer(
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        rent_payer, // rent_payer is different from authority
    );

    // Build instruction with wrong rent destination
    let instruction = build_close_split_config_with_destination(
        split_config,
        vault,
        authority,
        wrong_destination,
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
        (authority, system_account(1_000_000)),
        (wrong_destination, system_account(0)), // Wrong destination
        token::keyed_account(),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::InvalidRentDestination,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_separate_rent_payer_success() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let rent_payer = Pubkey::new_unique(); // Different from authority
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

    // Create account data with separate rent_payer
    let split_config_data = serialize_split_config_with_payer(
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        rent_payer,
    );

    // Build instruction with correct rent destination
    let instruction =
        build_close_split_config_with_destination(split_config, vault, authority, rent_payer);

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
        (authority, system_account(1_000_000)),
        (rent_payer, system_account(0)), // Correct rent_payer
        token::keyed_account(),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_separate_rent_payer_receives_vault_rent() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let rent_payer = Pubkey::new_unique(); // Different from authority
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

    // Create account data with separate rent_payer
    let split_config_data = serialize_split_config_with_payer(
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        rent_payer,
    );

    // Calculate expected rent amounts
    let split_config_rent = rent.minimum_balance(SPLIT_CONFIG_SIZE);
    let vault_rent = rent.minimum_balance(165); // Token account size
    let total_rent_to_recover = split_config_rent + vault_rent;
    let initial_rent_payer_balance = 500_000u64;
    let initial_authority_balance = 1_000_000u64;

    // Build instruction with correct rent destination
    let instruction =
        build_close_split_config_with_destination(split_config, vault, authority, rent_payer);

    // Setup account states
    let accounts = vec![
        (
            split_config,
            program_account(split_config_rent, split_config_data, PROGRAM_ID),
        ),
        (vault, token_account(mint, split_config, 0, &rent)),
        (authority, system_account(initial_authority_balance)),
        (rent_payer, system_account(initial_rent_payer_balance)),
        token::keyed_account(),
    ];

    // Verify:
    // 1. Instruction succeeds
    // 2. Vault is closed (0 lamports)
    // 3. rent_payer (not authority) receives all rent
    // 4. authority balance unchanged
    let checks = vec![
        Check::success(),
        Check::account(&vault).lamports(0).build(), // Vault closed
        Check::account(&rent_payer)
            .lamports(initial_rent_payer_balance + total_rent_to_recover)
            .build(),
        Check::account(&authority)
            .lamports(initial_authority_balance)
            .build(), // Authority unchanged
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_recovers_all_rent_including_vault() {
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
        &[],       // no unclaimed
        0,         // no protocol unclaimed
        0,         // no last_activity
        authority, // rent_payer is authority
    );

    // Calculate expected rent amounts
    let split_config_rent = rent.minimum_balance(SPLIT_CONFIG_SIZE);
    let vault_rent = rent.minimum_balance(165); // Token account size
    let total_rent_to_recover = split_config_rent + vault_rent;
    let initial_authority_balance = 1_000_000u64;

    // Build instruction
    let instruction = build_close_split_config(split_config, vault, authority);

    // Setup account states - vault is empty
    let accounts = vec![
        (
            split_config,
            program_account(split_config_rent, split_config_data, PROGRAM_ID),
        ),
        (vault, token_account(mint, split_config, 0, &rent)),
        (authority, system_account(initial_authority_balance)),
        token::keyed_account(),
    ];

    // Verify:
    // 1. Instruction succeeds
    // 2. Vault account is closed (lamports = 0)
    // 3. Rent destination receives all rent (split_config + vault)
    let checks = vec![
        Check::success(),
        Check::account(&vault).lamports(0).build(), // Vault should be closed (no lamports)
        Check::account(&authority)
            .lamports(initial_authority_balance + total_rent_to_recover)
            .build(),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
