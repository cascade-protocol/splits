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
	status: "FAILED";
	reason: FailedReason;
	message: string;
	error?: Error;
}

/**
 * Convert transaction errors to a FAILED result with actionable messages.
 *
 * @param e - The caught error
 * @returns FailedResult or throws if error is unknown
 */
export function handleTransactionError(e: unknown): FailedResult {
	if (e instanceof WalletRejectedError) {
		return {
			status: "FAILED",
			reason: "wallet_rejected",
			message: walletRejectedMessage(),
			error: e,
		};
	}
	if (e instanceof WalletDisconnectedError) {
		return {
			status: "FAILED",
			reason: "wallet_disconnected",
			message: walletDisconnectedMessage(),
			error: e,
		};
	}
	if (e instanceof Error) {
		const msg = e.message.toLowerCase();
		if (msg.includes("blockhash") || msg.includes("expired")) {
			return {
				status: "FAILED",
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
				status: "FAILED",
				reason: "network_error",
				message: networkErrorMessage(e.message),
				error: e,
			};
		}
		// Generic program error
		return {
			status: "FAILED",
			reason: "program_error",
			message: e.message,
			error: e,
		};
	}
	// Re-throw unknown errors
	throw e;
}
