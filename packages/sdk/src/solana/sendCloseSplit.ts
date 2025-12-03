/**
 * HTTP-only split closure with polling confirmation
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
	Instruction,
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
import { VaultNotFoundError } from "../errors.js";
import {
	getSplitConfigFromVault,
	getVaultBalance,
	detectTokenProgram,
	type SplitConfig,
} from "./helpers.js";
import { closeSplitConfig } from "./instructions.js";
import type {
	CloseResult,
	BlockedReason,
	FailedReason,
} from "./client/types.js";

/**
 * Options for sendCloseSplit
 */
export interface SendCloseSplitOptions {
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
export type { CloseResult, BlockedReason, FailedReason };

/**
 * Close a split and recover rent using HTTP-only RPC.
 *
 * This function is designed for facilitators and servers that:
 * - Don't want to manage WebSocket connections
 * - Have their own confirmation logic
 * - Need simple fire-and-forget execution
 *
 * Uses polling for confirmation instead of WebSocket subscriptions.
 * Rent is automatically returned to the original payer.
 *
 * @example
 * ```typescript
 * import { createSolanaRpc } from "@solana/kit";
 * import { sendCloseSplit } from "@cascade-fyi/splits-sdk/solana";
 * import { toKitSigner } from "@cascade-fyi/splits-sdk/solana/web3-compat";
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const signer = await toKitSigner(keypair);
 *
 * // Close split and recover rent
 * const result = await sendCloseSplit(rpc, signer, vault);
 *
 * if (result.status === "CLOSED") {
 *   console.log(`Split closed! Recovered ${result.rentRecovered} lamports`);
 * } else if (result.status === "ALREADY_CLOSED") {
 *   console.log("Split was already closed");
 * }
 * ```
 */
export async function sendCloseSplit(
	rpc: Rpc<SolanaRpcApi>,
	signer: TransactionSigner,
	vault: Address,
	options: SendCloseSplitOptions = {},
): Promise<CloseResult> {
	const {
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

	// 1. Check if config exists
	let existingConfig: SplitConfig;
	try {
		existingConfig = await getSplitConfigFromVault(rpc, vault);
	} catch (e) {
		if (e instanceof VaultNotFoundError) {
			return { status: "ALREADY_CLOSED" };
		}
		throw e;
	}

	// 2. Validate authority
	if (existingConfig.authority !== signer.address) {
		return {
			status: "BLOCKED",
			reason: "not_authority",
			message: `Not authorized. Split authority is ${existingConfig.authority.slice(0, 4)}...${existingConfig.authority.slice(-4)}, but signer is ${signer.address.slice(0, 4)}...${signer.address.slice(-4)}.`,
		};
	}

	// 3. Check vault empty
	const vaultBalance = await getVaultBalance(rpc, vault);
	if (vaultBalance > 0n) {
		return {
			status: "BLOCKED",
			reason: "vault_not_empty",
			message: `Vault has ${vaultBalance} tokens. Execute the split first to distribute funds before closing.`,
		};
	}

	// 4. Check no unclaimed
	const unclaimedCount = existingConfig.unclaimedAmounts.filter(
		(u) => u.amount > 0n,
	).length;
	const totalUnclaimed =
		existingConfig.unclaimedAmounts.reduce((sum, u) => sum + u.amount, 0n) +
		existingConfig.protocolUnclaimed;

	if (totalUnclaimed > 0n) {
		return {
			status: "BLOCKED",
			reason: "unclaimed_pending",
			message: `${unclaimedCount + (existingConfig.protocolUnclaimed > 0n ? 1 : 0)} recipient(s) have unclaimed funds (${totalUnclaimed} tokens). Execute split to clear before closing.`,
		};
	}

	// 5. Detect token program
	const tokenProgram = await detectTokenProgram(rpc, existingConfig.mint);

	// 6. Build close instruction (rent goes to original rent payer)
	const instruction = await closeSplitConfig(rpc, {
		vault,
		authority: signer.address,
		rentReceiver: existingConfig.rentPayer,
		tokenProgram,
	});

	// 7. Calculate rent to report
	const splitConfigRent = await rpc
		.getMinimumBalanceForRentExemption(BigInt(1832))
		.send();
	const vaultRent = await rpc
		.getMinimumBalanceForRentExemption(BigInt(165))
		.send();
	const rentRecovered = splitConfigRent + vaultRent;

	// 8. Build and send transaction
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
			[instruction],
			buildOptions,
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
					message: confirmResult.error ?? "Transaction confirmation timeout",
				};
			}
		}

		return {
			status: "CLOSED",
			signature,
			rentRecovered,
		};
	} catch (e) {
		const failResult: CloseResult = {
			status: "FAILED",
			reason: "network_error",
			message: e instanceof Error ? e.message : String(e),
		};
		if (e instanceof Error) {
			failResult.error = e;
		}
		return failResult;
	}
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build, sign, and send a transaction via HTTP RPC.
 */
async function buildSignAndSend(
	rpc: Rpc<SolanaRpcApi>,
	signer: TransactionSigner,
	instructions: Instruction[],
	options: {
		computeUnitPrice?: bigint;
		computeUnitLimit?: number;
	},
): Promise<string> {
	const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

	// Build instructions array with compute budget
	const allInstructions: Instruction[] = [];

	if (options.computeUnitLimit !== undefined) {
		allInstructions.push(
			getSetComputeUnitLimitInstruction({ units: options.computeUnitLimit }),
		);
	}

	if (options.computeUnitPrice !== undefined) {
		allInstructions.push(
			getSetComputeUnitPriceInstruction({
				microLamports: options.computeUnitPrice,
			}),
		);
	}

	allInstructions.push(...instructions);

	// Build and sign transaction
	const transactionMessage = pipe(
		createTransactionMessage({ version: 0 }),
		(msg) => setTransactionMessageFeePayerSigner(signer, msg),
		(msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
		(msg) => appendTransactionMessageInstructions(allInstructions, msg),
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
