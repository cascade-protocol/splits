//! Tests for initialize_protocol instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{get_rent, program_data_account, system_account, uninitialized_account},
        instructions::{build_initialize_protocol, derive_program_data, derive_protocol_config, PROGRAM_ID},
        serialization::PROTOCOL_CONFIG_SIZE,
        setup_mollusk,
    },
    mollusk_svm::result::Check,
    // 0.5.1: All imports from solana_sdk, not modular crates
    solana_sdk::{
        account::Account,
        program_error::ProgramError,
        pubkey::Pubkey,
        system_program,
    },
};

#[test]
fn test_initialize_protocol_success() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, _bump) = derive_protocol_config();
    let (program_data, _) = derive_program_data();

    // Build instruction
    let instruction = build_initialize_protocol(
        protocol_config,
        authority,
        program_data,
        fee_wallet,
    );

    // Setup account states
    let accounts = vec![
        // Protocol config - uninitialized, will be created
        (protocol_config, uninitialized_account()),
        // Authority - needs lamports to pay rent
        (authority, system_account(10_000_000_000)),
        // Program data with authority as upgrade authority
        (program_data, program_data_account(authority)),
        // System program
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
    ];

    // Validate
    let checks = vec![
        Check::success(),
        // Check protocol_config was initialized with correct data
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
    let wrong_authority = Pubkey::new_unique(); // Different from program data's upgrade authority
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, _bump) = derive_protocol_config();
    let (program_data, _) = derive_program_data();

    // Build instruction with wrong authority
    let instruction = build_initialize_protocol(
        protocol_config,
        authority, // This signer
        program_data,
        fee_wallet,
    );

    // Program data has wrong_authority as upgrade authority
    let accounts = vec![
        (protocol_config, uninitialized_account()),
        (authority, system_account(10_000_000_000)),
        // Program data with different upgrade authority
        (program_data, program_data_account(wrong_authority)),
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
    ];

    // Should fail with Unauthorized error
    // Anchor custom errors start at 6000, Unauthorized is likely around there
    let checks = vec![
        Check::err(ProgramError::Custom(6015)), // ErrorCode::Unauthorized
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_initialize_protocol_invalid_program_data_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, _bump) = derive_protocol_config();
    let (program_data, _) = derive_program_data();
    let wrong_program_data = Pubkey::new_unique(); // Wrong PDA

    // Build instruction with wrong program_data address
    let instruction = build_initialize_protocol(
        protocol_config,
        authority,
        wrong_program_data, // Using wrong address
        fee_wallet,
    );

    // Setup accounts with wrong program_data
    let accounts = vec![
        (protocol_config, uninitialized_account()),
        (authority, system_account(10_000_000_000)),
        // Wrong program data account (not the correct PDA)
        (wrong_program_data, program_data_account(authority)),
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
    ];

    // Should fail - constraint check that program_data.owner == bpf_loader_upgradeable
    // or the PDA validation
    let checks = vec![
        Check::err(ProgramError::Custom(6015)), // ErrorCode::Unauthorized
    ];

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
    let instruction = build_initialize_protocol(
        protocol_config,
        authority,
        program_data,
        fee_wallet,
    );

    // Create program_data with no upgrade authority (immutable program)
    let mut program_data_no_auth = vec![0u8; 45];
    program_data_no_auth[0] = 3; // ProgramData discriminant
    program_data_no_auth[12] = 0; // None upgrade authority

    let accounts = vec![
        (protocol_config, uninitialized_account()),
        (authority, system_account(10_000_000_000)),
        // Program data with no upgrade authority
        (program_data, Account {
            lamports: 1_000_000,
            data: program_data_no_auth,
            owner: solana_sdk::bpf_loader_upgradeable::id(),
            executable: false,
            rent_epoch: 0,
        }),
        (system_program::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
    ];

    // Should fail because program has no upgrade authority
    let checks = vec![
        Check::err(ProgramError::Custom(6015)), // ErrorCode::Unauthorized
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
