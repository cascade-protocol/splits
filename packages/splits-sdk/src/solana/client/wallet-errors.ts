/**
 * Wallet-related error classes
 *
 * These are plain error classes that don't depend on @solana/web3.js.
 * Used by both the core client and web3-compat adapters.
 */

/**
 * Thrown when the wallet disconnects during an operation.
 */
export class WalletDisconnectedError extends Error {
	constructor() {
		super("Wallet disconnected. Please reconnect and try again.");
		this.name = "WalletDisconnectedError";
	}
}

/**
 * Thrown when the user rejects a transaction in their wallet.
 */
export class WalletRejectedError extends Error {
	constructor() {
		super("Transaction rejected by user. Please approve to continue.");
		this.name = "WalletRejectedError";
	}
}
