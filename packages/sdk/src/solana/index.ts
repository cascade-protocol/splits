/**
 * Cascade Splits SDK - Solana Module
 *
 * @example
 * ```typescript
 * import { executeSplit, getSplitConfigFromVault } from '@cascade-fyi/splits-sdk/solana';
 *
 * // Execute a split
 * const result = await executeSplit(rpc, vault, executor);
 * if (result.ok) {
 *   await sendTransaction(result.instruction);
 * }
 *
 * // Read split config
 * const config = await getSplitConfigFromVault(rpc, vault);
 * console.log(config.recipients); // [{ address, share, percentageBps }]
 * ```
 */

// =============================================================================
// Instructions
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
// Read & Helpers
// =============================================================================

export {
	// Read functions
	getSplitConfigFromVault,
	getProtocolConfig,
	getVaultBalance,
	isCascadeSplit,
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
