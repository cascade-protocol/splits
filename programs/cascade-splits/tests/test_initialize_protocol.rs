//! Tests for initialize_protocol instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{
            program_data_account, system_account, system_program_account, uninitialized_account,
        },
        error_code, ErrorCode,
        instructions::{
            build_initialize_protocol, derive_program_data, derive_protocol_config, PROGRAM_ID,
        },
        serialization::PROTOCOL_CONFIG_SIZE,
        setup_mollusk,
    },
    mollusk_svm::result::Check,
    solana_sdk::{account::Account, program_error::ProgramError, pubkey::Pubkey},
};

#[test]
fn test_initialize_protocol_success() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, _bump) = derive_protocol_config();
    let (program_data, _) = derive_program_data();

    // Build instruction
    let instruction = build_initialize_protocol(protocol_config, authority, program_data, fee_wallet);

    // Setup account states
    let accounts = vec![
        (protocol_config, uninitialized_account()),
        (authority, system_account(10_000_000_000)),
        (program_data, program_data_account(authority)),
        system_program_account(),
    ];

    // Validate
    let checks = vec![
        Check::success(),
        Check::account(&protocol_config)
            .owner(&PROGRAM_ID)
            .space(PROTOCOL_CONFIG_SIZE)
            .rent_exempt()
            .build(),
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_initialize_protocol_wrong_upgrade_authority_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let wrong_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, _bump) = derive_protocol_config();
    let (program_data, _) = derive_program_data();

    // Build instruction with authority as signer
    let instruction = build_initialize_protocol(protocol_config, authority, program_data, fee_wallet);

    // Program data has wrong_authority as upgrade authority
    let accounts = vec![
        (protocol_config, uninitialized_account()),
        (authority, system_account(10_000_000_000)),
        (program_data, program_data_account(wrong_authority)),
        system_program_account(),
    ];

    // Should fail because signer is not the upgrade authority
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_initialize_protocol_invalid_program_data_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, _bump) = derive_protocol_config();
    let (_program_data, _) = derive_program_data();
    let wrong_program_data = Pubkey::new_unique();

    // Build instruction with wrong program_data address
    let instruction =
        build_initialize_protocol(protocol_config, authority, wrong_program_data, fee_wallet);

    // Setup accounts with wrong program_data
    let accounts = vec![
        (protocol_config, uninitialized_account()),
        (authority, system_account(10_000_000_000)),
        (wrong_program_data, program_data_account(authority)),
        system_program_account(),
    ];

    // Should fail - wrong PDA
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_initialize_protocol_no_upgrade_authority_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, _bump) = derive_protocol_config();
    let (program_data, _) = derive_program_data();

    // Build instruction
    let instruction = build_initialize_protocol(protocol_config, authority, program_data, fee_wallet);

    // Create program_data with no upgrade authority (immutable program)
    let mut program_data_no_auth = vec![0u8; 45];
    program_data_no_auth[0] = 3; // ProgramData discriminant
    program_data_no_auth[12] = 0; // None upgrade authority

    let accounts = vec![
        (protocol_config, uninitialized_account()),
        (authority, system_account(10_000_000_000)),
        (
            program_data,
            Account {
                lamports: 1_000_000,
                data: program_data_no_auth,
                owner: solana_sdk::bpf_loader_upgradeable::id(),
                executable: false,
                rent_epoch: 0,
            },
        ),
        system_program_account(),
    ];

    // Should fail because program has no upgrade authority
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
