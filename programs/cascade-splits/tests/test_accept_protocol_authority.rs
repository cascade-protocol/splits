//! Tests for accept_protocol_authority instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{get_rent, program_account, system_account},
        error_code,
        instructions::{build_accept_protocol_authority, derive_protocol_config, PROGRAM_ID},
        serialization::{serialize_protocol_config_with_pending, PROTOCOL_CONFIG_SIZE},
        setup_mollusk, ErrorCode,
    },
    mollusk_svm::result::Check,
    solana_sdk::{program_error::ProgramError, pubkey::Pubkey},
};

#[test]
fn test_accept_protocol_authority_success() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create protocol config with pending transfer
    let protocol_config_data =
        serialize_protocol_config_with_pending(authority, new_authority, fee_wallet, bump);

    // Build instruction - new_authority accepts
    let instruction = build_accept_protocol_authority(protocol_config, new_authority);

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
        (new_authority, system_account(1_000_000)),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_accept_protocol_authority_wrong_signer_fails() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let wrong_signer = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create protocol config with pending transfer to new_authority
    let protocol_config_data =
        serialize_protocol_config_with_pending(authority, new_authority, fee_wallet, bump);

    // Build instruction - wrong_signer tries to accept
    let instruction = build_accept_protocol_authority(protocol_config, wrong_signer);

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
        (wrong_signer, system_account(1_000_000)),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_accept_protocol_authority_no_pending_transfer_fails() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create protocol config with NO pending transfer (default pubkey)
    let protocol_config_data =
        serialize_protocol_config_with_pending(authority, Pubkey::default(), fee_wallet, bump);

    // Build instruction - try to accept when nothing is pending
    let instruction = build_accept_protocol_authority(protocol_config, new_authority);

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
        (new_authority, system_account(1_000_000)),
    ];

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::NoPendingTransfer,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_accept_protocol_authority_current_authority_cannot_accept() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create protocol config with pending transfer to new_authority
    let protocol_config_data =
        serialize_protocol_config_with_pending(authority, new_authority, fee_wallet, bump);

    // Build instruction - current authority tries to accept (should fail)
    let instruction = build_accept_protocol_authority(protocol_config, authority);

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

    let checks = vec![Check::err(ProgramError::Custom(error_code(
        ErrorCode::Unauthorized,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_two_step_transfer_full_flow() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Step 1: Propose transfer (this is tested in test_transfer_protocol_authority.rs)
    // We simulate the result: config with pending_authority set
    let protocol_config_data =
        serialize_protocol_config_with_pending(authority, new_authority, fee_wallet, bump);

    // Step 2: Accept transfer
    let instruction = build_accept_protocol_authority(protocol_config, new_authority);

    let accounts = vec![
        (
            protocol_config,
            program_account(
                rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                protocol_config_data,
                PROGRAM_ID,
            ),
        ),
        (new_authority, system_account(1_000_000)),
    ];

    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_transfer_can_be_overwritten() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    use helpers::instructions::build_transfer_protocol_authority;

    // Setup accounts
    let authority = Pubkey::new_unique();
    let first_new_authority = Pubkey::new_unique();
    let second_new_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create protocol config with first pending transfer
    let protocol_config_data =
        serialize_protocol_config_with_pending(authority, first_new_authority, fee_wallet, bump);

    // Authority can overwrite with new pending authority
    let instruction =
        build_transfer_protocol_authority(protocol_config, authority, second_new_authority);

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
fn test_transfer_can_be_cancelled() {
    let mollusk = setup_mollusk();
    let rent = get_rent(&mollusk);

    use helpers::instructions::build_transfer_protocol_authority;

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let (protocol_config, bump) = derive_protocol_config();

    // Create protocol config with pending transfer
    let protocol_config_data =
        serialize_protocol_config_with_pending(authority, new_authority, fee_wallet, bump);

    // Cancel by setting pending to default
    let instruction =
        build_transfer_protocol_authority(protocol_config, authority, Pubkey::default());

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
