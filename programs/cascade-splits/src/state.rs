use anchor_lang::prelude::*;

use crate::constants::MAX_RECIPIENTS;

/// Global protocol configuration (single instance)
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct ProtocolConfig {
    /// Authority that can update config (initially program upgrade authority)
    pub authority: Pubkey,
    /// Pending authority for two-step transfer (default = no pending transfer)
    pub pending_authority: Pubkey,
    /// Wallet that receives protocol fees
    pub fee_wallet: Pubkey,
    /// Bump seed for PDA derivation (stored for CU optimization)
    pub bump: u8,
}

/// Per-split configuration with zero-copy for optimal compute efficiency
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct SplitConfig {
    /// Schema version for future upgrades
    pub version: u8,
    /// Authority that can update/close this config
    pub authority: Pubkey,
    /// Token mint for this split
    pub mint: Pubkey,
    /// Vault address (PDA-owned ATA) for receiving payments
    pub vault: Pubkey,
    /// Unique identifier enabling multiple configs per authority/mint
    pub unique_id: Pubkey,
    /// Bump seed for PDA derivation (stored for CU optimization)
    pub bump: u8,
    /// Number of active recipients (1-20)
    pub recipient_count: u8,
    /// Fixed array of recipients (use recipient_count to determine active entries)
    pub recipients: [Recipient; MAX_RECIPIENTS],
    /// Fixed array of unclaimed amounts (indexed by recipient position)
    pub unclaimed_amounts: [UnclaimedAmount; MAX_RECIPIENTS],
    /// Protocol fees awaiting claim (when protocol ATA missing)
    pub protocol_unclaimed: u64,
}

/// Recipient in a split configuration
#[zero_copy(unsafe)]
#[repr(C)]
#[derive(Default)]
pub struct Recipient {
    /// Recipient's wallet address
    pub address: Pubkey,
    /// Percentage in basis points (1-9900, where 100 = 1%)
    pub percentage_bps: u16,
}

/// Unclaimed amount for a recipient
#[zero_copy(unsafe)]
#[repr(C)]
#[derive(Default)]
pub struct UnclaimedAmount {
    /// Recipient address (redundant but useful for indexing)
    pub recipient: Pubkey,
    /// Amount held as unclaimed
    pub amount: u64,
    /// Timestamp when this was recorded
    pub timestamp: i64,
}


// Compile-time size assertions to catch accidental struct changes
// ProtocolConfig: discriminator (8) + authority (32) + pending_authority (32) + fee_wallet (32) + bump (1) = 105
const _: () = assert!(std::mem::size_of::<ProtocolConfig>() == 97); // 105 - 8 (discriminator added by Anchor)

// SplitConfig: See constants.rs for full breakdown = 1792
const _: () = assert!(std::mem::size_of::<SplitConfig>() == 1784); // 1792 - 8 (discriminator added by Anchor)
