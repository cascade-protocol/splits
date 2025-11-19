//! Serialization helpers for zero-copy Anchor structs
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! Zero-copy structs use raw bytes with 8-byte Anchor discriminator prefix
//! Layout must match #[repr(C)] struct definitions exactly

use solana_sdk::pubkey::Pubkey;

// Constants matching the program
pub const MAX_RECIPIENTS: usize = 20;
pub const PROTOCOL_CONFIG_SIZE: usize = 8 + 32 + 32 + 1; // 73 bytes
// SplitConfig actual size with #[repr(C)] alignment padding:
// After recipients array (offset 819), 5 bytes padding for 8-byte alignment of unclaimed_amounts
pub const SPLIT_CONFIG_SIZE: usize = 1792;

// Anchor discriminators (from IDL)
pub const PROTOCOL_CONFIG_DISCRIMINATOR: [u8; 8] = [0xcf, 0x5b, 0xfa, 0x1c, 0x98, 0xb3, 0xd7, 0xd1];
pub const SPLIT_CONFIG_DISCRIMINATOR: [u8; 8] = [0x31, 0xc9, 0x32, 0xe4, 0x16, 0x8e, 0x0c, 0xde];

/// Recipient data for serialization
#[derive(Clone, Copy, Debug)]
pub struct RecipientData {
    pub address: Pubkey,
    pub percentage_bps: u16,
}

impl Default for RecipientData {
    fn default() -> Self {
        Self {
            address: Pubkey::default(),
            percentage_bps: 0,
        }
    }
}

/// Unclaimed amount data for serialization
#[derive(Clone, Copy, Debug)]
pub struct UnclaimedAmountData {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

impl Default for UnclaimedAmountData {
    fn default() -> Self {
        Self {
            recipient: Pubkey::default(),
            amount: 0,
            timestamp: 0,
        }
    }
}

/// Serialize ProtocolConfig for test account data
///
/// Layout (zero-copy #[repr(C)]):
/// - 8 bytes: discriminator
/// - 32 bytes: authority
/// - 32 bytes: fee_wallet
/// - 1 byte: bump
pub fn serialize_protocol_config(
    authority: Pubkey,
    fee_wallet: Pubkey,
    bump: u8,
) -> Vec<u8> {
    let mut data = vec![0u8; PROTOCOL_CONFIG_SIZE];

    // Discriminator
    data[0..8].copy_from_slice(&PROTOCOL_CONFIG_DISCRIMINATOR);

    // Authority
    data[8..40].copy_from_slice(&authority.to_bytes());

    // Fee wallet
    data[40..72].copy_from_slice(&fee_wallet.to_bytes());

    // Bump
    data[72] = bump;

    data
}

/// Serialize SplitConfig for test account data
///
/// Layout (zero-copy #[repr(C)]):
/// - 8 bytes: discriminator
/// - 1 byte: version
/// - 32 bytes: authority
/// - 32 bytes: mint
/// - 32 bytes: vault
/// - 32 bytes: unique_id
/// - 1 byte: bump
/// - 1 byte: recipient_count
/// - 680 bytes: recipients [Recipient; 20] = (32 + 2) * 20
/// - 960 bytes: unclaimed_amounts [UnclaimedAmount; 20] = (32 + 8 + 8) * 20
/// - 8 bytes: protocol_unclaimed
pub fn serialize_split_config(
    version: u8,
    authority: Pubkey,
    mint: Pubkey,
    vault: Pubkey,
    unique_id: Pubkey,
    bump: u8,
    recipients: &[RecipientData],
    unclaimed_amounts: &[UnclaimedAmountData],
    protocol_unclaimed: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; SPLIT_CONFIG_SIZE];
    let mut offset = 0;

    // Discriminator
    data[offset..offset + 8].copy_from_slice(&SPLIT_CONFIG_DISCRIMINATOR);
    offset += 8;

    // Version
    data[offset] = version;
    offset += 1;

    // Authority
    data[offset..offset + 32].copy_from_slice(&authority.to_bytes());
    offset += 32;

    // Mint
    data[offset..offset + 32].copy_from_slice(&mint.to_bytes());
    offset += 32;

    // Vault
    data[offset..offset + 32].copy_from_slice(&vault.to_bytes());
    offset += 32;

    // Unique ID
    data[offset..offset + 32].copy_from_slice(&unique_id.to_bytes());
    offset += 32;

    // Bump
    data[offset] = bump;
    offset += 1;

    // Recipient count
    data[offset] = recipients.len() as u8;
    offset += 1;

    // Padding for 2-byte alignment of recipients array (1 byte)
    // offset is now 139, need to align to 140 for Recipient's u16 field
    offset += 1;

    // Recipients array [Recipient; 20]
    for i in 0..MAX_RECIPIENTS {
        let recipient = if i < recipients.len() {
            recipients[i]
        } else {
            RecipientData::default()
        };

        // Address (32 bytes)
        data[offset..offset + 32].copy_from_slice(&recipient.address.to_bytes());
        offset += 32;

        // Percentage BPS (2 bytes, little-endian)
        data[offset..offset + 2].copy_from_slice(&recipient.percentage_bps.to_le_bytes());
        offset += 2;
    }

    // Padding for 8-byte alignment of unclaimed_amounts array (4 bytes)
    // offset is now 820, need to align to 824
    offset += 4;

    // Unclaimed amounts array [UnclaimedAmount; 20]
    for i in 0..MAX_RECIPIENTS {
        let unclaimed = if i < unclaimed_amounts.len() {
            unclaimed_amounts[i]
        } else {
            UnclaimedAmountData::default()
        };

        // Recipient (32 bytes)
        data[offset..offset + 32].copy_from_slice(&unclaimed.recipient.to_bytes());
        offset += 32;

        // Amount (8 bytes, little-endian)
        data[offset..offset + 8].copy_from_slice(&unclaimed.amount.to_le_bytes());
        offset += 8;

        // Timestamp (8 bytes, little-endian)
        data[offset..offset + 8].copy_from_slice(&unclaimed.timestamp.to_le_bytes());
        offset += 8;
    }

    // Protocol unclaimed (8 bytes, little-endian)
    data[offset..offset + 8].copy_from_slice(&protocol_unclaimed.to_le_bytes());

    data
}

/// Helper to create a simple split config with default unclaimed
pub fn serialize_split_config_simple(
    authority: Pubkey,
    mint: Pubkey,
    vault: Pubkey,
    unique_id: Pubkey,
    bump: u8,
    recipients: &[RecipientData],
) -> Vec<u8> {
    serialize_split_config(
        1, // version
        authority,
        mint,
        vault,
        unique_id,
        bump,
        recipients,
        &[], // no unclaimed
        0,   // no protocol unclaimed
    )
}
