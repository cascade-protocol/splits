//! Tests for update_protocol_config instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{get_rent, program_account, system_account},
        error_code, ErrorCode,
        instructions::{build_update_protocol_config, derive_protocol_config, PROGRAM_ID},
        serialization::{serialize_protocol_config, PROTOCOL_CONFIG_SIZE},
        setup_mollusk,
    },
    mollusk_svm::result::Check,
    solana_sdk::{program_error::ProgramError, pubkey::Pubkey},
};

#[test]
fn test_update_protocol_config_success() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let old_fee_wallet = Pubkey::new_unique();
    let new_fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create existing protocol config state
    let protocol_config_data = serialize_protocol_config(authority, old_fee_wallet, bump);

    // Build instruction
    let instruction =
        build_update_protocol_config(protocol_config, authority, new_fee_wallet);

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
fn test_update_protocol_config_wrong_authority_fails() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let wrong_authority = Pubkey::new_unique();
    let old_fee_wallet = Pubkey::new_unique();
    let new_fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create existing protocol config state with correct authority
    let protocol_config_data = serialize_protocol_config(authority, old_fee_wallet, bump);

    // Build instruction with wrong authority
    let instruction =
        build_update_protocol_config(protocol_config, wrong_authority, new_fee_wallet);

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
