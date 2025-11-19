//! Tests for close_split_config instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use {
    helpers::{
        accounts::{get_rent, mint_account, program_account, system_account, token_account},
        instructions::{
            build_close_split_config, derive_protocol_config, derive_split_config, derive_vault,
            PROGRAM_ID,
        },
        serialization::{
            serialize_protocol_config, serialize_split_config, RecipientData, UnclaimedAmountData,
            PROTOCOL_CONFIG_SIZE, SPLIT_CONFIG_SIZE,
        },
        setup_mollusk_with_token,
    },
    mollusk_svm::result::Check,
    // 0.5.1: All imports from solana_sdk
    solana_sdk::{
        account::Account,
        program_error::ProgramError,
        pubkey::Pubkey,
    },
};

#[test]
fn test_close_split_config_success() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient
    let recipient1 = Pubkey::new_unique();
    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data - no unclaimed amounts
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data = serialize_split_config(
        1, // version
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        &[], // no unclaimed
        0,   // no protocol unclaimed
    );

    // Build instruction
    let instruction = build_close_split_config(split_config, vault, authority);

    // Setup account states - vault is empty
    let accounts = vec![
        (split_config, program_account(
            rent.minimum_balance(SPLIT_CONFIG_SIZE),
            split_config_data,
            PROGRAM_ID,
        )),
        // Vault with 0 tokens
        (vault, token_account(mint, split_config, 0, &rent)),
        // Authority - receives rent
        (authority, system_account(1_000_000)),
        // Token program
        (spl_token::id(), Account {
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
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_vault_not_empty_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient
    let recipient1 = Pubkey::new_unique();
    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
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
    );

    // Build instruction
    let instruction = build_close_split_config(split_config, vault, authority);

    // Setup account states - vault has tokens
    let accounts = vec![
        (split_config, program_account(
            rent.minimum_balance(SPLIT_CONFIG_SIZE),
            split_config_data,
            PROGRAM_ID,
        )),
        // Vault with tokens - should fail
        (vault, token_account(mint, split_config, 1_000_000, &rent)),
        (authority, system_account(1_000_000)),
        (spl_token::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
    ];

    // Should fail with VaultNotEmpty
    let checks = vec![
        Check::err(ProgramError::Custom(6009)), // ErrorCode::VaultNotEmpty
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_unclaimed_not_empty_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
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
        amount: 100_000, // Has unclaimed!
        timestamp: 1234567890,
    }];

    // Create account data with unclaimed
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
    let split_config_data = serialize_split_config(
        1,
        authority,
        mint,
        vault,
        unique_id,
        split_bump,
        &recipients,
        &unclaimed, // Has unclaimed!
        0,
    );

    // Build instruction
    let instruction = build_close_split_config(split_config, vault, authority);

    // Setup account states - vault is empty but has unclaimed
    let accounts = vec![
        (split_config, program_account(
            rent.minimum_balance(SPLIT_CONFIG_SIZE),
            split_config_data,
            PROGRAM_ID,
        )),
        (vault, token_account(mint, split_config, 0, &rent)),
        (authority, system_account(1_000_000)),
        (spl_token::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
    ];

    // Should fail with UnclaimedNotEmpty
    let checks = vec![
        Check::err(ProgramError::Custom(6017)), // ErrorCode::UnclaimedNotEmpty
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_close_split_config_wrong_authority_fails() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // Setup accounts
    let authority = Pubkey::new_unique();
    let wrong_authority = Pubkey::new_unique();
    let fee_wallet = Pubkey::new_unique();
    let unique_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    // Derive PDAs
    let (protocol_config, protocol_bump) = derive_protocol_config();
    let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
    let vault = derive_vault(&split_config, &mint);

    // Recipient
    let recipient1 = Pubkey::new_unique();
    let recipients = vec![RecipientData {
        address: recipient1,
        percentage_bps: 9900,
    }];

    // Create account data
    let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
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
    );

    // Build instruction with wrong authority
    let instruction = build_close_split_config(split_config, vault, wrong_authority);

    // Setup account states
    let accounts = vec![
        (split_config, program_account(
            rent.minimum_balance(SPLIT_CONFIG_SIZE),
            split_config_data,
            PROGRAM_ID,
        )),
        (vault, token_account(mint, split_config, 0, &rent)),
        // Wrong authority
        (wrong_authority, system_account(1_000_000)),
        (spl_token::id(), Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        }),
    ];

    // Should fail with Unauthorized
    let checks = vec![
        Check::err(ProgramError::Custom(6015)), // ErrorCode::Unauthorized
    ];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
