//! Tests for transfer_protocol_authority instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{get_rent, program_account, system_account},
        error_code,
        instructions::{build_transfer_protocol_authority, derive_protocol_config, PROGRAM_ID},
        serialization::{serialize_protocol_config, PROTOCOL_CONFIG_SIZE},
        setup_mollusk, ErrorCode,
    },
    mollusk_svm::result::Check,
    solana_sdk::{program_error::ProgramError, pubkey::Pubkey},
};

#[test]
fn test_transfer_protocol_authority_success() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create existing protocol config state
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, bump);

    // Build instruction
    let instruction = build_transfer_protocol_authority(protocol_config, authority, new_authority);

    // Setup account states
    let accounts = vec![
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (authority, system_account(1_000_000)),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_transfer_protocol_authority_wrong_authority_fails() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let wrong_authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create existing protocol config state with correct authority
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, bump);

    // Build instruction with wrong authority as signer
    let instruction =
        build_transfer_protocol_authority(protocol_config, wrong_authority, new_authority);

    // Setup account states
    let accounts = vec![
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (wrong_authority, system_account(1_000_000)),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_transfer_protocol_authority_to_self() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create existing protocol config state
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, bump);

    // Build instruction - transfer to self (should succeed, it's valid)
    let instruction = build_transfer_protocol_authority(protocol_config, authority, authority);

    // Setup account states
    let accounts = vec![
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (authority, system_account(1_000_000)),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
