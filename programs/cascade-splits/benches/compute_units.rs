//! Compute unit benchmarks for Cascade Splits instructions
//!
//! Run with: cargo bench
//! Results written to: target/benches/cascade_splits.md

#[path = "../tests/helpers/mod.rs"]
mod helpers;

use {
    helpers::{
        accounts::{derive_ata, get_rent, mint_account, program_account, program_data_account, system_account, token_account, uninitialized_account},
        instructions::{
            build_create_split_config, build_execute_split, build_update_split_config,
            build_close_split_config, build_initialize_protocol, derive_program_data, derive_protocol_config,
            derive_split_config, derive_vault, RecipientInput, PROGRAM_ID,
        },
        serialization::{
            serialize_protocol_config, serialize_split_config, serialize_split_config_simple,
            RecipientData, PROTOCOL_CONFIG_SIZE, SPLIT_CONFIG_SIZE,
        },
        setup_mollusk_with_token,
    },
    mollusk_svm_bencher::MolluskComputeUnitBencher,
    mollusk_svm_programs_token::{associated_token, token},
    solana_sdk::{
        account::Account,
        pubkey::Pubkey,
        system_program,
    },
};

fn main() {
    let mollusk = setup_mollusk_with_token();
    let rent = get_rent(&mollusk);

    // ============================================
    // Benchmark: execute_split (single recipient)
    // ============================================
    let (exec_single_ix, exec_single_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let executor = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();
        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

        let recipient1 = Pubkey::new_unique();
        let recipient1_ata = derive_ata(&recipient1, &mint);
        let protocol_ata = derive_ata(&fee_wallet, &mint);

        let recipients = vec![RecipientData {
            address: recipient1,
            percentage_bps: 9900,
        }];

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
        let split_config_data = serialize_split_config_simple(
            authority, mint, vault, unique_id, split_bump, &recipients,
        );

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
            token::keyed_account(),
            (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
            (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: execute_split (5 recipients)
    // ============================================
    let (exec_multi_ix, exec_multi_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let executor = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();
        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

        // 5 recipients with varying percentages
        let recipient1 = Pubkey::new_unique();
        let recipient2 = Pubkey::new_unique();
        let recipient3 = Pubkey::new_unique();
        let recipient4 = Pubkey::new_unique();
        let recipient5 = Pubkey::new_unique();

        let recipient1_ata = derive_ata(&recipient1, &mint);
        let recipient2_ata = derive_ata(&recipient2, &mint);
        let recipient3_ata = derive_ata(&recipient3, &mint);
        let recipient4_ata = derive_ata(&recipient4, &mint);
        let recipient5_ata = derive_ata(&recipient5, &mint);
        let protocol_ata = derive_ata(&fee_wallet, &mint);

        let recipients = vec![
            RecipientData { address: recipient1, percentage_bps: 3000 },
            RecipientData { address: recipient2, percentage_bps: 2500 },
            RecipientData { address: recipient3, percentage_bps: 2000 },
            RecipientData { address: recipient4, percentage_bps: 1500 },
            RecipientData { address: recipient5, percentage_bps: 900 },
        ];

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
        let split_config_data = serialize_split_config_simple(
            authority, mint, vault, unique_id, split_bump, &recipients,
        );

        let instruction = build_execute_split(
            split_config,
            vault,
            mint,
            protocol_config,
            executor,
            &[recipient1_ata, recipient2_ata, recipient3_ata, recipient4_ata, recipient5_ata],
            protocol_ata,
        );

        let vault_amount = 10_000_000u64;

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
            token::keyed_account(),
            (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
            (recipient2_ata, token_account(mint, recipient2, 0, &rent)),
            (recipient3_ata, token_account(mint, recipient3, 0, &rent)),
            (recipient4_ata, token_account(mint, recipient4, 0, &rent)),
            (recipient5_ata, token_account(mint, recipient5, 0, &rent)),
            (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: create_split_config
    // ============================================
    let (create_ix, create_accounts) = {
        let authority = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();

        let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

        let recipient1 = Pubkey::new_unique();
        let recipient1_ata = derive_ata(&recipient1, &mint);

        let recipients = vec![RecipientInput {
            address: recipient1,
            percentage_bps: 9900,
        }];

        let instruction = build_create_split_config(
            split_config,
            vault,
            authority,
            unique_id,
            mint,
            &recipients,
            &[recipient1_ata],
        );

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

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: update_split_config
    // ============================================
    let (update_ix, update_accounts) = {
        let authority = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();

        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

        let recipient1 = Pubkey::new_unique();
        let original_recipients = vec![RecipientData {
            address: recipient1,
            percentage_bps: 9900,
        }];

        let new_recipient1 = Pubkey::new_unique();
        let new_recipient2 = Pubkey::new_unique();
        let new_recipient1_ata = derive_ata(&new_recipient1, &mint);
        let new_recipient2_ata = derive_ata(&new_recipient2, &mint);

        let new_recipients = vec![
            RecipientInput { address: new_recipient1, percentage_bps: 5000 },
            RecipientInput { address: new_recipient2, percentage_bps: 4900 },
        ];

        let split_config_data = serialize_split_config_simple(
            authority, mint, vault, unique_id, split_bump, &original_recipients,
        );

        let instruction = build_update_split_config(
            split_config,
            vault,
            authority,
            mint,
            &new_recipients,
            &[new_recipient1_ata, new_recipient2_ata],
        );

        let accounts = vec![
            (split_config, program_account(
                rent.minimum_balance(SPLIT_CONFIG_SIZE),
                split_config_data,
                PROGRAM_ID,
            )),
            (vault, token_account(mint, split_config, 0, &rent)),
            (mint, mint_account(Some(authority), 6, 0, &rent)),
            (authority, system_account(1_000_000)),
            (spl_token::id(), Account {
                lamports: 1,
                data: vec![],
                owner: solana_sdk::native_loader::id(),
                executable: true,
                rent_epoch: 0,
            }),
            (new_recipient1_ata, token_account(mint, new_recipient1, 0, &rent)),
            (new_recipient2_ata, token_account(mint, new_recipient2, 0, &rent)),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: close_split_config
    // ============================================
    let (close_ix, close_accounts) = {
        let authority = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();

        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

        let recipient1 = Pubkey::new_unique();
        let recipients = vec![RecipientData {
            address: recipient1,
            percentage_bps: 9900,
        }];

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

        let instruction = build_close_split_config(split_config, vault, authority);

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

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: initialize_protocol
    // ============================================
    let (init_ix, init_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();

        let (protocol_config, _bump) = derive_protocol_config();
        let (program_data, _) = derive_program_data();

        let instruction = build_initialize_protocol(protocol_config, authority, program_data, fee_wallet);

        let accounts = vec![
            (protocol_config, uninitialized_account()),
            (authority, system_account(10_000_000_000)),
            (program_data, program_data_account(authority)),
            (fee_wallet, system_account(0)),
            (system_program::id(), Account {
                lamports: 1,
                data: vec![],
                owner: solana_sdk::native_loader::id(),
                executable: true,
                rent_epoch: 0,
            }),
        ];

        (instruction, accounts)
    };

    // Output directory relative to workspace root
    let out_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // programs/
        .unwrap()
        .parent() // workspace root
        .unwrap()
        .join("target/benches");

    // Run all benchmarks
    MolluskComputeUnitBencher::new(mollusk)
        .bench(("execute_split_1_recipient", &exec_single_ix, &exec_single_accounts))
        .bench(("execute_split_5_recipients", &exec_multi_ix, &exec_multi_accounts))
        .bench(("create_split_config", &create_ix, &create_accounts))
        .bench(("update_split_config", &update_ix, &update_accounts))
        .bench(("close_split_config", &close_ix, &close_accounts))
        .bench(("initialize_protocol", &init_ix, &init_accounts))
        .must_pass(true)
        .out_dir(out_dir.to_str().unwrap())
        .execute();
}
