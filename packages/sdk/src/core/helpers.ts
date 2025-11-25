/**
 * State inspection helpers for SplitConfig
 * Common utilities for checking split state in UIs
 */

import type { SplitConfig } from "./types.js";

/**
 * Check if a split has any unclaimed amounts (recipient or protocol).
 * Returns true if there are unclaimed funds that need to be distributed.
 */
export function hasUnclaimedAmounts(split: SplitConfig): boolean {
	return split.unclaimedAmounts.length > 0 || split.protocolUnclaimed > 0n;
}

/**
 * Get total unclaimed amount in base units (sum of recipient + protocol unclaimed).
 */
export function getTotalUnclaimed(split: SplitConfig): bigint {
	const recipientUnclaimed = split.unclaimedAmounts.reduce(
		(sum, item) => sum + item.amount,
		0n,
	);
	return recipientUnclaimed + split.protocolUnclaimed;
}

/**
 * Check if a split can be updated or closed.
 * Requires vault to be empty and no unclaimed amounts.
 */
export function canUpdateOrClose(
	split: SplitConfig,
	vaultBalance: bigint,
): boolean {
	return vaultBalance === 0n && !hasUnclaimedAmounts(split);
}
