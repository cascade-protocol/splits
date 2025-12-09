/**
 * Transaction execution helpers for Cascade Splits
 *
 * Thin wrapper around the core client implementation for direct function API.
 */

import type {
	Address,
	Rpc,
	SolanaRpcApi,
	TransactionSigner,
	RpcSubscriptions,
	SignatureNotificationsApi,
	SlotNotificationsApi,
} from "@solana/kit";
import { createKitWallet } from "./client/shared.js";
import { executeImpl } from "./client/execute.js";
import type {
	ExecuteResult,
	ExecuteOptions,
	ExecuteAndConfirmOptions,
	SkippedReason,
	FailedReason,
} from "./client/types.js";

// Re-export types
export type { ExecuteResult, ExecuteOptions, ExecuteAndConfirmOptions };
export type { SkippedReason, FailedReason };

/**
 * Execute a split and wait for confirmation.
 *
 * Uses @solana/kit's sendAndConfirmTransactionFactory for efficient
 * WebSocket-based confirmation instead of polling.
 *
 * @example
 * ```typescript
 * const result = await executeAndConfirmSplit({ rpc, rpcSubscriptions, splitConfig, signer });
 *
 * switch (result.status) {
 *   case 'executed':
 *     console.log(`Split executed: ${result.signature}`);
 *     break;
 *   case 'skipped':
 *     console.log(`Skipped: ${result.reason}`);
 *     break;
 *   case 'failed':
 *     console.log(`Failed: ${result.message}`);
 *     break;
 * }
 *
 * // With priority fee during congestion
 * const result = await executeAndConfirmSplit({
 *   rpc,
 *   rpcSubscriptions,
 *   splitConfig,
 *   signer,
 *   computeUnitLimit: 150_000,
 *   computeUnitPrice: 50_000n, // 50k microlamports per CU
 * });
 *
 * // With timeout
 * const result = await executeAndConfirmSplit({
 *   rpc,
 *   rpcSubscriptions,
 *   splitConfig,
 *   signer,
 *   abortSignal: AbortSignal.timeout(30_000),
 * });
 * ```
 */
export async function executeAndConfirmSplit(input: {
	/** RPC client */
	rpc: Rpc<SolanaRpcApi>;
	/** RPC subscriptions for transaction confirmation */
	rpcSubscriptions: RpcSubscriptions<
		SignatureNotificationsApi & SlotNotificationsApi
	>;
	/** SplitConfig PDA address */
	splitConfig: Address;
	/** Transaction signer */
	signer: TransactionSigner;
	/** Commitment level for confirmation (default: 'confirmed') */
	commitment?: ExecuteAndConfirmOptions["commitment"];
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: ExecuteAndConfirmOptions["computeUnitPrice"];
	/** Compute unit limit (lets runtime determine if not set) */
	computeUnitLimit?: ExecuteAndConfirmOptions["computeUnitLimit"];
	/** Abort signal for timeout/cancellation support */
	abortSignal?: ExecuteAndConfirmOptions["abortSignal"];
}): Promise<ExecuteResult> {
	const {
		rpc,
		rpcSubscriptions,
		splitConfig,
		signer,
		commitment,
		computeUnitPrice,
		computeUnitLimit,
		abortSignal,
	} = input;

	const wallet = createKitWallet(signer, rpc, rpcSubscriptions);

	return executeImpl(rpc, wallet, splitConfig, {
		...(commitment && { commitment }),
		...(computeUnitPrice !== undefined && { computeUnitPrice }),
		...(computeUnitLimit !== undefined && { computeUnitLimit }),
		...(abortSignal && { abortSignal }),
	});
}
