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
import { fromKitSigner } from "./client/adapters/kit-signer.js";
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

// Legacy result type for backwards compatibility
export type ExecuteAndConfirmResult =
	| { ok: true; signature: string }
	| { ok: false; reason: SkippedReason }
	| { ok: false; reason: "send_failed" | "expired" | "aborted"; error: Error };

/**
 * Execute a split and wait for confirmation.
 *
 * Uses @solana/kit's sendAndConfirmTransactionFactory for efficient
 * WebSocket-based confirmation instead of polling.
 *
 * @example
 * ```typescript
 * const result = await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer);
 *
 * switch (result.status) {
 *   case 'EXECUTED':
 *     console.log(`Split executed: ${result.signature}`);
 *     break;
 *   case 'SKIPPED':
 *     console.log(`Skipped: ${result.reason}`);
 *     break;
 *   case 'FAILED':
 *     console.log(`Failed: ${result.message}`);
 *     break;
 * }
 *
 * // With minimum balance threshold (micropayment batching)
 * const result = await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer, {
 *   minBalance: 1_000_000n, // 1 USDC
 * });
 *
 * // With priority fee during congestion
 * const result = await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer, {
 *   computeUnitLimit: 150_000,
 *   computeUnitPrice: 50_000n, // 50k microlamports per CU
 * });
 *
 * // With timeout
 * const result = await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer, {
 *   abortSignal: AbortSignal.timeout(30_000),
 * });
 * ```
 */
export async function executeAndConfirmSplit(
	rpc: Rpc<SolanaRpcApi>,
	rpcSubscriptions: RpcSubscriptions<
		SignatureNotificationsApi & SlotNotificationsApi
	>,
	vault: Address,
	signer: TransactionSigner,
	options: ExecuteAndConfirmOptions = {},
): Promise<ExecuteResult> {
	const wallet = fromKitSigner(signer, rpc, rpcSubscriptions);

	const executeOptions: Parameters<typeof executeImpl>[3] = {};
	if (options.minBalance !== undefined)
		executeOptions.minBalance = options.minBalance;
	if (options.commitment) executeOptions.commitment = options.commitment;
	if (options.computeUnitPrice !== undefined)
		executeOptions.computeUnitPrice = options.computeUnitPrice;
	if (options.computeUnitLimit !== undefined)
		executeOptions.computeUnitLimit = options.computeUnitLimit;
	if (options.abortSignal) executeOptions.abortSignal = options.abortSignal;

	return executeImpl(rpc, wallet, vault, executeOptions);
}
