/**
 * Transaction building utilities for the Splits client
 *
 * Kit-native transaction builder using @solana/kit's pipe() pattern.
 * No @solana/web3.js imports - adapters handle conversion when needed.
 */

import type { Rpc, SolanaRpcApi, Instruction, Address } from "@solana/kit";
import {
	getSetComputeUnitLimitInstruction,
	getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import type { TransactionMessage } from "./types.js";

/**
 * Options for building a transaction
 */
export interface BuildTransactionOptions {
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
	/** Compute unit limit (optional, lets runtime determine if not set) */
	computeUnitLimit?: number;
}

/**
 * Build a transaction message from @solana/kit instructions.
 *
 * Returns a kit-native transaction message that can be passed to
 * SplitsWallet.signAndSend(). Adapters handle conversion to
 * @solana/web3.js format when needed.
 *
 * @param rpc - Solana RPC client for fetching blockhash
 * @param feePayer - Address of the fee payer
 * @param instructions - Array of @solana/kit Instruction objects
 * @param options - Optional compute budget settings
 * @returns TransactionMessage ready for signing
 */
export async function buildTransaction(
	rpc: Rpc<SolanaRpcApi>,
	feePayer: Address,
	instructions: Instruction[],
	options?: BuildTransactionOptions,
): Promise<TransactionMessage> {
	const {
		value: { blockhash, lastValidBlockHeight },
	} = await rpc.getLatestBlockhash().send();

	const allInstructions: Instruction[] = [];

	// Add compute unit limit if specified
	if (options?.computeUnitLimit !== undefined) {
		allInstructions.push(
			getSetComputeUnitLimitInstruction({ units: options.computeUnitLimit }),
		);
	}

	// Add priority fee if specified
	if (options?.computeUnitPrice !== undefined) {
		allInstructions.push(
			getSetComputeUnitPriceInstruction({
				microLamports: options.computeUnitPrice,
			}),
		);
	}

	// Add the main instructions
	allInstructions.push(...instructions);

	// Return the transaction message structure
	return {
		feePayer,
		instructions: allInstructions,
		lifetimeConstraint: {
			blockhash,
			lastValidBlockHeight,
		},
	};
}
