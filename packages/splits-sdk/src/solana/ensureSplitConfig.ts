/**
 * Idempotent split configuration management
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
import { ensureSplitImpl } from "./client/ensure.js";
import type {
	EnsureResult,
	EnsureOptions,
	BlockedReason,
} from "./client/types.js";

// Re-export types
export type { EnsureResult, EnsureOptions };
export type EnsureBlockedReason = BlockedReason;

/**
 * Ensure a split configuration exists with the specified recipients.
 *
 * This is an idempotent operation - safe to call multiple times:
 * - If split doesn't exist: creates it (CREATED)
 * - If split exists with same recipients: returns NO_CHANGE (no transaction)
 * - If split exists with different recipients: updates if possible (UPDATED), or returns BLOCKED
 *
 * @example
 * ```typescript
 * const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
 *   recipients: [
 *     { address: alice, share: 70 },
 *     { address: bob, share: 29 },
 *   ],
 * });
 *
 * switch (result.status) {
 *   case 'CREATED':
 *     console.log(`Created! Vault: ${result.vault}, Rent: ${result.rentPaid}`);
 *     break;
 *   case 'NO_CHANGE':
 *     console.log('Already configured correctly.');
 *     break;
 *   case 'UPDATED':
 *     console.log(`Updated recipients. Tx: ${result.signature}`);
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
export async function ensureSplitConfig(
	rpc: Rpc<SolanaRpcApi>,
	rpcSubscriptions: RpcSubscriptions<
		SignatureNotificationsApi & SlotNotificationsApi
	>,
	signer: TransactionSigner,
	params: {
		/** Recipients with share (1-100) or percentageBps (1-9900) */
		recipients: Recipient[];
		/** Token mint (defaults to USDC) */
		mint?: Address;
		/** Unique seed or label for PDA derivation */
		seed?: string | Address;
		/** Payer for rent (defaults to signer) */
		payer?: TransactionSigner;
	},
	options: EnsureOptions = {},
): Promise<EnsureResult> {
	const wallet = fromKitSigner(signer, rpc, rpcSubscriptions);

	const ensureParams: Parameters<typeof ensureSplitImpl>[2] = {
		recipients: params.recipients,
	};
	if (params.mint) ensureParams.mint = params.mint;
	if (params.seed) ensureParams.seed = params.seed;
	if (params.payer) ensureParams.payer = params.payer.address;

	const clientConfig: Parameters<typeof ensureSplitImpl>[3] = {};
	if (options.commitment) clientConfig.commitment = options.commitment;
	if (options.computeUnitPrice)
		clientConfig.computeUnitPrice = options.computeUnitPrice;

	return ensureSplitImpl(rpc, wallet, ensureParams, clientConfig);
}
