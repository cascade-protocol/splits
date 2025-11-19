use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Recipient count must be between 1 and 20")]
    InvalidRecipientCount,

    #[msg("Recipient percentages must sum to 9900 bps (99%)")]
    InvalidSplitTotal,

    #[msg("Duplicate recipient address")]
    DuplicateRecipient,

    #[msg("Recipient address cannot be zero")]
    ZeroAddress,

    #[msg("Recipient percentage cannot be zero")]
    ZeroPercentage,

    #[msg("Recipient ATA does not exist")]
    RecipientATADoesNotExist,

    #[msg("Recipient ATA is invalid")]
    RecipientATAInvalid,

    #[msg("Recipient ATA has wrong owner")]
    RecipientATAWrongOwner,

    #[msg("Recipient ATA has wrong mint")]
    RecipientATAWrongMint,

    #[msg("Vault must be empty for this operation")]
    VaultNotEmpty,

    #[msg("Invalid vault account")]
    InvalidVault,

    #[msg("Not enough accounts provided in remaining_accounts")]
    InsufficientRemainingAccounts,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Math underflow")]
    MathUnderflow,

    #[msg("Invalid protocol fee recipient")]
    InvalidProtocolFeeRecipient,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Protocol already initialized")]
    AlreadyInitialized,

    #[msg("Unclaimed amounts must be zero to close")]
    UnclaimedNotEmpty,

    #[msg("Invalid token program")]
    InvalidTokenProgram,

    #[msg("No pending authority transfer")]
    NoPendingTransfer,
}
