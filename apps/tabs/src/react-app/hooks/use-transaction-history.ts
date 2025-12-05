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
	vaultAddress: string | undefined,
): UseTransactionHistoryReturn {
	const query = useInfiniteQuery({
		queryKey: ["tx-history", vaultAddress],
		queryFn: async ({ pageParam }) => {
			if (!vaultAddress) {
				return { data: [] as ParsedTransaction[], paginationToken: undefined };
			}

			const result = await fetchTransactionHistory(vaultAddress, {
				limit: 20,
				paginationToken: pageParam,
			});

			const parsed = result.data.map((tx) =>
				parseTransaction(tx, vaultAddress),
			);

			return { data: parsed, paginationToken: result.paginationToken };
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.paginationToken,
		enabled: !!vaultAddress,
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
