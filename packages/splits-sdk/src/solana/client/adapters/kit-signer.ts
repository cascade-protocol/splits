/**
 * Kit-native signer adapter
 *
 * Creates a SplitsWallet from a @solana/kit TransactionSigner.
 * Uses kit's sendAndConfirmTransactionFactory for efficient WebSocket-based
 * confirmation - no @solana/web3.js dependencies.
 *
 * @example
 * ```typescript
 * import { createSolanaRpc, createSolanaRpcSubscriptions, createKeyPairSignerFromBytes } from "@solana/kit";
 * import { createSplitsClient, fromKitSigner } from '@cascade-fyi/splits-sdk/solana/client';
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");
 * const signer = await createKeyPairSignerFromBytes(secretKey);
 *
 * const splits = createSplitsClient(rpc, fromKitSigner(signer, rpc, rpcSubscriptions));
 * ```
 */

import type {
	Address,
	Rpc,
	SolanaRpcApi,
	RpcSubscriptions,
	SignatureNotificationsApi,
	SlotNotificationsApi,
	TransactionSigner,
	Signature,
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
	sendAndConfirmTransactionFactory,
	assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import type { SplitsWallet, TransactionMessage } from "../types.js";

/**
 * Create a SplitsWallet from a kit TransactionSigner.
 *
 * This adapter uses @solana/kit's native transaction building and sending,
 * providing efficient WebSocket-based confirmation without any @solana/web3.js
 * dependencies.
 *
 * @param signer - Kit TransactionSigner (e.g., from createKeyPairSignerFromBytes)
 * @param rpc - Solana RPC client
 * @param rpcSubscriptions - Solana RPC subscriptions for confirmation
 * @returns SplitsWallet interface for use with createSplitsClient
 */
export function fromKitSigner(
	signer: TransactionSigner,
	rpc: Rpc<SolanaRpcApi>,
	rpcSubscriptions: RpcSubscriptions<
		SignatureNotificationsApi & SlotNotificationsApi
	>,
): SplitsWallet {
	const address = signer.address as Address;
	const sendAndConfirm = sendAndConfirmTransactionFactory({
		rpc,
		rpcSubscriptions,
	});

	return {
		address,

		signAndSend: async (message: TransactionMessage, options) => {
			const commitment: Commitment = options?.commitment ?? "confirmed";

			// Rebuild the transaction message with the signer attached
			// (buildTransaction returns a simple object, we need proper kit message)
			const transactionMessage = pipe(
				createTransactionMessage({ version: 0 }),
				(msg) => setTransactionMessageFeePayerSigner(signer, msg),
				(msg) =>
					setTransactionMessageLifetimeUsingBlockhash(
						message.lifetimeConstraint,
						msg,
					),
				(msg) =>
					appendTransactionMessageInstructions([...message.instructions], msg),
			);

			// Sign with the signer
			const signedTransaction =
				await signTransactionMessageWithSigners(transactionMessage);

			// Assert blockhash lifetime for type narrowing
			assertIsTransactionWithBlockhashLifetime(signedTransaction);

			// Get signature for return value
			const signature = getSignatureFromTransaction(signedTransaction);

			// Send and confirm using kit (WebSocket-based, efficient)
			const sendOptions: { commitment: Commitment; abortSignal?: AbortSignal } =
				{ commitment };
			if (options?.abortSignal) {
				sendOptions.abortSignal = options.abortSignal;
			}
			await sendAndConfirm(signedTransaction, sendOptions);

			return signature as Signature;
		},
	};
}
