//! Compute unit benchmarks for Cascade Splits instructions
//!
//! Run with: cargo bench
//! Results written to: docs/benchmarks/cascade_splits.md
//!
//! Benchmark cases cover:
//! - Best case (1 recipient)
//! - Typical case (5 recipients)
//! - Worst case (50 recipients / MAX_RECIPIENTS)
//! - Unclaimed flow scenarios
//! - All protocol admin instructions

#[path = "../tests/helpers/mod.rs"]
mod helpers;

use {
    helpers::{
        accounts::{
            derive_ata, get_rent, mint_account, program_account, program_data_account,
            system_account, token_account, uninitialized_account,
        },
        instructions::{
            build_accept_protocol_authority, build_close_split_config, build_create_split_config,
            build_execute_split, build_initialize_protocol, build_transfer_protocol_authority,
            build_update_protocol_config, build_update_split_config, derive_program_data,
            derive_protocol_config, derive_split_config, derive_vault, RecipientInput, PROGRAM_ID,
        },
        serialization::{
            serialize_protocol_config, serialize_protocol_config_with_pending,
            serialize_split_config, serialize_split_config_simple, RecipientData,
            PROTOCOL_CONFIG_SIZE, SPLIT_CONFIG_SIZE,
        },
        setup_mollusk_with_token,
    },
    mollusk_svm_bencher::MolluskComputeUnitBencher,
    mollusk_svm_programs_token::{associated_token, token},
    solana_sdk::{account::Account, pubkey::Pubkey, system_program},
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
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &recipients,
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
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (
                vault,
                token_account(mint, split_config, vault_amount, &rent),
            ),
            (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
            (
                protocol_config,
                program_account(
                    rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                    protocol_config_data,
                    PROGRAM_ID,
                ),
            ),
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
            RecipientData {
                address: recipient1,
                percentage_bps: 3000,
            },
            RecipientData {
                address: recipient2,
                percentage_bps: 2500,
            },
            RecipientData {
                address: recipient3,
                percentage_bps: 2000,
            },
            RecipientData {
                address: recipient4,
                percentage_bps: 1500,
            },
            RecipientData {
                address: recipient5,
                percentage_bps: 900,
            },
        ];

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
        let split_config_data = serialize_split_config_simple(
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &recipients,
        );

        let instruction = build_execute_split(
            split_config,
            vault,
            mint,
            protocol_config,
            executor,
            &[
                recipient1_ata,
                recipient2_ata,
                recipient3_ata,
                recipient4_ata,
                recipient5_ata,
            ],
            protocol_ata,
        );

        let vault_amount = 10_000_000u64;

        let accounts = vec![
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (
                vault,
                token_account(mint, split_config, vault_amount, &rent),
            ),
            (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
            (
                protocol_config,
                program_account(
                    rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                    protocol_config_data,
                    PROGRAM_ID,
                ),
            ),
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
            (
                system_program::id(),
                Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
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
            RecipientInput {
                address: new_recipient1,
                percentage_bps: 5000,
            },
            RecipientInput {
                address: new_recipient2,
                percentage_bps: 4900,
            },
        ];

        let split_config_data = serialize_split_config_simple(
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &original_recipients,
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
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (vault, token_account(mint, split_config, 0, &rent)),
            (mint, mint_account(Some(authority), 6, 0, &rent)),
            (authority, system_account(1_000_000)),
            (
                spl_token::id(),
                Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
            (
                new_recipient1_ata,
                token_account(mint, new_recipient1, 0, &rent),
            ),
            (
                new_recipient2_ata,
                token_account(mint, new_recipient2, 0, &rent),
            ),
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
            &[],       // no unclaimed
            0,         // no protocol unclaimed
            0,         // no last_activity
            authority, // rent_payer
        );

        let instruction = build_close_split_config(split_config, vault, authority);

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

        let instruction =
            build_initialize_protocol(protocol_config, authority, program_data, fee_wallet);

        let accounts = vec![
            (protocol_config, uninitialized_account()),
            (authority, system_account(10_000_000_000)),
            (program_data, program_data_account(authority)),
            (fee_wallet, system_account(0)),
            (
                system_program::id(),
                Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: update_protocol_config
    // ============================================
    let (update_protocol_ix, update_protocol_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let new_fee_wallet = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);

        let instruction = build_update_protocol_config(protocol_config, authority, new_fee_wallet);

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

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: transfer_protocol_authority
    // ============================================
    let (transfer_auth_ix, transfer_auth_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let new_authority = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);

        let instruction =
            build_transfer_protocol_authority(protocol_config, authority, new_authority);

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

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: accept_protocol_authority
    // ============================================
    let (accept_auth_ix, accept_auth_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let new_authority = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();

        // Protocol config with pending authority set
        let protocol_config_data = serialize_protocol_config_with_pending(
            authority,
            new_authority,
            fee_wallet,
            protocol_bump,
        );

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

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: execute_split (20 recipients - MAX)
    // ============================================
    let (exec_max_ix, exec_max_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let executor = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();
        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

        // Generate 20 recipients (MAX_RECIPIENTS) with equal share (495 bps each = 9900 total)
        let recipient_keys: Vec<Pubkey> = (0..20).map(|_| Pubkey::new_unique()).collect();
        let recipient_atas: Vec<Pubkey> = recipient_keys
            .iter()
            .map(|r| derive_ata(r, &mint))
            .collect();
        let protocol_ata = derive_ata(&fee_wallet, &mint);

        let recipients: Vec<RecipientData> = recipient_keys
            .iter()
            .map(|&addr| RecipientData {
                address: addr,
                percentage_bps: 495,
            })
            .collect();

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
        let split_config_data = serialize_split_config_simple(
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &recipients,
        );

        let instruction = build_execute_split(
            split_config,
            vault,
            mint,
            protocol_config,
            executor,
            &recipient_atas,
            protocol_ata,
        );

        let vault_amount = 100_000_000u64;

        let mut accounts = vec![
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (
                vault,
                token_account(mint, split_config, vault_amount, &rent),
            ),
            (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
            (
                protocol_config,
                program_account(
                    rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                    protocol_config_data,
                    PROGRAM_ID,
                ),
            ),
            (executor, system_account(1_000_000)),
            token::keyed_account(),
        ];

        // Add all 20 recipient ATAs
        for (i, ata) in recipient_atas.iter().enumerate() {
            accounts.push((*ata, token_account(mint, recipient_keys[i], 0, &rent)));
        }
        accounts.push((protocol_ata, token_account(mint, fee_wallet, 0, &rent)));

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: execute_split with 1 of 2 unclaimed
    // ============================================
    let (exec_unclaimed_1_of_2_ix, exec_unclaimed_1_of_2_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let executor = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();
        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

        let recipient1 = Pubkey::new_unique();
        let recipient2 = Pubkey::new_unique();
        let recipient1_ata = derive_ata(&recipient1, &mint);
        let recipient2_ata = derive_ata(&recipient2, &mint);
        let protocol_ata = derive_ata(&fee_wallet, &mint);

        let recipients = vec![
            RecipientData {
                address: recipient1,
                percentage_bps: 5000,
            },
            RecipientData {
                address: recipient2,
                percentage_bps: 4900,
            },
        ];

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
        let split_config_data = serialize_split_config_simple(
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &recipients,
        );

        let instruction = build_execute_split(
            split_config,
            vault,
            mint,
            protocol_config,
            executor,
            &[recipient1_ata, recipient2_ata],
            protocol_ata,
        );

        let vault_amount = 1_000_000u64;

        let accounts = vec![
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (
                vault,
                token_account(mint, split_config, vault_amount, &rent),
            ),
            (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
            (
                protocol_config,
                program_account(
                    rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                    protocol_config_data,
                    PROGRAM_ID,
                ),
            ),
            (executor, system_account(1_000_000)),
            token::keyed_account(),
            (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
            // recipient2_ata is uninitialized - will cause unclaimed
            (recipient2_ata, uninitialized_account()),
            (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: execute_split with 1 of 5 unclaimed
    // ============================================
    let (exec_unclaimed_1_of_5_ix, exec_unclaimed_1_of_5_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let executor = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();
        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

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
            RecipientData {
                address: recipient1,
                percentage_bps: 3000,
            },
            RecipientData {
                address: recipient2,
                percentage_bps: 2500,
            },
            RecipientData {
                address: recipient3,
                percentage_bps: 2000,
            },
            RecipientData {
                address: recipient4,
                percentage_bps: 1500,
            },
            RecipientData {
                address: recipient5,
                percentage_bps: 900,
            },
        ];

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
        let split_config_data = serialize_split_config_simple(
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &recipients,
        );

        let instruction = build_execute_split(
            split_config,
            vault,
            mint,
            protocol_config,
            executor,
            &[
                recipient1_ata,
                recipient2_ata,
                recipient3_ata,
                recipient4_ata,
                recipient5_ata,
            ],
            protocol_ata,
        );

        let vault_amount = 10_000_000u64;

        let accounts = vec![
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (
                vault,
                token_account(mint, split_config, vault_amount, &rent),
            ),
            (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
            (
                protocol_config,
                program_account(
                    rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                    protocol_config_data,
                    PROGRAM_ID,
                ),
            ),
            (executor, system_account(1_000_000)),
            token::keyed_account(),
            (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
            (recipient2_ata, token_account(mint, recipient2, 0, &rent)),
            (recipient3_ata, token_account(mint, recipient3, 0, &rent)),
            (recipient4_ata, token_account(mint, recipient4, 0, &rent)),
            // recipient5_ata is uninitialized - 1 of 5 unclaimed
            (recipient5_ata, uninitialized_account()),
            (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: execute_split with 4 of 5 unclaimed
    // ============================================
    let (exec_unclaimed_4_of_5_ix, exec_unclaimed_4_of_5_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let executor = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();
        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

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
            RecipientData {
                address: recipient1,
                percentage_bps: 3000,
            },
            RecipientData {
                address: recipient2,
                percentage_bps: 2500,
            },
            RecipientData {
                address: recipient3,
                percentage_bps: 2000,
            },
            RecipientData {
                address: recipient4,
                percentage_bps: 1500,
            },
            RecipientData {
                address: recipient5,
                percentage_bps: 900,
            },
        ];

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
        let split_config_data = serialize_split_config_simple(
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &recipients,
        );

        let instruction = build_execute_split(
            split_config,
            vault,
            mint,
            protocol_config,
            executor,
            &[
                recipient1_ata,
                recipient2_ata,
                recipient3_ata,
                recipient4_ata,
                recipient5_ata,
            ],
            protocol_ata,
        );

        let vault_amount = 10_000_000u64;

        let accounts = vec![
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (
                vault,
                token_account(mint, split_config, vault_amount, &rent),
            ),
            (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
            (
                protocol_config,
                program_account(
                    rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                    protocol_config_data,
                    PROGRAM_ID,
                ),
            ),
            (executor, system_account(1_000_000)),
            token::keyed_account(),
            // Only recipient1 has ATA - 4 of 5 unclaimed
            (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
            (recipient2_ata, uninitialized_account()),
            (recipient3_ata, uninitialized_account()),
            (recipient4_ata, uninitialized_account()),
            (recipient5_ata, uninitialized_account()),
            (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: execute_split with 5 of 5 unclaimed (all missing)
    // ============================================
    let (exec_unclaimed_5_of_5_ix, exec_unclaimed_5_of_5_accounts) = {
        let authority = Pubkey::new_unique();
        let fee_wallet = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let executor = Pubkey::new_unique();

        let (protocol_config, protocol_bump) = derive_protocol_config();
        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

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
            RecipientData {
                address: recipient1,
                percentage_bps: 3000,
            },
            RecipientData {
                address: recipient2,
                percentage_bps: 2500,
            },
            RecipientData {
                address: recipient3,
                percentage_bps: 2000,
            },
            RecipientData {
                address: recipient4,
                percentage_bps: 1500,
            },
            RecipientData {
                address: recipient5,
                percentage_bps: 900,
            },
        ];

        let protocol_config_data = serialize_protocol_config(authority, fee_wallet, protocol_bump);
        let split_config_data = serialize_split_config_simple(
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &recipients,
        );

        let instruction = build_execute_split(
            split_config,
            vault,
            mint,
            protocol_config,
            executor,
            &[
                recipient1_ata,
                recipient2_ata,
                recipient3_ata,
                recipient4_ata,
                recipient5_ata,
            ],
            protocol_ata,
        );

        let vault_amount = 10_000_000u64;

        let accounts = vec![
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (
                vault,
                token_account(mint, split_config, vault_amount, &rent),
            ),
            (mint, mint_account(Some(authority), 6, vault_amount, &rent)),
            (
                protocol_config,
                program_account(
                    rent.minimum_balance(PROTOCOL_CONFIG_SIZE),
                    protocol_config_data,
                    PROGRAM_ID,
                ),
            ),
            (executor, system_account(1_000_000)),
            token::keyed_account(),
            // All 5 recipients have uninitialized ATAs
            (recipient1_ata, uninitialized_account()),
            (recipient2_ata, uninitialized_account()),
            (recipient3_ata, uninitialized_account()),
            (recipient4_ata, uninitialized_account()),
            (recipient5_ata, uninitialized_account()),
            (protocol_ata, token_account(mint, fee_wallet, 0, &rent)),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: create_split_config (5 recipients)
    // ============================================
    let (create_multi_ix, create_multi_accounts) = {
        let authority = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();

        let (split_config, _split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

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

        let recipients = vec![
            RecipientInput {
                address: recipient1,
                percentage_bps: 3000,
            },
            RecipientInput {
                address: recipient2,
                percentage_bps: 2500,
            },
            RecipientInput {
                address: recipient3,
                percentage_bps: 2000,
            },
            RecipientInput {
                address: recipient4,
                percentage_bps: 1500,
            },
            RecipientInput {
                address: recipient5,
                percentage_bps: 900,
            },
        ];

        let instruction = build_create_split_config(
            split_config,
            vault,
            authority,
            unique_id,
            mint,
            &recipients,
            &[
                recipient1_ata,
                recipient2_ata,
                recipient3_ata,
                recipient4_ata,
                recipient5_ata,
            ],
        );

        let accounts = vec![
            (split_config, uninitialized_account()),
            (unique_id, system_account(0)),
            (authority, system_account(10_000_000_000)),
            (mint, mint_account(Some(authority), 6, 0, &rent)),
            (vault, uninitialized_account()),
            token::keyed_account(),
            associated_token::keyed_account(),
            (
                system_program::id(),
                Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
            (recipient1_ata, token_account(mint, recipient1, 0, &rent)),
            (recipient2_ata, token_account(mint, recipient2, 0, &rent)),
            (recipient3_ata, token_account(mint, recipient3, 0, &rent)),
            (recipient4_ata, token_account(mint, recipient4, 0, &rent)),
            (recipient5_ata, token_account(mint, recipient5, 0, &rent)),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: update_split_config to 10 recipients
    // ============================================
    let (update_multi_ix, update_multi_accounts) = {
        let authority = Pubkey::new_unique();
        let unique_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();

        let (split_config, split_bump) = derive_split_config(&authority, &mint, &unique_id);
        let vault = derive_vault(&split_config, &mint);

        let original_recipient = Pubkey::new_unique();
        let original_recipients = vec![RecipientData {
            address: original_recipient,
            percentage_bps: 9900,
        }];

        // Update to 10 new recipients
        let new_recipient_keys: Vec<Pubkey> = (0..10).map(|_| Pubkey::new_unique()).collect();
        let new_recipient_atas: Vec<Pubkey> = new_recipient_keys
            .iter()
            .map(|r| derive_ata(r, &mint))
            .collect();

        let new_recipients: Vec<RecipientInput> = new_recipient_keys
            .iter()
            .map(|&addr| RecipientInput {
                address: addr,
                percentage_bps: 990,
            })
            .collect();

        let split_config_data = serialize_split_config_simple(
            authority,
            mint,
            vault,
            unique_id,
            split_bump,
            &original_recipients,
        );

        let instruction = build_update_split_config(
            split_config,
            vault,
            authority,
            mint,
            &new_recipients,
            &new_recipient_atas,
        );

        let mut accounts = vec![
            (
                split_config,
                program_account(
                    rent.minimum_balance(SPLIT_CONFIG_SIZE),
                    split_config_data,
                    PROGRAM_ID,
                ),
            ),
            (vault, token_account(mint, split_config, 0, &rent)),
            (mint, mint_account(Some(authority), 6, 0, &rent)),
            (authority, system_account(1_000_000)),
            (
                spl_token::id(),
                Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
        ];

        for (i, ata) in new_recipient_atas.iter().enumerate() {
            accounts.push((*ata, token_account(mint, new_recipient_keys[i], 0, &rent)));
        }

        (instruction, accounts)
    };

    // Output directory relative to workspace root
    let out_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // programs/
        .unwrap()
        .parent() // workspace root
        .unwrap()
        .join("docs/benchmarks");

    // Run all benchmarks
    MolluskComputeUnitBencher::new(mollusk)
        // Protocol admin instructions
        .bench(("initialize_protocol", &init_ix, &init_accounts))
        .bench((
            "update_protocol_config",
            &update_protocol_ix,
            &update_protocol_accounts,
        ))
        .bench((
            "transfer_protocol_authority",
            &transfer_auth_ix,
            &transfer_auth_accounts,
        ))
        .bench((
            "accept_protocol_authority",
            &accept_auth_ix,
            &accept_auth_accounts,
        ))
        // Split config lifecycle
        .bench((
            "create_split_config_1_recipient",
            &create_ix,
            &create_accounts,
        ))
        .bench((
            "create_split_config_5_recipients",
            &create_multi_ix,
            &create_multi_accounts,
        ))
        .bench(("update_split_config_to_2", &update_ix, &update_accounts))
        .bench((
            "update_split_config_to_10",
            &update_multi_ix,
            &update_multi_accounts,
        ))
        .bench(("close_split_config", &close_ix, &close_accounts))
        // Execute split - scaling tests
        .bench((
            "execute_split_1_recipient",
            &exec_single_ix,
            &exec_single_accounts,
        ))
        .bench((
            "execute_split_5_recipients",
            &exec_multi_ix,
            &exec_multi_accounts,
        ))
        .bench((
            "execute_split_20_recipients",
            &exec_max_ix,
            &exec_max_accounts,
        ))
        // Execute split - unclaimed scenarios
        .bench((
            "execute_split_unclaimed_1_of_2",
            &exec_unclaimed_1_of_2_ix,
            &exec_unclaimed_1_of_2_accounts,
        ))
        .bench((
            "execute_split_unclaimed_1_of_5",
            &exec_unclaimed_1_of_5_ix,
            &exec_unclaimed_1_of_5_accounts,
        ))
        .bench((
            "execute_split_unclaimed_4_of_5",
            &exec_unclaimed_4_of_5_ix,
            &exec_unclaimed_4_of_5_accounts,
        ))
        .bench((
            "execute_split_unclaimed_5_of_5",
            &exec_unclaimed_5_of_5_ix,
            &exec_unclaimed_5_of_5_accounts,
        ))
        .must_pass(true)
        .out_dir(out_dir.to_str().unwrap())
        .execute();
}
