/**
 * Query key factories for TanStack Query integration.
 * Use these to ensure consistent cache key management across your app.
 *
 * @example
 * ```tsx
 * // Invalidate all splits for a user after mutation
 * queryClient.invalidateQueries({
 *   queryKey: splitsQueryKeys.byAuthority(publicKey)
 * });
 *
 * // Prefetch a specific split
 * queryClient.prefetchQuery({
 *   queryKey: splitsQueryKeys.single(vault),
 *   queryFn: () => sdk.getSplit(vault)
 * });
 * ```
 */
export const splitsQueryKeys = {
	/** Base key for all splits queries */
	all: ["splits"] as const,

	/** Splits owned by an authority */
	byAuthority: (authority: string) =>
		["splits", "authority", authority] as const,

	/** Single split by vault address */
	single: (vault: string) => ["splits", "vault", vault] as const,

	/** Vault balance for a split */
	balance: (vault: string) => ["splits", "balance", vault] as const,
} as const;
