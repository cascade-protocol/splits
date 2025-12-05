/**
 * High-level Cascade Splits client for browser/dashboard use.
 *
 * Requires @solana/kit@^5.0.0 and WebSocket RPC subscriptions.
 * For server-side or kit@2.x compatibility, use the core module
 * and build transactions yourself.
 *
 * @example
 * ```typescript
 * import { createSplitsClient } from '@cascade-fyi/splits-sdk/solana/client';
 *
 * const client = createSplitsClient(rpc, rpcSubscriptions);
 * const result = await client.ensure(signer, {
 *   recipients: [{ address: alice, share: 70 }, { address: bob, share: 30 }],
 * });
 * ```
 */

export { createSplitsClient, type SplitsClient } from "./factory.js";

// Re-export high-level functions for direct use
export {
	ensureSplitConfig,
	type EnsureResult,
	type EnsureBlockedReason,
	type EnsureOptions,
} from "../ensureSplitConfig.js";

export {
	executeAndConfirmSplit,
	type ExecuteResult,
	type ExecuteOptions,
	type ExecuteAndConfirmOptions,
	type ExecuteAndConfirmResult,
	type SkippedReason,
	type FailedReason,
} from "../execute.js";

export {
	updateSplit,
	type UpdateResult,
	type UpdateBlockedReason,
	type UpdateOptions,
} from "../updateSplit.js";

export {
	closeSplit,
	type CloseResult,
	type CloseBlockedReason,
	type CloseOptions,
} from "../closeSplit.js";

// Kit-native adapters (no @solana/web3.js)
export { fromKitSigner } from "./adapters/kit-signer.js";

// Client types (for wallet adapter implementations)
export type {
	SplitsWallet,
	SplitsClientConfig,
	TransactionMessage,
	EnsureParams,
	UpdateParams,
} from "./types.js";

// Re-export types for convenience
export type { SplitRecipient } from "../helpers.js";
