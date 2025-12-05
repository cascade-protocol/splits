/**
 * Transaction parser for Cascade Tabs.
 *
 * Detects transaction types by analyzing token balance changes
 * and log messages from Helius transaction data.
 */

import type { HeliusTransaction } from "./helius";
import { PROGRAM_ID, USDC_MINT } from "./squads";

export type ParsedTxType =
	| "deposit"
	| "withdraw"
	| "set_limit"
	| "revoke_limit"
	| "api_spend"
	| "unknown";

export interface ParsedTransaction {
	signature: string;
	type: ParsedTxType;
	timestamp: Date;
	/** USDC amount if applicable (in base units) */
	amount?: bigint;
	/** SOL fee in lamports */
	fee: number;
}

/**
 * Parse a Helius transaction into a user-friendly format.
 */
export function parseTransaction(
	tx: HeliusTransaction,
	vaultAddress: string,
): ParsedTransaction {
	const base: ParsedTransaction = {
		signature: tx.transaction.signatures[0],
		type: "unknown",
		timestamp: new Date(tx.blockTime * 1000),
		fee: tx.meta.fee,
	};

	// Find USDC balance changes for the vault
	const vaultUsdcChange = getUsdcBalanceChange(tx, vaultAddress);

	// Check for Squads program instructions
	const hasSquadsIx = tx.transaction.message.instructions.some(
		(ix) => ix.programId === PROGRAM_ID,
	);

	const logs = tx.meta.logMessages ?? [];
	const logStr = logs.join("\n");

	// Detect transaction type based on balance changes and instructions

	// Positive balance change = deposit
	if (vaultUsdcChange > 0n) {
		return { ...base, type: "deposit", amount: vaultUsdcChange };
	}

	// Negative balance change = withdraw or API spend
	if (vaultUsdcChange < 0n) {
		// Check if it's an API spend (UseSpendingLimit instruction)
		const isApiSpend = logStr.includes("UseSpendingLimit");
		return {
			...base,
			type: isApiSpend ? "api_spend" : "withdraw",
			amount: -vaultUsdcChange,
		};
	}

	// No balance change - check for spending limit operations
	if (hasSquadsIx) {
		if (logStr.includes("AddSpendingLimit")) {
			return { ...base, type: "set_limit" };
		}
		if (logStr.includes("RemoveSpendingLimit")) {
			return { ...base, type: "revoke_limit" };
		}
	}

	return base;
}

/**
 * Calculate USDC balance change for an owner address.
 */
function getUsdcBalanceChange(tx: HeliusTransaction, owner: string): bigint {
	const pre = tx.meta.preTokenBalances?.find(
		(b) => b.owner === owner && b.mint === USDC_MINT,
	);
	const post = tx.meta.postTokenBalances?.find(
		(b) => b.owner === owner && b.mint === USDC_MINT,
	);

	const preAmount = BigInt(pre?.uiTokenAmount?.amount ?? "0");
	const postAmount = BigInt(post?.uiTokenAmount?.amount ?? "0");

	return postAmount - preAmount;
}
