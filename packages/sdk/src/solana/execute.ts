/**
 * Transaction execution helpers for Cascade Splits
 *
 * High-level functions that handle the full transaction lifecycle:
 * build instruction → sign → send → confirm
 *
 * Uses @solana/kit's sendAndConfirmTransactionFactory for efficient
 * WebSocket-based confirmation (no polling).
 */

import {
	type Address,
	type Rpc,
	type SolanaRpcApi,
	type KeyPairSigner,
	type RpcSubscriptions,
	type SignatureNotificationsApi,
	type SlotNotificationsApi,
	type Instruction,
	pipe,
	createTransactionMessage,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	appendTransactionMessageInstructions,
	signTransactionMessageWithSigners,
	getSignatureFromTransaction,
	sendAndConfirmTransactionFactory,
	assertIsTransactionWithBlockhashLifetime,
	isSolanaError,
	SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
	SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from "@solana/kit";
import {
	getSetComputeUnitLimitInstruction,
	getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { CASCADE_SPLITS_ERROR__INVALID_PROTOCOL_FEE_RECIPIENT } from "./generated/errors/index.js";
import { executeSplit } from "./instructions.js";
import {
	getVaultBalanceAndOwner,
	invalidateProtocolConfigCache,
} from "./helpers.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for executeAndConfirmSplit
 */
export interface ExecuteAndConfirmOptions {
	/** Only execute if vault balance >= this amount (in token base units) */
	minBalance?: bigint;
	/** Commitment level for confirmation (default: 'confirmed') */
	commitment?: "processed" | "confirmed" | "finalized";
	/** Abort signal for timeout/cancellation support */
	abortSignal?: AbortSignal;
	/** Compute unit limit (default: 200_000) */
	computeUnitLimit?: number;
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
	/** @internal Prevents infinite retry loop on protocol config mismatch */
	_isRetry?: boolean;
}

/**
 * Result of executeAndConfirmSplit
 */
export type ExecuteAndConfirmResult =
	| { ok: true; signature: string }
	| { ok: false; reason: "not_found" | "not_a_split" | "below_threshold" }
	| {
			ok: false;
			reason: "send_failed" | "expired" | "aborted";
			error: Error;
			programErrorCode?: number;
	  };

// =============================================================================
// Execute and Confirm
// =============================================================================

/**
 * Execute a split and wait for confirmation.
 *
 * Uses @solana/kit's sendAndConfirmTransactionFactory for efficient
 * WebSocket-based confirmation instead of polling.
 *
 * @example
 * ```typescript
 * import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
 * import { executeAndConfirmSplit } from "@cascade-fyi/splits-sdk/solana";
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");
 *
 * const result = await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer);
 * if (result.ok) {
 *   console.log(`Split executed: ${result.signature}`);
 * }
 *
 * // With minimum balance threshold (micropayment batching)
 * const result = await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer, {
 *   minBalance: 1_000_000n, // 1 USDC
 * });
 * if (!result.ok && result.reason === "below_threshold") {
 *   console.log("Vault balance below threshold, skipping execution");
 * }
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
	signer: KeyPairSigner,
	options: ExecuteAndConfirmOptions = {},
): Promise<ExecuteAndConfirmResult> {
	const {
		minBalance,
		commitment = "confirmed",
		abortSignal,
		computeUnitLimit,
		computeUnitPrice,
	} = options;

	// 1. Fetch vault balance and token program (single RPC call)
	const vaultInfo = await getVaultBalanceAndOwner(rpc, vault);
	if (!vaultInfo) {
		return { ok: false, reason: "not_found" };
	}

	const { balance, tokenProgram } = vaultInfo;

	// 2. Build instruction (checks if it's a valid split)
	const result = await executeSplit(rpc, vault, signer.address, tokenProgram);
	if (!result.ok) {
		return result; // "not_found" or "not_a_split"
	}

	// 3. Check minimum balance threshold (only for valid splits)
	// This is for micropayment batching - accumulate small payments before paying gas
	if (minBalance !== undefined && balance < minBalance) {
		return { ok: false, reason: "below_threshold" };
	}

	// 4. Build instruction list (compute budget + split)
	const instructions: Instruction[] = [];

	if (computeUnitLimit !== undefined) {
		instructions.push(
			getSetComputeUnitLimitInstruction({ units: computeUnitLimit }),
		);
	}
	if (computeUnitPrice !== undefined) {
		instructions.push(
			getSetComputeUnitPriceInstruction({ microLamports: computeUnitPrice }),
		);
	}
	instructions.push(result.instruction);

	// 5. Build and sign transaction
	const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

	const transactionMessage = pipe(
		createTransactionMessage({ version: 0 }),
		(msg) => setTransactionMessageFeePayerSigner(signer, msg),
		(msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
		(msg) => appendTransactionMessageInstructions(instructions, msg),
	);

	const signedTransaction =
		await signTransactionMessageWithSigners(transactionMessage);

	// Assert blockhash lifetime for type narrowing
	// (required by sendAndConfirmTransactionFactory)
	assertIsTransactionWithBlockhashLifetime(signedTransaction);

	const signature = getSignatureFromTransaction(signedTransaction);

	// 6. Send and confirm using @solana/kit (WebSocket-based, efficient)
	const sendAndConfirm = sendAndConfirmTransactionFactory({
		rpc,
		rpcSubscriptions,
	});

	try {
		const sendOptions: {
			commitment: typeof commitment;
			abortSignal?: AbortSignal;
		} = {
			commitment,
		};
		if (abortSignal) {
			sendOptions.abortSignal = abortSignal;
		}
		await sendAndConfirm(signedTransaction, sendOptions);
		return { ok: true, signature };
	} catch (e) {
		const error = e as Error;

		if (abortSignal?.aborted) {
			return { ok: false, reason: "aborted", error };
		}
		if (isSolanaError(e, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED)) {
			return { ok: false, reason: "expired", error };
		}

		// Extract program error code using @solana/kit's type-safe API
		// SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM means a program returned a custom error
		// The context contains { code: number, index: number }
		let programErrorCode: number | undefined;
		if (isSolanaError(e, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
			programErrorCode = e.context.code;
		}

		// Auto-retry on stale protocol config (fee_wallet changed)
		if (
			programErrorCode ===
				CASCADE_SPLITS_ERROR__INVALID_PROTOCOL_FEE_RECIPIENT &&
			!options._isRetry
		) {
			invalidateProtocolConfigCache();
			return executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer, {
				...options,
				_isRetry: true,
			});
		}

		// Return error result with optional programErrorCode
		const errorResult: ExecuteAndConfirmResult = {
			ok: false,
			reason: "send_failed",
			error,
		};
		if (programErrorCode !== undefined) {
			(
				errorResult as {
					ok: false;
					reason: "send_failed";
					error: Error;
					programErrorCode: number;
				}
			).programErrorCode = programErrorCode;
		}
		return errorResult;
	}
}
