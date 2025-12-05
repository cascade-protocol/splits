/**
 * Transaction conversion utilities for web3.js compatibility
 *
 * Converts @solana/kit transaction messages to @solana/web3.js VersionedTransaction.
 * Used by adapters that need to interact with web3.js-based wallets.
 */

import {
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import type { Address, Instruction } from "@solana/kit";
import { toWeb3Instruction } from "./index.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Kit transaction message structure (result of pipe() with transaction builders).
 *
 * This represents the unsigned transaction message built using @solana/kit's
 * functional pipeline: createTransactionMessage → setTransactionMessageFeePayerSigner
 * → setTransactionMessageLifetimeUsingBlockhash → appendTransactionMessageInstructions
 *
 * The actual kit type is deeply nested generics, so we use duck typing for
 * the properties we need to extract.
 */
export interface KitTransactionMessage {
	/** Fee payer address (set via setTransactionMessageFeePayerSigner) */
	readonly feePayer: Address;

	/** Transaction instructions (set via appendTransactionMessageInstructions) */
	readonly instructions: readonly Instruction[];

	/**
	 * Blockhash lifetime constraint (set via setTransactionMessageLifetimeUsingBlockhash)
	 */
	readonly lifetimeConstraint: {
		readonly blockhash: string;
		readonly lastValidBlockHeight: bigint;
	};
}

// =============================================================================
// Conversion
// =============================================================================

/**
 * Convert a @solana/kit transaction message to a @solana/web3.js VersionedTransaction.
 *
 * This function extracts the fee payer, blockhash, and instructions from a kit
 * transaction message and reconstructs it as a web3.js VersionedTransaction.
 *
 * Used by wallet adapters (fromWalletAdapter, fromKeypair) that need to pass
 * transactions to web3.js-based signing APIs.
 *
 * @example
 * ```typescript
 * // In adapter signAndSend:
 * const web3Tx = toWeb3Transaction(kitMessage);
 * const signed = await wallet.signTransaction(web3Tx);
 * await connection.sendTransaction(signed);
 * ```
 */
export function toWeb3Transaction(
	message: KitTransactionMessage,
): VersionedTransaction {
	// Convert kit instructions to web3.js format
	const web3Instructions = message.instructions.map(toWeb3Instruction);

	// Build TransactionMessage (web3.js)
	const txMessage = new TransactionMessage({
		payerKey: new PublicKey(message.feePayer),
		recentBlockhash: message.lifetimeConstraint.blockhash,
		instructions: web3Instructions,
	});

	// Compile to V0 and create VersionedTransaction (unsigned)
	return new VersionedTransaction(txMessage.compileToV0Message());
}
