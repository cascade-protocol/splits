/**
 * Idempotent split update with pre-validation
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
import type { Recipient } from "../index.js";
import { fromKitSigner } from "./client/adapters/kit-signer.js";
import { updateImpl } from "./client/update.js";
import type {
	UpdateResult,
	UpdateOptions,
	BlockedReason,
} from "./client/types.js";

// Re-export types
export type { UpdateResult, UpdateOptions };
export type UpdateBlockedReason = BlockedReason;

/**
 * Update split recipients with pre-validation.
 *
 * This is an idempotent operation - safe to call multiple times:
 * - If recipients match (set equality): returns NO_CHANGE (no transaction)
 * - If recipients differ and updatable: updates and returns signature
 * - If recipients differ but not updatable: returns BLOCKED with reason
 *
 * Recipients are compared using set equality (order-independent).
 *
 * @example
 * ```typescript
 * const result = await updateSplit(rpc, rpcSubscriptions, signer, vault, {
 *   recipients: [
 *     { address: newRecipient, share: 70 },
 *     { address: bob, share: 29 },
 *   ],
 * });
 *
 * switch (result.status) {
 *   case 'UPDATED':
 *     console.log(`Updated! Tx: ${result.signature}`);
 *     break;
 *   case 'NO_CHANGE':
 *     console.log('Recipients already match.');
 *     break;
 *   case 'BLOCKED':
 *     console.log(`Cannot update: ${result.reason} - ${result.message}`);
 *     break;
 *   case 'FAILED':
 *     console.log(`Transaction failed: ${result.message}`);
 *     break;
 * }
 * ```
 */
export async function updateSplit(
	rpc: Rpc<SolanaRpcApi>,
	rpcSubscriptions: RpcSubscriptions<
		SignatureNotificationsApi & SlotNotificationsApi
	>,
	signer: TransactionSigner,
	vault: Address,
	params: {
		/** New recipients with share (1-100) or percentageBps (1-9900) */
		recipients: Recipient[];
	},
	options: UpdateOptions = {},
): Promise<UpdateResult> {
	const wallet = fromKitSigner(signer, rpc, rpcSubscriptions);

	const clientConfig: Parameters<typeof updateImpl>[4] = {};
	if (options.commitment) clientConfig.commitment = options.commitment;
	if (options.computeUnitPrice)
		clientConfig.computeUnitPrice = options.computeUnitPrice;

	return updateImpl(
		rpc,
		wallet,
		vault,
		{ recipients: params.recipients },
		clientConfig,
	);
}
