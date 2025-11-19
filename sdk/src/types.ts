/**
 * Shared types for Cascade Splits SDK
 * Used by both web3 and kit implementations
 */

// Program ID
export const PROGRAM_ID = "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB";

// Constants
export const MAX_RECIPIENTS = 20;
export const PROTOCOL_FEE_BPS = 100; // 1%
export const TOTAL_RECIPIENT_BPS = 9900; // 99%

// Serialization sizes
export const ADDRESS_SIZE = 32;
export const U16_SIZE = 2;
export const U32_SIZE = 4;
export const U64_SIZE = 8;
export const DISCRIMINATOR_SIZE = 8;
export const RECIPIENT_SIZE = ADDRESS_SIZE + U16_SIZE; // 34 bytes

// Seeds
export const PROTOCOL_CONFIG_SEED = "protocol_config";
export const SPLIT_CONFIG_SEED = "split_config";

// Token programs
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

/**
 * Recipient input for creating/updating split configs
 */
export interface RecipientInput {
  /** Recipient wallet address (base58 string) */
  address: string;
  /** Percentage in basis points (1-9900, where 100 = 1%) */
  percentageBps: number;
}

/**
 * On-chain recipient data
 */
export interface Recipient {
  /** Recipient wallet address */
  address: string;
  /** Percentage in basis points */
  percentageBps: number;
}

/**
 * Unclaimed amount for a recipient
 */
export interface UnclaimedAmount {
  /** Recipient address */
  recipient: string;
  /** Amount held as unclaimed */
  amount: bigint;
  /** Timestamp when recorded */
  timestamp: bigint;
}

/**
 * Protocol configuration account
 */
export interface ProtocolConfig {
  /** Authority that can update config */
  authority: string;
  /** Wallet that receives protocol fees */
  feeWallet: string;
  /** PDA bump */
  bump: number;
}

/**
 * Split configuration account
 */
export interface SplitConfig {
  /** Schema version */
  version: number;
  /** Authority that can update/close */
  authority: string;
  /** Token mint */
  mint: string;
  /** Vault address (PDA-owned ATA) */
  vault: string;
  /** Unique identifier */
  uniqueId: string;
  /** PDA bump */
  bump: number;
  /** Number of active recipients */
  recipientCount: number;
  /** Recipients array (use recipientCount to get active) */
  recipients: Recipient[];
  /** Unclaimed amounts array */
  unclaimedAmounts: UnclaimedAmount[];
  /** Protocol fees awaiting claim */
  protocolUnclaimed: bigint;
}

/**
 * Create split config parameters
 */
export interface CreateSplitConfigParams {
  /** Authority wallet address */
  authority: string;
  /** Token mint address */
  mint: string;
  /** Unique identifier for this split */
  uniqueId: string;
  /** Recipients and their percentages */
  recipients: RecipientInput[];
  /** Token program ID (defaults to SPL Token) */
  tokenProgram?: string;
}

/**
 * Execute split parameters
 */
export interface ExecuteSplitParams {
  /** Split config PDA address */
  splitConfig: string;
  /** Vault address */
  vault: string;
  /** Token mint address */
  mint: string;
  /** Protocol config PDA address */
  protocolConfig: string;
  /** Executor wallet address */
  executor: string;
  /** Recipient ATA addresses (in order) */
  recipientAtas: string[];
  /** Protocol fee ATA address */
  protocolAta: string;
  /** Token program ID */
  tokenProgram?: string;
}

/**
 * Update split config parameters
 */
export interface UpdateSplitConfigParams {
  /** Split config PDA address */
  splitConfig: string;
  /** Vault address */
  vault: string;
  /** Token mint address */
  mint: string;
  /** Authority wallet address */
  authority: string;
  /** New recipients and their percentages */
  newRecipients: RecipientInput[];
  /** Recipient ATA addresses for validation */
  recipientAtas: string[];
  /** Token program ID */
  tokenProgram?: string;
}

/**
 * Close split config parameters
 */
export interface CloseSplitConfigParams {
  /** Split config PDA address */
  splitConfig: string;
  /** Vault address */
  vault: string;
  /** Authority wallet address */
  authority: string;
  /** Token program ID */
  tokenProgram?: string;
}

/**
 * Initialize protocol parameters (admin only)
 */
export interface InitializeProtocolParams {
  /** Authority wallet address (must be upgrade authority) */
  authority: string;
  /** Fee wallet address */
  feeWallet: string;
}

/**
 * Update protocol config parameters (admin only)
 */
export interface UpdateProtocolConfigParams {
  /** Protocol config PDA address */
  protocolConfig: string;
  /** Authority wallet address */
  authority: string;
  /** New fee wallet address */
  newFeeWallet: string;
}

/**
 * Transfer protocol authority parameters (admin only)
 */
export interface TransferProtocolAuthorityParams {
  /** Protocol config PDA address */
  protocolConfig: string;
  /** Current authority wallet address */
  authority: string;
  /** New authority wallet address */
  newAuthority: string;
}

/**
 * Result of creating a split config
 */
export interface CreateSplitConfigResult {
  /** Split config PDA address */
  splitConfig: string;
  /** Vault ATA address */
  vault: string;
}

/**
 * Error codes from the program
 */
export enum CascadeSplitsError {
  InvalidRecipientCount = 6000,
  InvalidSplitTotal = 6001,
  DuplicateRecipient = 6002,
  ZeroAddress = 6003,
  ZeroPercentage = 6004,
  RecipientATADoesNotExist = 6005,
  RecipientATAInvalid = 6006,
  RecipientATAWrongOwner = 6007,
  RecipientATAWrongMint = 6008,
  VaultNotEmpty = 6009,
  InvalidVault = 6010,
  InsufficientRemainingAccounts = 6011,
  MathOverflow = 6012,
  MathUnderflow = 6013,
  InvalidProtocolFeeRecipient = 6014,
  Unauthorized = 6015,
  AlreadyInitialized = 6016,
  UnclaimedNotEmpty = 6017,
  InvalidTokenProgram = 6018,
}

/**
 * Error messages for error codes
 */
export const ERROR_MESSAGES: Record<CascadeSplitsError, string> = {
  [CascadeSplitsError.InvalidRecipientCount]: "Recipient count must be between 1 and 20",
  [CascadeSplitsError.InvalidSplitTotal]: "Recipient percentages must sum to 9900 bps (99%)",
  [CascadeSplitsError.DuplicateRecipient]: "Duplicate recipient address",
  [CascadeSplitsError.ZeroAddress]: "Recipient address cannot be zero",
  [CascadeSplitsError.ZeroPercentage]: "Recipient percentage cannot be zero",
  [CascadeSplitsError.RecipientATADoesNotExist]: "Recipient ATA does not exist",
  [CascadeSplitsError.RecipientATAInvalid]: "Recipient ATA is invalid",
  [CascadeSplitsError.RecipientATAWrongOwner]: "Recipient ATA has wrong owner",
  [CascadeSplitsError.RecipientATAWrongMint]: "Recipient ATA has wrong mint",
  [CascadeSplitsError.VaultNotEmpty]: "Vault must be empty for this operation",
  [CascadeSplitsError.InvalidVault]: "Invalid vault account",
  [CascadeSplitsError.InsufficientRemainingAccounts]: "Not enough accounts provided in remaining_accounts",
  [CascadeSplitsError.MathOverflow]: "Math overflow",
  [CascadeSplitsError.MathUnderflow]: "Math underflow",
  [CascadeSplitsError.InvalidProtocolFeeRecipient]: "Invalid protocol fee recipient",
  [CascadeSplitsError.Unauthorized]: "Unauthorized",
  [CascadeSplitsError.AlreadyInitialized]: "Protocol already initialized",
  [CascadeSplitsError.UnclaimedNotEmpty]: "Unclaimed amounts must be zero to close",
  [CascadeSplitsError.InvalidTokenProgram]: "Invalid token program",
};
