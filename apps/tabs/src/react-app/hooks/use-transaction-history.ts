/**
 * Transaction history hook for Cascade Tabs.
 *
 * Uses TanStack Query infinite query for pagination support.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchTransactionHistory } from "@/lib/helius";
import {
	parseTransaction,
	type ParsedTransaction,
} from "@/lib/transaction-parser";

export interface UseTransactionHistoryReturn {
	transactions: ParsedTransaction[];
	isLoading: boolean;
	error: Error | null;
	hasNextPage: boolean;
	fetchNextPage: () => void;
	isFetchingNextPage: boolean;
}

export function useTransactionHistory(
	vaultAtaAddress: string | undefined,
	vaultOwnerAddress: string | undefined,
): UseTransactionHistoryReturn {
	const query = useInfiniteQuery({
		queryKey: ["tx-history", vaultAtaAddress],
		queryFn: async ({ pageParam }) => {
			if (!vaultAtaAddress || !vaultOwnerAddress) {
				return { data: [] as ParsedTransaction[], paginationToken: undefined };
			}

			// Fetch by ATA address (direct participant in SPL transfers)
			const result = await fetchTransactionHistory(vaultAtaAddress, {
				limit: 20,
				paginationToken: pageParam,
			});

			// Parse with owner address (for balance change detection)
			const parsed = result.data.map((tx) =>
				parseTransaction(tx, vaultOwnerAddress),
			);

			return { data: parsed, paginationToken: result.paginationToken };
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.paginationToken,
		enabled: !!vaultAtaAddress && !!vaultOwnerAddress,
		staleTime: 60_000, // 1 minute
	});

	const transactions = query.data?.pages.flatMap((p) => p.data) ?? [];

	return {
		transactions,
		isLoading: query.isLoading,
		error: query.error as Error | null,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
	};
}
