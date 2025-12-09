/**
 * Shared error handling utilities for the Splits client
 */

import {
	walletRejectedMessage,
	walletDisconnectedMessage,
	networkErrorMessage,
	transactionExpiredMessage,
} from "./messages.js";
import type { FailedReason } from "./types.js";
import {
	WalletDisconnectedError,
	WalletRejectedError,
} from "./wallet-errors.js";

/**
 * Result for transaction failures
 */
export interface FailedResult {
	status: "failed";
	reason: FailedReason;
	message: string;
	error?: Error;
}

/**
 * Convert transaction errors to a failed result with actionable messages.
 *
 * @param e - The caught error
 * @returns FailedResult or throws if error is unknown
 */
export function handleTransactionError(e: unknown): FailedResult {
	if (e instanceof WalletRejectedError) {
		return {
			status: "failed",
			reason: "wallet_rejected",
			message: walletRejectedMessage(),
			error: e,
		};
	}
	if (e instanceof WalletDisconnectedError) {
		return {
			status: "failed",
			reason: "wallet_disconnected",
			message: walletDisconnectedMessage(),
			error: e,
		};
	}
	if (e instanceof Error) {
		const msg = e.message.toLowerCase();
		if (msg.includes("blockhash") || msg.includes("expired")) {
			return {
				status: "failed",
				reason: "transaction_expired",
				message: transactionExpiredMessage(),
				error: e,
			};
		}
		if (
			msg.includes("network") ||
			msg.includes("fetch") ||
			msg.includes("econnrefused")
		) {
			return {
				status: "failed",
				reason: "network_error",
				message: networkErrorMessage(e.message),
				error: e,
			};
		}
		// Generic program error
		return {
			status: "failed",
			reason: "program_error",
			message: e.message,
			error: e,
		};
	}
	// Re-throw unknown errors
	throw e;
}
