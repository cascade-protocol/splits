/**
 * Cascade Splits SDK - Solana Module
 *
 * @example
 * ```typescript
 * import {
 *   ensureSplitConfig,
 *   executeAndConfirmSplit,
 *   isCascadeSplit,
 * } from '@cascade-fyi/splits-sdk/solana';
 *
 * // High-level: Idempotent create/update
 * const result = await ensureSplitConfig(rpc, rpcSub, signer, {
 *   recipients: [{ address: alice, share: 70 }, { address: bob, share: 29 }],
 * });
 *
 * // Check if vault is a split
 * if (await isCascadeSplit(rpc, vault)) {
 *   // Execute and confirm in one call
 *   await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer);
 * }
 * ```
 */

// =============================================================================
// HIGH-LEVEL (Idempotent, sends transactions)
// =============================================================================

export {
	ensureSplitConfig,
	type EnsureResult,
	type EnsureBlockedReason,
	type EnsureOptions,
} from "./ensureSplitConfig.js";

export {
	closeSplit,
	type CloseResult,
	type CloseBlockedReason,
	type CloseOptions,
} from "./closeSplit.js";

export {
	updateSplit,
	type UpdateResult,
	type UpdateBlockedReason,
	type UpdateOptions,
} from "./updateSplit.js";

// =============================================================================
// ESTIMATION (Pure, no transactions)
// =============================================================================

export {
	estimateSplitRent,
	type EstimateResult,
} from "./estimateSplitRent.js";

// =============================================================================
// EXECUTE (High-level)
// =============================================================================

export {
	executeAndConfirmSplit,
	type ExecuteResult,
	type ExecuteOptions,
	type ExecuteAndConfirmOptions,
	type ExecuteAndConfirmResult,
	type SkippedReason,
	type FailedReason,
} from "./execute.js";

// =============================================================================
// HTTP-ONLY (For facilitators/servers - no WebSocket required)
// =============================================================================

export {
	sendExecuteSplit,
	type SendExecuteSplitOptions,
} from "./sendExecuteSplit.js";

export {
	sendEnsureSplit,
	type SendEnsureSplitOptions,
	type SendEnsureSplitParams,
} from "./sendEnsureSplit.js";

export {
	sendUpdateSplit,
	type SendUpdateSplitOptions,
	type SendUpdateSplitParams,
} from "./sendUpdateSplit.js";

export {
	sendCloseSplit,
	type SendCloseSplitOptions,
} from "./sendCloseSplit.js";

// =============================================================================
// INSTRUCTIONS (Low-level, returns Instruction)
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
// READ & HELPERS
// =============================================================================

export {
	// Read functions
	getSplitConfigFromVault,
	getProtocolConfig,
	getVaultBalance,
	// Split detection (cached)
	isCascadeSplit,
	invalidateSplitCache,
	clearSplitCache,
	// Protocol config cache
	invalidateProtocolConfigCache,
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
	seedBytesToAddress,
	// Token program detection
	detectTokenProgram,
	// Recipient comparison
	recipientsEqual,
	// ATA checking
	checkRecipientAtas,
	type MissingAta,
	// Types
	type SplitConfig,
	type SplitRecipient,
	type ProtocolConfig,
	type UnclaimedAmount,
} from "./helpers.js";
