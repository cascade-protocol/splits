/**
 * Cascade Splits SDK - Solana Core Module
 *
 * This module exports kit-version-agnostic code that works with any @solana/kit version:
 * - Instruction builders (return `Instruction` objects)
 * - Helper functions (RPC reads, PDA derivation, split detection)
 * - Types and constants
 *
 * Transaction building and sending is the consumer's responsibility, allowing
 * integration with any kit version and signing flow.
 *
 * For high-level convenience with WebSocket confirmation (requires kit@5.0):
 * - '@cascade-fyi/splits-sdk/solana/client'
 *
 * @example
 * ```typescript
 * import {
 *   executeSplit,
 *   isCascadeSplit,
 *   deriveSplitConfig,
 * } from '@cascade-fyi/splits-sdk/solana';
 *
 * // Check if address is a split vault
 * if (await isCascadeSplit(rpc, vault)) {
 *   // Build instruction
 *   const result = await executeSplit(rpc, vault, executor);
 *   if (result.ok) {
 *     // Build and send transaction using YOUR kit version
 *     const tx = buildTransaction([result.instruction], signer);
 *     await sendTransaction(tx);
 *   }
 * }
 * ```
 */

// =============================================================================
// INSTRUCTIONS (Low-level, returns Instruction - kit-agnostic)
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
// HELPERS & READ FUNCTIONS
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

// =============================================================================
// ESTIMATION (Pure calculation, no transactions)
// =============================================================================

export {
	estimateSplitRent,
	type EstimateResult,
} from "./estimateSplitRent.js";
