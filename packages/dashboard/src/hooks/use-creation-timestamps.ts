import { useSolanaClient } from "@solana/react-hooks";
import { useState, useEffect } from "react";
import type { Address } from "@solana/kit";
import type { SplitWithBalance } from "./use-splits";

/**
 * Hook to fetch creation timestamps for splits.
 * Fetches oldest transaction signature for each split.
 */
export function useCreationTimestamps(splits: SplitWithBalance[]) {
	const client = useSolanaClient();
	const rpc = client.runtime.rpc;
	const [timestamps, setTimestamps] = useState<Map<string, bigint | null>>(
		new Map(),
	);
	const [isLoading, setIsLoading] = useState(false);

	useEffect(() => {
		if (splits.length === 0) return;

		const fetchTimestamps = async () => {
			setIsLoading(true);
			const entries = await Promise.all(
				splits.map(async (split) => {
					try {
						const sigs = await rpc
							.getSignaturesForAddress(split.address as Address, {
								limit: 1000,
							})
							.send();
						if (sigs.length === 0) return [split.address, null] as const;
						const oldest = sigs[sigs.length - 1];
						return [
							split.address,
							oldest.blockTime ? BigInt(oldest.blockTime) : null,
						] as const;
					} catch {
						return [split.address, null] as const;
					}
				}),
			);
			setTimestamps(new Map(entries));
			setIsLoading(false);
		};

		fetchTimestamps();
	}, [rpc, splits]);

	return { timestamps, isLoading };
}
