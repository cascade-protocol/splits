/**
 * Cascade Splits Client
 *
 * High-level client for interacting with Cascade Splits from any environment.
 * Kit-native with no @solana/web3.js imports in core.
 *
 * ## Adapter Patterns
 *
 * **Kit-native (recommended for new projects):**
 * ```typescript
 * import { createSolanaRpc, createSolanaRpcSubscriptions, createKeyPairSignerFromBytes } from "@solana/kit";
 * import { createSplitsClient, fromKitSigner } from '@cascade-fyi/splits-sdk/solana/client';
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const rpcSubs = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");
 * const signer = await createKeyPairSignerFromBytes(secretKey);
 *
 * const splits = createSplitsClient(rpc, fromKitSigner(signer, rpc, rpcSubs));
 * ```
 *
 *
 * **Browser with wallet adapter (@solana/web3.js):**
 * ```typescript
 * import { createSplitsClient } from '@cascade-fyi/splits-sdk/solana/client';
 * import { fromWalletAdapter } from '@cascade-fyi/splits-sdk/solana/web3-compat';
 * import { useWallet } from '@solana/wallet-adapter-react';
 *
 * const wallet = useWallet();
 * const splits = createSplitsClient(rpc, fromWalletAdapter(wallet, connection));
 * ```
 */

import type { Rpc, SolanaRpcApi, Address } from "@solana/kit";
import type {
	SplitsWallet,
	SplitsClientConfig,
	EnsureParams,
	UpdateParams,
	ExecuteOptions,
	EnsureResult,
	UpdateResult,
	CloseResult,
	ExecuteResult,
} from "./types.js";
import { ensureSplitImpl } from "./ensure.js";
import { updateImpl } from "./update.js";
import { closeImpl } from "./close.js";
import { executeImpl } from "./execute.js";

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Splits client for interacting with Cascade Splits.
 *
 * @param rpc - Solana RPC client from @solana/kit
 * @param wallet - Wallet adapter (use fromKitSigner or fromWalletAdapter)
 * @param config - Optional client configuration
 * @returns SplitsClient object with methods for split operations
 *
 * @example
 * ```typescript
 * const splits = createSplitsClient(rpc, fromKitSigner(signer, rpc, rpcSubs));
 *
 * // Create or get existing split (idempotent)
 * const result = await splits.ensureSplit({
 *   recipients: [{ address: alice, share: 70 }, { address: bob, share: 29 }],
 *   label: 'revenue-share',
 * });
 *
 * if (result.status === 'CREATED') {
 *   console.log(`Created split! Vault: ${result.vault}`);
 * } else if (result.status === 'NO_CHANGE') {
 *   console.log(`Split already exists: ${result.vault}`);
 * }
 *
 * // Execute distribution
 * await splits.execute(result.vault);
 *
 * // Update recipients
 * await splits.update(result.vault, {
 *   recipients: [{ address: alice, share: 50 }, { address: bob, share: 49 }],
 * });
 *
 * // Close and recover rent
 * await splits.close(result.vault);
 * ```
 */
export function createSplitsClient(
	rpc: Rpc<SolanaRpcApi>,
	wallet: SplitsWallet,
	config: SplitsClientConfig = {},
) {
	return {
		/**
		 * Create or update a split configuration (idempotent).
		 *
		 * - If split doesn't exist: creates it, returns CREATED
		 * - If split exists with same recipients: returns NO_CHANGE
		 * - If split exists with different recipients: updates if possible, or returns BLOCKED
		 *
		 * @param params - Split parameters (recipients, mint, seed/label)
		 * @returns EnsureResult with status and relevant data
		 */
		ensureSplit: (params: EnsureParams): Promise<EnsureResult> =>
			ensureSplitImpl(rpc, wallet, params, config),

		/**
		 * Update recipients of an existing split.
		 *
		 * - If recipients match: returns NO_CHANGE
		 * - If vault has balance or unclaimed: returns BLOCKED
		 * - Otherwise: updates recipients, returns UPDATED
		 *
		 * @param vault - Vault address of the split
		 * @param params - New recipients
		 * @returns UpdateResult with status
		 */
		update: (vault: Address, params: UpdateParams): Promise<UpdateResult> =>
			updateImpl(rpc, wallet, vault, params, config),

		/**
		 * Close a split and recover rent.
		 *
		 * - If already closed: returns ALREADY_CLOSED
		 * - If vault has balance or unclaimed: returns BLOCKED
		 * - Otherwise: closes and returns rent recovered
		 *
		 * Rent is automatically returned to the original payer.
		 *
		 * @param vault - Vault address of the split
		 * @returns CloseResult with status and rent recovered
		 */
		close: (vault: Address): Promise<CloseResult> =>
			closeImpl(rpc, wallet, vault, config),

		/**
		 * Execute a split distribution.
		 *
		 * Distributes all tokens in the vault to recipients according to their shares.
		 * Permissionless - anyone can execute.
		 *
		 * @param vault - Vault address of the split
		 * @param options - Optional execution options (minBalance threshold)
		 * @returns ExecuteResult with status
		 */
		execute: (
			vault: Address,
			options?: ExecuteOptions,
		): Promise<ExecuteResult> =>
			executeImpl(rpc, wallet, vault, { ...config, ...options }),

		/**
		 * Get the wallet address.
		 */
		get address(): Address {
			return wallet.address;
		},
	};
}

/**
 * Type of the SplitsClient returned by createSplitsClient.
 */
export type SplitsClient = ReturnType<typeof createSplitsClient>;

// =============================================================================
// Re-exports
// =============================================================================

// Kit-native adapters (no @solana/web3.js)
export { fromKitSigner } from "./adapters/kit-signer.js";

// Types
export type {
	SplitsWallet,
	SplitsClientConfig,
	TransactionMessage,
	EnsureParams,
	UpdateParams,
	ExecuteOptions,
	EnsureResult,
	UpdateResult,
	CloseResult,
	ExecuteResult,
	BlockedReason,
	SkippedReason,
	FailedReason,
} from "./types.js";
