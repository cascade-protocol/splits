/**
 * Wallet Adapter integration for browser environments
 *
 * Converts a wallet from @solana/wallet-adapter-react into a SplitsWallet interface.
 * Works with Phantom, Solflare, Backpack, and other wallet adapters.
 *
 * This adapter converts kit transaction messages to web3.js format for signing.
 *
 * @example
 * ```typescript
 * import { useWallet } from '@solana/wallet-adapter-react';
 * import { useConnection } from '@solana/wallet-adapter-react';
 * import { createSplitsClient } from '@cascade-fyi/splits-sdk/solana/client';
 * import { fromWalletAdapter } from '@cascade-fyi/splits-sdk/solana/web3-compat';
 *
 * function MyComponent() {
 *   const wallet = useWallet();
 *   const { connection } = useConnection();
 *
 *   const splits = createSplitsClient(rpc, fromWalletAdapter(wallet, connection));
 *   // ...
 * }
 * ```
 */

import type {
	Connection,
	Commitment,
	VersionedTransaction,
} from "@solana/web3.js";
import type { Address, Signature } from "@solana/kit";
import type { SplitsWallet } from "../client/types.js";
import {
	WalletDisconnectedError,
	WalletRejectedError,
} from "../client/wallet-errors.js";
import {
	toWeb3Transaction,
	type KitTransactionMessage,
} from "./transactions.js";

// Re-export for convenience (users import from web3-compat)
export { WalletDisconnectedError, WalletRejectedError };

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal interface for wallet adapter compatibility.
 * Matches the shape from @solana/wallet-adapter-react's useWallet().
 */
export interface WalletAdapterLike {
	publicKey: { toBase58(): string } | null;
	connected: boolean;
	signTransaction?:
		| (<T extends VersionedTransaction>(transaction: T) => Promise<T>)
		| undefined;
}

// =============================================================================
// Adapter
// =============================================================================

/**
 * Create a SplitsWallet from a wallet adapter and connection.
 *
 * The adapter converts kit transaction messages to web3.js VersionedTransaction,
 * requests signature from the wallet, and sends via the connection.
 *
 * @param wallet - Wallet from useWallet() hook
 * @param connection - Solana RPC connection
 * @returns SplitsWallet interface for use with createSplitsClient
 * @throws Error if wallet is not connected or doesn't support signing
 */
export function fromWalletAdapter(
	wallet: WalletAdapterLike,
	connection: Connection,
): SplitsWallet {
	if (!wallet.publicKey) {
		throw new Error("Wallet not connected. Please connect your wallet first.");
	}
	if (!wallet.signTransaction) {
		throw new Error(
			"Wallet does not support transaction signing. Please use a compatible wallet.",
		);
	}

	const address = wallet.publicKey.toBase58() as Address;
	const signTransaction = wallet.signTransaction;

	return {
		address,

		signAndSend: async (message, options) => {
			const commitment: Commitment = options?.commitment ?? "confirmed";
			const abortSignal = options?.abortSignal;

			// Check abort before starting
			if (abortSignal?.aborted) {
				throw new Error("Transaction aborted");
			}

			// Check wallet still connected before signing
			if (!wallet.connected) {
				throw new WalletDisconnectedError();
			}

			// Convert kit transaction message to web3.js VersionedTransaction
			const transaction = toWeb3Transaction(message as KitTransactionMessage);

			let signed: VersionedTransaction;
			try {
				signed = await signTransaction(transaction);
			} catch (e) {
				if (isUserRejection(e)) {
					throw new WalletRejectedError();
				}
				throw e;
			}

			// Check abort after signing
			if (abortSignal?.aborted) {
				throw new Error("Transaction aborted");
			}

			// Check again after signing (user might disconnect during signing)
			if (!wallet.connected) {
				throw new WalletDisconnectedError();
			}

			// Send to network
			const signature = await connection.sendRawTransaction(
				signed.serialize(),
				{
					skipPreflight: false,
					preflightCommitment: commitment,
				},
			);

			// Check abort after sending
			if (abortSignal?.aborted) {
				throw new Error("Transaction aborted");
			}

			// Confirm with blockhash strategy
			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash(commitment);

			const confirmStrategy: {
				signature: string;
				blockhash: string;
				lastValidBlockHeight: number;
				abortSignal?: AbortSignal;
			} = { signature, blockhash, lastValidBlockHeight };
			if (abortSignal) confirmStrategy.abortSignal = abortSignal;

			await connection.confirmTransaction(confirmStrategy, commitment);

			return signature as Signature;
		},
	};
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Detect if an error is a user rejection from wallet UI.
 */
function isUserRejection(e: unknown): boolean {
	if (e instanceof Error) {
		const msg = e.message.toLowerCase();
		return (
			msg.includes("user rejected") ||
			msg.includes("user denied") ||
			msg.includes("cancelled") ||
			msg.includes("canceled") ||
			msg.includes("rejected the request") ||
			msg.includes("user refused")
		);
	}
	return false;
}
