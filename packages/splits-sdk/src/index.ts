/**
 * Cascade Splits SDK
 *
 * Non-custodial payment splitting for Solana. All exports from a single entry point.
 *
 * @example
 * ```typescript
 * import {
 *   // High-level client (recommended)
 *   createSplitsClient,
 *
 *   // Low-level instructions (for custom tx flows)
 *   executeSplit,
 *   isCascadeSplit,
 *
 *   // Types
 *   type Recipient,
 * } from '@cascade-fyi/splits-sdk';
 *
 * // Server usage with kit signer
 * const splits = createSplitsClient({ rpc, rpcSubscriptions, signer });
 * const result = await splits.ensureSplit({
 *   recipients: [
 *     { address: "alice...", share: 60 },
 *     { address: "bob...", share: 40 }
 *   ]
 * });
 * ```
 */

// =============================================================================
// Constants
// =============================================================================

export {
  PROGRAM_ID,
  MAX_RECIPIENTS,
  PROTOCOL_FEE_BPS,
  TOTAL_RECIPIENT_BPS,
  USDC_MINT,
  PROTOCOL_CONFIG_SEED,
  SPLIT_CONFIG_SEED,
  // Solana program addresses (inlined to avoid @solana-program/* dependencies)
  TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
} from "./constants.js";

// =============================================================================
// Types and Conversion Helpers
// =============================================================================

export {
  type Recipient,
  shareToPercentageBps,
  percentageBpsToShares,
  toPercentageBps,
} from "./recipients.js";

// =============================================================================
// Errors
// =============================================================================

export * from "./errors.js";

// =============================================================================
// Instructions (Low-level - returns Instruction objects)
// =============================================================================

export {
  createSplitConfig,
  executeSplit,
  updateSplitConfig,
  closeSplitConfig,
  type CreateSplitConfigResult,
  type ExecuteSplitResult,
} from "./instructions.js";

// =============================================================================
// Helpers & Read Functions
// =============================================================================

export {
  // Read functions
  getSplitConfig,
  getSplitConfigAddressFromVault,
  /** @deprecated Use getSplitConfig() instead */
  getSplitConfigFromVault,
  getProtocolConfig,
  getVaultBalance,
  getSplitsByAuthority,
  // Split detection (cached internally)
  isCascadeSplit,
  // PDA derivation
  deriveSplitConfig,
  deriveVault,
  deriveAta,
  deriveProtocolConfig,
  // Utilities
  generateUniqueId,
  // Label-based seeds (cross-chain compatible)
  labelToSeed,
  seedToLabel,
  // Token program detection
  detectTokenProgram,
  // Recipient comparison
  recipientsEqual,
  // ATA checking & creation
  checkRecipientAtas,
  getCreateAtaInstructions,
  type MissingAta,
  // Types
  type SplitConfig,
  type SplitWithBalance,
  type SplitRecipient,
  type ProtocolConfig,
  type UnclaimedAmount,
} from "./helpers.js";

// =============================================================================
// Estimation
// =============================================================================

export { estimateSplitRent, type EstimateResult } from "./estimateSplitRent.js";

// =============================================================================
// High-Level Client
// =============================================================================

export {
  createSplitsClient,
  createSplitsClientWithWallet,
  type SplitsClient,
  type SplitsClientOptions,
} from "./client/factory.js";

// High-level direct functions
export {
  ensureSplitConfig,
  type EnsureResult,
  type EnsureBlockedReason,
  type EnsureOptions,
} from "./ensureSplitConfig.js";

export {
  executeAndConfirmSplit,
  type ExecuteResult,
  type ExecuteOptions,
  type ExecuteAndConfirmOptions,
  type SkippedReason,
  type FailedReason,
} from "./execute.js";

export {
  updateSplit,
  type UpdateResult,
  type UpdateBlockedReason,
  type UpdateOptions,
} from "./updateSplit.js";

export {
  closeSplit,
  type CloseResult,
  type CloseBlockedReason,
  type CloseOptions,
} from "./closeSplit.js";

export {
  executeAndSendSplit,
  type ExecuteAndSendResult,
} from "./executeAndSend.js";

// Client types (for wallet adapter implementations)
export type {
  SplitsWallet,
  SplitsClientConfig,
  TransactionMessage,
  EnsureParams,
  UpdateParams,
} from "./client/types.js";
