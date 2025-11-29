import { useConnection } from "@solana/wallet-adapter-react";
import { useQueries } from "@tanstack/react-query";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { SplitWithBalance } from "./use-splits";

/**
 * Fetch creation timestamp for a split by getting oldest transaction signature.
 * Returns blockTime of the creation transaction.
 */
async function fetchCreationTimestamp(
	connection: Connection,
	splitConfigAddress: string,
): Promise<bigint | null> {
	try {
		// Fetch signatures - returned newest first
		const signatures = await connection.getSignaturesForAddress(
			new PublicKey(splitConfigAddress),
			{ limit: 1000 },
		);

		if (signatures.length === 0) return null;

		// Last signature in array is oldest (creation tx)
		const oldest = signatures[signatures.length - 1];
		return oldest.blockTime ? BigInt(oldest.blockTime) : null;
	} catch {
		return null;
	}
}

/**
 * Hook to fetch creation timestamps for splits.
 * Uses parallel queries with aggressive caching (timestamps never change).
 */
export function useCreationTimestamps(splits: SplitWithBalance[]) {
	const { connection } = useConnection();

	const queries = useQueries({
		queries: splits.map((split) => ({
			queryKey: ["creationTimestamp", split.address],
			queryFn: () => fetchCreationTimestamp(connection, split.address),
			staleTime: Number.POSITIVE_INFINITY, // Never refetch - timestamps are immutable
			gcTime: 1000 * 60 * 60 * 24 * 7, // Cache for 7 days
			enabled: !!split.address,
		})),
	});

	// Build map of address -> timestamp
	const timestamps = new Map<string, bigint | null>();
	splits.forEach((split, i) => {
		timestamps.set(split.address, queries[i].data ?? null);
	});

	return {
		timestamps,
		isLoading: queries.some((q) => q.isLoading),
	};
}
