// Fee configuration
pub const PROTOCOL_FEE_BPS: u16 = 100;        // 1%
pub const REQUIRED_SPLIT_TOTAL: u16 = 9900;   // Recipients must total 99%

// Recipient limits
pub const MIN_RECIPIENTS: usize = 1;
pub const MAX_RECIPIENTS: usize = 20;

// Account sizes for zero-copy structs
// ProtocolConfig: discriminator (8) + authority (32) + fee_wallet (32) + bump (1)
pub const PROTOCOL_CONFIG_SIZE: usize = 8 + 32 + 32 + 1;  // 73 bytes

// SplitConfig size calculation:
// - discriminator: 8
// - version: 1
// - authority: 32
// - mint: 32
// - vault: 32
// - unique_id: 32
// - bump: 1
// - recipient_count: 1
// - padding for 2-byte alignment: 1
// - recipients: [Recipient; 20] = (32 + 2) * 20 = 680
// - padding for 8-byte alignment: 4
// - unclaimed_amounts: [UnclaimedAmount; 20] = (32 + 8 + 8) * 20 = 960
// - protocol_unclaimed: 8
// Total: 8 + 1 + 32 + 32 + 32 + 32 + 1 + 1 + 1 + 680 + 4 + 960 + 8 = 1792
// NOTE: #[repr(C)] requires alignment padding for struct fields
pub const SPLIT_CONFIG_SIZE: usize = 1792;
