/**
 * HTTP-only split creation/update with polling confirmation
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
import { USDC_MINT, SYSTEM_PROGRAM_ID, type Recipient } from "../index.js";
import { VaultNotFoundError } from "../errors.js";
import {
	deriveSplitConfig,
	deriveVault,
	getSplitConfigFromVault,
	getVaultBalance,
	recipientsEqual,
	checkRecipientAtas,
	detectTokenProgram,
	labelToSeed,
	type SplitConfig,
} from "./helpers.js";
import { createSplitConfig, updateSplitConfig } from "./instructions.js";
import type {
	EnsureResult,
	BlockedReason,
	FailedReason,
} from "./client/types.js";

/**
 * Options for sendEnsureSplit
 */
export interface SendEnsureSplitOptions {
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

/**
 * Parameters for sendEnsureSplit
 */
export interface SendEnsureSplitParams {
	/** Recipients with shares (1-100) or percentageBps (1-9900) */
	recipients: Recipient[];
	/** Token mint address (default: USDC) */
	mint?: Address;
	/**
	 * Seed for split derivation. Can be:
	 * - Human-readable label (max 27 chars): "my-split"
	 * - Raw Address: for multiple splits per authority/mint
	 * - Omitted: one split per authority/mint pair
	 */
	seed?: string | Address;
	/** Payer for rent (defaults to signer) */
	payer?: Address;
}

// Re-export types
export type { EnsureResult, BlockedReason, FailedReason };

/**
 * Ensure a split exists with the specified configuration using HTTP-only RPC.
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
 * import { sendEnsureSplit } from "@cascade-fyi/splits-sdk/solana";
 * import { toKitSigner } from "@cascade-fyi/splits-sdk/solana/web3-compat";
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const signer = await toKitSigner(keypair);
 *
 * // Create or update a split (idempotent)
 * const result = await sendEnsureSplit(rpc, signer, {
 *   recipients: [
 *     { address: alice, share: 70 },
 *     { address: bob, share: 29 },
 *   ],
 * });
 *
 * if (result.status === "CREATED") {
 *   console.log(`Split created! Vault: ${result.vault}`);
 * } else if (result.status === "NO_CHANGE") {
 *   console.log(`Split already exists: ${result.vault}`);
 * }
 * ```
 */
export async function sendEnsureSplit(
	rpc: Rpc<SolanaRpcApi>,
	signer: TransactionSigner,
	params: SendEnsureSplitParams,
	options: SendEnsureSplitOptions = {},
): Promise<EnsureResult> {
	const { recipients, mint = USDC_MINT, payer = signer.address } = params;
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

	// Handle seed parameter - can be label string or raw Address
	let seed: Address;
	if (params.seed === undefined) {
		seed = SYSTEM_PROGRAM_ID;
	} else if (isLabel(params.seed)) {
		seed = labelToSeed(params.seed);
	} else {
		seed = params.seed as Address;
	}

	// 1. Derive addresses
	const splitConfigAddress = await deriveSplitConfig(
		signer.address,
		mint,
		seed,
	);
	const tokenProgram = await detectTokenProgram(rpc, mint);
	const vaultAddress = await deriveVault(
		splitConfigAddress,
		mint,
		tokenProgram,
	);

	// 2. Check if config exists
	let existingConfig: SplitConfig | null = null;
	try {
		existingConfig = await getSplitConfigFromVault(rpc, vaultAddress);
	} catch (e) {
		if (!(e instanceof VaultNotFoundError)) throw e;
		// Config doesn't exist, will create
	}

	// 3. Validate recipient ATAs exist
	const missingAtas = await checkRecipientAtas(rpc, recipients, mint);
	if (missingAtas.length > 0) {
		const missingAddresses = missingAtas.map((m) => m.recipient);
		return {
			status: "BLOCKED",
			reason: "recipient_atas_missing",
			message: `Recipients missing token accounts: ${missingAddresses.map((a) => `${a.slice(0, 4)}...${a.slice(-4)}`).join(", ")}. Create ATAs before creating split.`,
		};
	}

	// 4. If exists, check for NO_CHANGE or UPDATE
	if (existingConfig) {
		// Check set equality (order-independent)
		if (recipientsEqual(recipients, existingConfig.recipients)) {
			return {
				status: "NO_CHANGE",
				vault: vaultAddress,
				splitConfig: splitConfigAddress,
			};
		}

		// Check if update is possible
		const vaultBalance = await getVaultBalance(rpc, vaultAddress);
		if (vaultBalance > 0n) {
			return {
				status: "BLOCKED",
				reason: "vault_not_empty",
				message: `Vault has ${vaultBalance} tokens. Execute the split first to distribute funds before updating.`,
			};
		}

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
				message: `${unclaimedCount + (existingConfig.protocolUnclaimed > 0n ? 1 : 0)} recipient(s) have unclaimed funds (${totalUnclaimed} tokens). Execute split to clear before updating.`,
			};
		}

		// Build update instruction
		const instruction = await updateSplitConfig(rpc, {
			vault: vaultAddress,
			authority: signer.address,
			recipients,
			tokenProgram,
		});

		// Build and send transaction
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
				status: "UPDATED",
				vault: vaultAddress,
				splitConfig: splitConfigAddress,
				signature,
			};
		} catch (e) {
			const failResult: EnsureResult = {
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

	// 5. Create new config
	const { instruction } = await createSplitConfig({
		authority: signer.address,
		recipients,
		mint,
		uniqueId: seed,
		tokenProgram,
		payer,
	});

	// Get rent amount for result
	const splitConfigRent = await rpc
		.getMinimumBalanceForRentExemption(BigInt(1832))
		.send();
	const vaultRent = await rpc
		.getMinimumBalanceForRentExemption(BigInt(165))
		.send();
	const rentPaid = splitConfigRent + vaultRent;

	// Build and send transaction
	try {
		// Build options object conditionally to satisfy exactOptionalPropertyTypes
		const createBuildOptions: {
			computeUnitPrice?: bigint;
			computeUnitLimit?: number;
		} = {};
		if (computeUnitPrice !== undefined)
			createBuildOptions.computeUnitPrice = computeUnitPrice;
		if (computeUnitLimit !== undefined)
			createBuildOptions.computeUnitLimit = computeUnitLimit;

		const signature = await buildSignAndSend(
			rpc,
			signer,
			[instruction],
			createBuildOptions,
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
			status: "CREATED",
			vault: vaultAddress,
			splitConfig: splitConfigAddress,
			signature,
			rentPaid,
		};
	} catch (e) {
		const failResult: EnsureResult = {
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
 * Check if a string is a human-readable label (not an Address).
 */
function isLabel(seed: string): boolean {
	if (seed.length > 44) return false;
	if (seed.length <= 27 && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(seed)) {
		return true;
	}
	return false;
}

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
