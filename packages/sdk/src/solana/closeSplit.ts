/**
 * Idempotent split closure with pre-validation
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
import { closeImpl } from "./client/close.js";
import type {
	CloseResult,
	CloseOptions,
	BlockedReason,
} from "./client/types.js";

// Re-export types
export type { CloseResult, CloseOptions };
export type CloseBlockedReason = BlockedReason;

/**
 * Close a split configuration and recover rent.
 *
 * This is an idempotent operation - safe to call multiple times:
 * - If split doesn't exist: returns ALREADY_CLOSED
 * - If split exists and closeable: closes and returns rent recovered
 * - If split exists but not closeable: returns BLOCKED with reason
 *
 * Rent is automatically sent to the original rent payer.
 *
 * @example
 * ```typescript
 * const result = await closeSplit(rpc, rpcSubscriptions, signer, vault);
 *
 * switch (result.status) {
 *   case 'CLOSED':
 *     console.log(`Recovered ${result.rentRecovered} lamports`);
 *     break;
 *   case 'ALREADY_CLOSED':
 *     console.log('Already closed (idempotent)');
 *     break;
 *   case 'BLOCKED':
 *     console.log(`Cannot close: ${result.reason} - ${result.message}`);
 *     break;
 *   case 'FAILED':
 *     console.log(`Transaction failed: ${result.message}`);
 *     break;
 * }
 * ```
 */
export async function closeSplit(
	rpc: Rpc<SolanaRpcApi>,
	rpcSubscriptions: RpcSubscriptions<
		SignatureNotificationsApi & SlotNotificationsApi
	>,
	signer: TransactionSigner,
	vault: Address,
	options: CloseOptions = {},
): Promise<CloseResult> {
	const wallet = fromKitSigner(signer, rpc, rpcSubscriptions);

	const clientConfig: Parameters<typeof closeImpl>[3] = {};
	if (options.commitment) clientConfig.commitment = options.commitment;
	if (options.computeUnitPrice)
		clientConfig.computeUnitPrice = options.computeUnitPrice;

	return closeImpl(rpc, wallet, vault, clientConfig);
}
