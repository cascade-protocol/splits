/**
 * Cascade Splits SDK - Core Module
 *
 * Low-level instructions and helpers compatible with @solana/kit v2.x+.
 * Use this entry point if your project cannot upgrade to kit v5.0.
 *
 * For high-level client with WebSocket confirmation, use the root import
 * (requires @solana/kit v5.0+).
 *
 * @example
 * ```typescript
 * import {
 *   createSplitConfig,
 *   executeSplit,
 *   getSplitConfig,
 *   isCascadeSplit,
 *   type Recipient,
 * } from '@cascade-fyi/splits-sdk/core';
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
  TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
} from "../constants.js";

// =============================================================================
// Types and Conversion Helpers
// =============================================================================

export {
  type Recipient,
  shareToPercentageBps,
  percentageBpsToShares,
  toPercentageBps,
} from "../recipients.js";

// =============================================================================
// Errors
// =============================================================================

export * from "../errors.js";

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
} from "../instructions.js";

// =============================================================================
// Helpers & Read Functions
// =============================================================================

export {
  getSplitConfig,
  getSplitConfigAddressFromVault,
  getSplitConfigFromVault,
  getProtocolConfig,
  getVaultBalance,
  isCascadeSplit,
  deriveSplitConfig,
  deriveVault,
  deriveAta,
  deriveProtocolConfig,
  generateUniqueId,
  labelToSeed,
  seedToLabel,
  detectTokenProgram,
  recipientsEqual,
  checkRecipientAtas,
  getCreateAtaInstructions,
  type MissingAta,
  type SplitConfig,
  type SplitRecipient,
  type ProtocolConfig,
  type UnclaimedAmount,
} from "../helpers.js";

// =============================================================================
// Estimation
// =============================================================================

export {
  estimateSplitRent,
  type EstimateResult,
} from "../estimateSplitRent.js";
