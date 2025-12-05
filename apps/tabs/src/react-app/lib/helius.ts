/**
 * Helius API integration for transaction history.
 *
 * Uses getTransactionsForAddress to fetch vault transaction history.
 */

const HELIUS_RPC = import.meta.env.VITE_MAINNET_RPC;

/**
 * Helius full transaction response structure.
 * Note: signature is in transaction.signatures[0], not at root level.
 */
export interface HeliusTransaction {
	slot: number;
	blockTime: number;
	transaction: {
		signatures: string[];
		message: {
			accountKeys: Array<{
				pubkey: string;
				signer: boolean;
				writable: boolean;
			}>;
			instructions: Array<{
				programId: string;
				accounts: string[];
				data: string;
				parsed?: { type: string; info: Record<string, unknown> };
			}>;
		};
	};
	meta: {
		err: unknown;
		fee: number;
		preTokenBalances: TokenBalance[];
		postTokenBalances: TokenBalance[];
		logMessages: string[];
	};
}

interface TokenBalance {
	accountIndex: number;
	mint: string;
	owner: string;
	uiTokenAmount: { amount: string; decimals: number; uiAmount: number };
}

export interface TransactionHistoryResult {
	data: HeliusTransaction[];
	paginationToken?: string;
}

/**
 * Fetch transaction history for an address using Helius getTransactionsForAddress.
 * Requires Helius RPC endpoint (Developer plan for best results).
 */
export async function fetchTransactionHistory(
	vaultAddress: string,
	options?: { limit?: number; paginationToken?: string },
): Promise<TransactionHistoryResult> {
	const response = await fetch(HELIUS_RPC, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "getTransactionsForAddress",
			params: [
				vaultAddress,
				{
					transactionDetails: "full",
					sortOrder: "desc",
					limit: options?.limit ?? 50,
					encoding: "jsonParsed",
					maxSupportedTransactionVersion: 0,
					filters: { status: "succeeded" },
					...(options?.paginationToken && {
						paginationToken: options.paginationToken,
					}),
				},
			],
		}),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: Failed to fetch transactions`);
	}

	const json = await response.json();

	if (json.error) {
		throw new Error(json.error.message || "Failed to fetch transactions");
	}

	return json.result ?? { data: [], paginationToken: undefined };
}
