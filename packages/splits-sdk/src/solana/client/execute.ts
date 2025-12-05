/**
 * execute implementation for the Splits client
 *
 * Execute split distribution with actionable error messages.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { executeSplit } from "../instructions.js";
import {
	getVaultBalanceAndOwner,
	invalidateProtocolConfigCache,
} from "../helpers.js";
import { buildTransaction } from "./buildTransaction.js";
import type {
	SplitsWallet,
	SplitsClientConfig,
	ExecuteOptions,
	ExecuteResult,
} from "./types.js";
import { handleTransactionError } from "./errors.js";

// Program error code for stale protocol config
const INVALID_PROTOCOL_FEE_RECIPIENT = 6004;

/**
 * Execute a split distribution.
 *
 * @internal
 */
export async function executeImpl(
	rpc: Rpc<SolanaRpcApi>,
	wallet: SplitsWallet,
	vault: Address,
	options: ExecuteOptions &
		SplitsClientConfig & {
			computeUnitLimit?: number;
			abortSignal?: AbortSignal;
			_isRetry?: boolean;
		},
): Promise<ExecuteResult> {
	const {
		minBalance,
		commitment = "confirmed",
		computeUnitPrice,
		computeUnitLimit,
		abortSignal,
	} = options;

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
	const result = await executeSplit(rpc, vault, wallet.address, tokenProgram);
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
		// Build transaction with compute budget options
		const buildOptions: {
			computeUnitPrice?: bigint;
			computeUnitLimit?: number;
		} = {};
		if (computeUnitPrice !== undefined) {
			buildOptions.computeUnitPrice = computeUnitPrice;
		}
		if (computeUnitLimit !== undefined) {
			buildOptions.computeUnitLimit = computeUnitLimit;
		}

		const message = await buildTransaction(
			rpc,
			wallet.address,
			[result.instruction],
			Object.keys(buildOptions).length > 0 ? buildOptions : undefined,
		);

		const sendOptions: {
			commitment: typeof commitment;
			abortSignal?: AbortSignal;
		} = { commitment };
		if (abortSignal) sendOptions.abortSignal = abortSignal;

		const signature = await wallet.signAndSend(message, sendOptions);

		return {
			status: "EXECUTED",
			signature,
		};
	} catch (e) {
		// Check for abort
		if (abortSignal?.aborted) {
			return {
				status: "FAILED",
				reason: "transaction_expired",
				message: "Transaction was aborted",
				error: e instanceof Error ? e : new Error(String(e)),
			};
		}

		// Check for stale protocol config error and retry once
		if (
			isProgramError(e, INVALID_PROTOCOL_FEE_RECIPIENT) &&
			!options._isRetry
		) {
			invalidateProtocolConfigCache();
			return executeImpl(rpc, wallet, vault, {
				...options,
				_isRetry: true,
			});
		}

		return handleTransactionError(e);
	}
}

/**
 * Check if an error is a specific program error code.
 */
function isProgramError(e: unknown, expectedCode: number): boolean {
	if (e instanceof Error) {
		const msg = e.message;
		// Check for program error in message (common pattern)
		if (msg.includes(`custom program error: 0x${expectedCode.toString(16)}`)) {
			return true;
		}
		// Check for error code in message
		if (msg.includes(`Error Code: ${expectedCode}`)) {
			return true;
		}
	}
	return false;
}
