/**
 * Cascade Splits SDK - Solana Module
 *
 * @example
 * ```typescript
 * import {
 *   executeSplit,
 *   executeAndConfirmSplit,
 *   isCascadeSplit,
 * } from '@cascade-fyi/splits-sdk/solana';
 *
 * // Check if vault is a split
 * if (await isCascadeSplit(rpc, vault)) {
 *   // Low-level: get instruction to sign yourself
 *   const result = await executeSplit(rpc, vault, executor);
 *
 *   // High-level: execute and confirm in one call
 *   const result = await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer);
 * }
 * ```
 */

// =============================================================================
// Instructions (build transactions)
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
// Execute (high-level transaction helpers)
// =============================================================================

export {
	executeAndConfirmSplit,
	type ExecuteAndConfirmOptions,
	type ExecuteAndConfirmResult,
} from "./execute.js";

// =============================================================================
// Read & Helpers
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
	// Types
	type SplitConfig,
	type SplitRecipient,
	type ProtocolConfig,
	type UnclaimedAmount,
} from "./helpers.js";
