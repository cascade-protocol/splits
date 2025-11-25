/**
 * Query hooks for fetching splits data.
 * Require @tanstack/react-query and @solana/wallet-adapter-react as peer dependencies.
 */

import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSplitsContext } from "../context.js";
import { splitsQueryKeys } from "../query-keys.js";
import type { SplitWithBalance, SplitConfig } from "../../core/types.js";

/**
 * Fetch all splits owned by the connected wallet.
 * Automatically refetches when wallet changes.
 *
 * @example
 * ```tsx
 * function SplitsList() {
 *   const { data: splits, isLoading, error } = useSplits();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <ul>
 *       {splits?.map(split => (
 *         <li key={split.vault}>{split.vault}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useSplits() {
	const sdk = useSplitsContext();
	const { publicKey } = useWallet();

	return useQuery<SplitWithBalance[]>({
		queryKey: splitsQueryKeys.byAuthority(publicKey?.toBase58() ?? ""),
		queryFn: () => {
			if (!publicKey) throw new Error("Wallet not connected");
			return sdk.getSplitsByAuthority(publicKey.toBase58());
		},
		enabled: !!publicKey,
	});
}

/**
 * Fetch a single split by vault address.
 *
 * @param vault - Vault address
 *
 * @example
 * ```tsx
 * function SplitDetails({ vault }: { vault: string }) {
 *   const { data: split, isLoading } = useSplit(vault);
 *   // ...
 * }
 * ```
 */
export function useSplit(vault: string) {
	const sdk = useSplitsContext();

	return useQuery<SplitConfig>({
		queryKey: splitsQueryKeys.single(vault),
		queryFn: () => sdk.getSplit(vault),
		enabled: !!vault,
	});
}

/**
 * Fetch vault balance for a split.
 *
 * @param vault - Vault address
 */
export function useVaultBalance(vault: string) {
	const sdk = useSplitsContext();

	return useQuery<bigint>({
		queryKey: splitsQueryKeys.balance(vault),
		queryFn: () => sdk.getVaultBalance(vault),
		enabled: !!vault,
	});
}
