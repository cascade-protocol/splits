//! Instruction builders for Mollusk tests
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! All imports from solana_sdk::*, not modular crates

use {
    solana_sdk::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        system_program,
    },
    spl_associated_token_account,
};

/// Program ID - must match lib.rs
pub const PROGRAM_ID: Pubkey = solana_sdk::pubkey!("SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB");

// Anchor discriminators (first 8 bytes of sha256("global:function_name"))
// These must match the IDL/program
pub const DISCRIMINATOR_INITIALIZE_PROTOCOL: [u8; 8] = [0xbc, 0xe9, 0xfc, 0x6a, 0x86, 0x92, 0xca, 0x5b];
pub const DISCRIMINATOR_UPDATE_PROTOCOL_CONFIG: [u8; 8] = [0xc5, 0x61, 0x7b, 0x36, 0xdd, 0xa8, 0x0b, 0x87];
pub const DISCRIMINATOR_TRANSFER_PROTOCOL_AUTHORITY: [u8; 8] = [0x23, 0x4c, 0x24, 0x4d, 0x88, 0x70, 0x9e, 0xde];
pub const DISCRIMINATOR_ACCEPT_PROTOCOL_AUTHORITY: [u8; 8] = [0xed, 0x7a, 0x06, 0x27, 0x35, 0xca, 0x8d, 0x71];
pub const DISCRIMINATOR_CREATE_SPLIT_CONFIG: [u8; 8] = [0x80, 0x2a, 0x3c, 0x6a, 0x04, 0xe9, 0x12, 0xbe];
pub const DISCRIMINATOR_EXECUTE_SPLIT: [u8; 8] = [0x06, 0x2d, 0xab, 0x28, 0x31, 0x81, 0x17, 0x59];
pub const DISCRIMINATOR_UPDATE_SPLIT_CONFIG: [u8; 8] = [0x2f, 0x67, 0x4a, 0xaa, 0x37, 0xfb, 0x82, 0x92];
pub const DISCRIMINATOR_CLOSE_SPLIT_CONFIG: [u8; 8] = [0xaa, 0xca, 0xfc, 0x5c, 0xc4, 0xa0, 0xf7, 0xe5];

/// Recipient input for instructions
#[derive(Clone, Debug)]
pub struct RecipientInput {
    pub address: Pubkey,
    pub percentage_bps: u16,
}

/// Derive protocol config PDA
pub fn derive_protocol_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"protocol_config"], &PROGRAM_ID)
}

/// Derive split config PDA
pub fn derive_split_config(authority: &Pubkey, mint: &Pubkey, unique_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"split_config",
            authority.as_ref(),
            mint.as_ref(),
            unique_id.as_ref(),
        ],
        &PROGRAM_ID,
    )
}

/// Derive vault address (ATA owned by split_config)
///
/// The vault is an Associated Token Account with split_config as the authority,
/// NOT a custom PDA. This matches the CreateSplitConfig context:
/// `associated_token::authority = split_config`
pub fn derive_vault(split_config: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address(split_config, mint)
}

/// Derive program data PDA for BPF upgradeable loader
pub fn derive_program_data() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PROGRAM_ID.as_ref()],
        &solana_sdk::bpf_loader_upgradeable::id(),
    )
}

// Instruction discriminators (Anchor uses first 8 bytes of sha256("global:function_name"))
// We need to serialize these manually for Mollusk tests

/// Build initialize_protocol instruction
///
/// Accounts:
/// 0. protocol_config (writable) - PDA to initialize
/// 1. authority (writable, signer) - Must be upgrade authority
/// 2. program_data - BPF loader program data
/// 3. system_program
pub fn build_initialize_protocol(
    protocol_config: Pubkey,
    authority: Pubkey,
    program_data: Pubkey,
    fee_wallet: Pubkey,
) -> Instruction {
    let discriminator = DISCRIMINATOR_INITIALIZE_PROTOCOL;

    let mut data = Vec::with_capacity(8 + 32);
    data.extend_from_slice(&discriminator);
    data.extend_from_slice(&fee_wallet.to_bytes());

    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(protocol_config, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(program_data, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Build update_protocol_config instruction
///
/// Accounts:
/// 0. protocol_config (writable)
/// 1. authority (signer)
pub fn build_update_protocol_config(
    protocol_config: Pubkey,
    authority: Pubkey,
    new_fee_wallet: Pubkey,
) -> Instruction {
    let discriminator = DISCRIMINATOR_UPDATE_PROTOCOL_CONFIG;

    let mut data = Vec::with_capacity(8 + 32);
    data.extend_from_slice(&discriminator);
    data.extend_from_slice(&new_fee_wallet.to_bytes());

    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(protocol_config, false),
            AccountMeta::new_readonly(authority, true),
        ],
        data,
    }
}

/// Build transfer_protocol_authority instruction
///
/// Accounts:
/// 0. protocol_config (writable)
/// 1. authority (signer)
pub fn build_transfer_protocol_authority(
    protocol_config: Pubkey,
    authority: Pubkey,
    new_authority: Pubkey,
) -> Instruction {
    let discriminator = DISCRIMINATOR_TRANSFER_PROTOCOL_AUTHORITY;

    let mut data = Vec::with_capacity(8 + 32);
    data.extend_from_slice(&discriminator);
    data.extend_from_slice(&new_authority.to_bytes());

    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(protocol_config, false),
            AccountMeta::new_readonly(authority, true),
        ],
        data,
    }
}

/// Build accept_protocol_authority instruction
///
/// Accounts:
/// 0. protocol_config (writable)
/// 1. new_authority (signer)
pub fn build_accept_protocol_authority(
    protocol_config: Pubkey,
    new_authority: Pubkey,
) -> Instruction {
    let discriminator = DISCRIMINATOR_ACCEPT_PROTOCOL_AUTHORITY;

    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(protocol_config, false),
            AccountMeta::new_readonly(new_authority, true),
        ],
        data: discriminator.to_vec(),
    }
}

/// Build create_split_config instruction
///
/// Accounts (matching CreateSplitConfig context order):
/// 0. split_config (writable) - init
/// 1. unique_id (readonly)
/// 2. authority (writable, signer)
/// 3. mint_account (readonly)
/// 4. vault (writable) - init
/// 5. token_program (readonly)
/// 6. associated_token_program (readonly)
/// 7. system_program (readonly)
/// remaining_accounts: recipient ATAs for validation
pub fn build_create_split_config(
    split_config: Pubkey,
    vault: Pubkey,
    authority: Pubkey,
    unique_id: Pubkey,
    mint: Pubkey,
    recipients: &[RecipientInput],
    recipient_atas: &[Pubkey],
) -> Instruction {
    let discriminator = DISCRIMINATOR_CREATE_SPLIT_CONFIG;

    // Serialize instruction data
    let mut data = Vec::new();
    data.extend_from_slice(&discriminator);

    // Mint pubkey
    data.extend_from_slice(&mint.to_bytes());

    // Recipients vector: 4-byte length prefix + each recipient
    data.extend_from_slice(&(recipients.len() as u32).to_le_bytes());
    for recipient in recipients {
        data.extend_from_slice(&recipient.address.to_bytes());
        data.extend_from_slice(&recipient.percentage_bps.to_le_bytes());
    }

    // Build accounts - order must match CreateSplitConfig context
    let mut accounts = vec![
        AccountMeta::new(split_config, false),
        AccountMeta::new_readonly(unique_id, false),
        AccountMeta::new(authority, true),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(spl_token::id(), false),
        AccountMeta::new_readonly(spl_associated_token_account::id(), false),
        AccountMeta::new_readonly(system_program::id(), false),
    ];

    // Add recipient ATAs as remaining_accounts
    for ata in recipient_atas {
        accounts.push(AccountMeta::new_readonly(*ata, false));
    }

    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data,
    }
}

/// Build execute_split instruction
///
/// Accounts:
/// 0. split_config (writable)
/// 1. vault (writable)
/// 2. mint
/// 3. protocol_config
/// 4. executor
/// 5. token_program
/// remaining_accounts: recipient ATAs (in order) + protocol_ata (last)
pub fn build_execute_split(
    split_config: Pubkey,
    vault: Pubkey,
    mint: Pubkey,
    protocol_config: Pubkey,
    executor: Pubkey,
    recipient_atas: &[Pubkey],
    protocol_ata: Pubkey,
) -> Instruction {
    let discriminator = DISCRIMINATOR_EXECUTE_SPLIT;

    let mut accounts = vec![
        AccountMeta::new(split_config, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new_readonly(protocol_config, false),
        AccountMeta::new_readonly(executor, false),
        AccountMeta::new_readonly(spl_token::id(), false),
    ];

    // Add recipient ATAs as remaining_accounts
    for ata in recipient_atas {
        accounts.push(AccountMeta::new(*ata, false));
    }

    // Protocol ATA is last
    accounts.push(AccountMeta::new(protocol_ata, false));

    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: discriminator.to_vec(),
    }
}

/// Build update_split_config instruction
///
/// Accounts (matching UpdateSplitConfig context order):
/// 0. split_config (writable)
/// 1. vault (readonly)
/// 2. mint (readonly)
/// 3. authority (signer)
/// 4. token_program (readonly)
/// remaining_accounts: new recipient ATAs
pub fn build_update_split_config(
    split_config: Pubkey,
    vault: Pubkey,
    authority: Pubkey,
    mint: Pubkey,
    new_recipients: &[RecipientInput],
    recipient_atas: &[Pubkey],
) -> Instruction {
    let discriminator = DISCRIMINATOR_UPDATE_SPLIT_CONFIG;

    // Serialize instruction data
    let mut data = Vec::new();
    data.extend_from_slice(&discriminator);

    // Recipients vector: 4-byte length prefix + each recipient
    data.extend_from_slice(&(new_recipients.len() as u32).to_le_bytes());
    for recipient in new_recipients {
        data.extend_from_slice(&recipient.address.to_bytes());
        data.extend_from_slice(&recipient.percentage_bps.to_le_bytes());
    }

    // Build accounts - order must match UpdateSplitConfig context
    let mut accounts = vec![
        AccountMeta::new(split_config, false),
        AccountMeta::new_readonly(vault, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new_readonly(authority, true),
        AccountMeta::new_readonly(spl_token::id(), false),
    ];

    // Add recipient ATAs as remaining_accounts
    for ata in recipient_atas {
        accounts.push(AccountMeta::new_readonly(*ata, false));
    }

    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data,
    }
}

/// Build close_split_config instruction
///
/// Accounts:
/// 0. split_config (writable)
/// 1. vault (writable)
/// 2. authority (writable, signer)
/// 3. token_program
pub fn build_close_split_config(
    split_config: Pubkey,
    vault: Pubkey,
    authority: Pubkey,
) -> Instruction {
    let discriminator = DISCRIMINATOR_CLOSE_SPLIT_CONFIG;

    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(split_config, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: discriminator.to_vec(),
    }
}
