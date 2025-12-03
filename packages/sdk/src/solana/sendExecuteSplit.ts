/**
 * HTTP-only split execution with polling confirmation
 *
 * Designed for facilitators and servers that don't need WebSocket connections.
 * Uses polling for transaction confirmation instead of WebSocket subscriptions.
 */

import type {
	Address,
	Rpc,
	SolanaRpcApi,
	TransactionSigner,
	Commitment,
} from "@solana/kit";
import {
	pipe,
	createTransactionMessage,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	appendTransactionMessageInstructions,
	signTransactionMessageWithSigners,
	getSignatureFromTransaction,
	getBase64EncodedWireTransaction,
} from "@solana/kit";
import {
	getSetComputeUnitLimitInstruction,
	getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { executeSplit } from "./instructions.js";
import {
	getVaultBalanceAndOwner,
	invalidateProtocolConfigCache,
} from "./helpers.js";
import type {
	ExecuteResult,
	SkippedReason,
	FailedReason,
} from "./client/types.js";

// Program error code for stale protocol config
const INVALID_PROTOCOL_FEE_RECIPIENT = 6004;

/**
 * Options for sendExecuteSplit
 */
export interface SendExecuteSplitOptions {
	/** Only execute if vault balance >= this amount (in token base units) */
	minBalance?: bigint;
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
	/** Compute unit limit (lets runtime determine if not set) */
	computeUnitLimit?: number;
	/** Commitment level (default: 'confirmed') */
	commitment?: Commitment;
	/**
	 * Confirmation options.
	 * - `true` (default): Poll for confirmation with default settings
	 * - `false`: Fire and forget (return immediately after sending)
	 * - `{ maxRetries, retryDelayMs }`: Poll with custom settings
	 */
	confirm?:
		| boolean
		| {
				/** Max polling attempts (default: 30) */
				maxRetries?: number;
				/** Delay between polls in ms (default: 1000) */
				retryDelayMs?: number;
		  };
}

// Re-export types
export type { ExecuteResult, SkippedReason, FailedReason };

/**
 * Execute a split distribution using HTTP-only RPC.
 *
 * This function is designed for facilitators and servers that:
 * - Don't want to manage WebSocket connections
 * - Have their own confirmation logic
 * - Need simple fire-and-forget execution
 *
 * Uses polling for confirmation instead of WebSocket subscriptions.
 *
 * @example
 * ```typescript
 * import { createSolanaRpc } from "@solana/kit";
 * import { sendExecuteSplit, isCascadeSplit } from "@cascade-fyi/splits-sdk/solana";
 * import { toKitSigner } from "@cascade-fyi/splits-sdk/solana/web3-compat";
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const signer = await toKitSigner(keypair);
 *
 * // After settlement, check if payTo is a split and execute
 * if (await isCascadeSplit(rpc, payTo)) {
 *   const result = await sendExecuteSplit(rpc, payTo, signer, {
 *     minBalance: 1_000_000n, // 1 USDC
 *   });
 *
 *   if (result.status === "EXECUTED") {
 *     console.log(`Split executed: ${result.signature}`);
 *   }
 * }
 *
 * // Fire and forget (no confirmation wait)
 * await sendExecuteSplit(rpc, vault, signer, { confirm: false });
 *
 * // Custom polling settings
 * await sendExecuteSplit(rpc, vault, signer, {
 *   confirm: { maxRetries: 60, retryDelayMs: 500 },
 * });
 * ```
 */
export async function sendExecuteSplit(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
	signer: TransactionSigner,
	options: SendExecuteSplitOptions = {},
): Promise<ExecuteResult> {
	const {
		minBalance,
		commitment = "confirmed",
		computeUnitPrice,
		computeUnitLimit,
		confirm = true,
	} = options;

	// Parse confirmation options
	const shouldConfirm = confirm !== false;
	const maxRetries =
		typeof confirm === "object" ? (confirm.maxRetries ?? 30) : 30;
	const retryDelayMs =
		typeof confirm === "object" ? (confirm.retryDelayMs ?? 1000) : 1000;

	// 1. Fetch vault balance and token program (single RPC call)
	const vaultInfo = await getVaultBalanceAndOwner(rpc, vault);
	if (!vaultInfo) {
		return {
			status: "SKIPPED",
			reason: "not_found",
		};
	}

	const { balance, tokenProgram } = vaultInfo;

	// 2. Build instruction (checks if it's a valid split)
	const result = await executeSplit(rpc, vault, signer.address, tokenProgram);
	if (!result.ok) {
		if (result.reason === "not_a_split") {
			return {
				status: "SKIPPED",
				reason: "not_a_split",
			};
		}
		return {
			status: "SKIPPED",
			reason: "not_found",
		};
	}

	// 3. Check minimum balance threshold
	if (minBalance !== undefined && balance < minBalance) {
		return {
			status: "SKIPPED",
			reason: "below_threshold",
		};
	}

	// 4. Build and send transaction
	try {
		// Build options object conditionally to satisfy exactOptionalPropertyTypes
		const buildOptions: {
			computeUnitPrice?: bigint;
			computeUnitLimit?: number;
		} = {};
		if (computeUnitPrice !== undefined)
			buildOptions.computeUnitPrice = computeUnitPrice;
		if (computeUnitLimit !== undefined)
			buildOptions.computeUnitLimit = computeUnitLimit;

		const signature = await buildSignAndSend(
			rpc,
			signer,
			result.instruction,
			buildOptions,
		);

		// 5. Optionally wait for confirmation via polling
		if (shouldConfirm) {
			const confirmResult = await pollForConfirmation(
				rpc,
				signature,
				commitment,
				maxRetries,
				retryDelayMs,
			);

			if (!confirmResult.confirmed) {
				return {
					status: "FAILED",
					reason: "transaction_expired",
					message: confirmResult.error ?? "Transaction confirmation timeout",
				};
			}
		}

		return {
			status: "EXECUTED",
			signature,
		};
	} catch (e) {
		// Check for stale protocol config error and retry once
		if (isProgramError(e, INVALID_PROTOCOL_FEE_RECIPIENT)) {
			invalidateProtocolConfigCache();
			// Retry once with fresh protocol config
			try {
				const retryResult = await executeSplit(
					rpc,
					vault,
					signer.address,
					tokenProgram,
				);
				if (!retryResult.ok) {
					return {
						status: "FAILED",
						reason: "program_error",
						message: "Failed to build execute instruction after retry",
					};
				}

				const retryBuildOptions: {
					computeUnitPrice?: bigint;
					computeUnitLimit?: number;
				} = {};
				if (computeUnitPrice !== undefined)
					retryBuildOptions.computeUnitPrice = computeUnitPrice;
				if (computeUnitLimit !== undefined)
					retryBuildOptions.computeUnitLimit = computeUnitLimit;

				const signature = await buildSignAndSend(
					rpc,
					signer,
					retryResult.instruction,
					retryBuildOptions,
				);

				if (shouldConfirm) {
					const confirmResult = await pollForConfirmation(
						rpc,
						signature,
						commitment,
						maxRetries,
						retryDelayMs,
					);
					if (!confirmResult.confirmed) {
						return {
							status: "FAILED",
							reason: "transaction_expired",
							message:
								confirmResult.error ?? "Transaction confirmation timeout",
						};
					}
				}

				return { status: "EXECUTED", signature };
			} catch (retryError) {
				const failResult: ExecuteResult = {
					status: "FAILED",
					reason: "program_error",
					message:
						retryError instanceof Error
							? retryError.message
							: String(retryError),
				};
				if (retryError instanceof Error) {
					failResult.error = retryError;
				}
				return failResult;
			}
		}

		const networkFailResult: ExecuteResult = {
			status: "FAILED",
			reason: "network_error",
			message: e instanceof Error ? e.message : String(e),
		};
		if (e instanceof Error) {
			networkFailResult.error = e;
		}
		return networkFailResult;
	}
}

// =============================================================================
// Helpers
// =============================================================================

import type { Instruction } from "@solana/kit";

/**
 * Build, sign, and send a transaction via HTTP RPC.
 */
async function buildSignAndSend(
	rpc: Rpc<SolanaRpcApi>,
	signer: TransactionSigner,
	instruction: Instruction,
	options: {
		computeUnitPrice?: bigint;
		computeUnitLimit?: number;
	},
): Promise<string> {
	const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

	// Build instructions array with compute budget
	const instructions: Instruction[] = [];

	if (options.computeUnitLimit !== undefined) {
		instructions.push(
			getSetComputeUnitLimitInstruction({ units: options.computeUnitLimit }),
		);
	}

	if (options.computeUnitPrice !== undefined) {
		instructions.push(
			getSetComputeUnitPriceInstruction({
				microLamports: options.computeUnitPrice,
			}),
		);
	}

	instructions.push(instruction);

	// Build and sign transaction
	const transactionMessage = pipe(
		createTransactionMessage({ version: 0 }),
		(msg) => setTransactionMessageFeePayerSigner(signer, msg),
		(msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
		(msg) => appendTransactionMessageInstructions(instructions, msg),
	);

	const signedTransaction =
		await signTransactionMessageWithSigners(transactionMessage);
	const signature = getSignatureFromTransaction(signedTransaction);

	// Send via HTTP RPC
	const base64Tx = getBase64EncodedWireTransaction(signedTransaction);
	await rpc.sendTransaction(base64Tx, { encoding: "base64" }).send();

	return signature;
}

/**
 * Poll for transaction confirmation using getSignatureStatuses.
 */
async function pollForConfirmation(
	rpc: Rpc<SolanaRpcApi>,
	signature: string,
	commitment: Commitment,
	maxRetries: number,
	retryDelayMs: number,
): Promise<{ confirmed: boolean; error?: string }> {
	for (let i = 0; i < maxRetries; i++) {
		const status = await rpc
			.getSignatureStatuses([
				signature as Parameters<typeof rpc.getSignatureStatuses>[0][0],
			])
			.send();

		const result = status.value[0];

		if (result?.err) {
			return {
				confirmed: false,
				error: `Transaction failed: ${JSON.stringify(result.err)}`,
			};
		}

		if (result?.confirmationStatus) {
			// Check if we've reached the desired commitment level
			const confirmedLevels: Record<Commitment, string[]> = {
				processed: ["processed", "confirmed", "finalized"],
				confirmed: ["confirmed", "finalized"],
				finalized: ["finalized"],
			};

			if (confirmedLevels[commitment].includes(result.confirmationStatus)) {
				return { confirmed: true };
			}
		}

		await sleep(retryDelayMs);
	}

	return { confirmed: false, error: "Confirmation timeout" };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is a specific program error code.
 */
function isProgramError(e: unknown, expectedCode: number): boolean {
	if (e instanceof Error) {
		const msg = e.message;
		if (msg.includes(`custom program error: 0x${expectedCode.toString(16)}`)) {
			return true;
		}
		if (msg.includes(`Error Code: ${expectedCode}`)) {
			return true;
		}
	}
	return false;
}
