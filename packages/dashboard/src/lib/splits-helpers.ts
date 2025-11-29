import { PROTOCOL_FEE_BPS, bpsToShares } from "@cascade-fyi/splits-sdk";
import type { SplitWithBalance } from "../hooks/use-splits";

// =============================================================================
// Constants
// =============================================================================

/** USDC decimals (mainnet) */
export const USDC_DECIMALS = 6;

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format token balance for display.
 */
export function formatBalance(amount: bigint): string {
	const value = Number(amount) / 10 ** USDC_DECIMALS;
	if (value === 0) return "0.00 USDC";
	if (value < 0.01) return "< 0.01 USDC";
	return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

// =============================================================================
// Split State Helpers
// =============================================================================

/**
 * Check if splitConfig has any unclaimed amounts (recipients or protocol).
 */
export function hasUnclaimedAmounts(splitConfig: SplitWithBalance): boolean {
	const hasRecipientUnclaimed = splitConfig.unclaimedAmounts.some(
		(u) => u.amount > 0n,
	);
	return hasRecipientUnclaimed || splitConfig.protocolUnclaimed > 0n;
}

/**
 * Get total unclaimed amount across all recipients + protocol.
 */
export function getTotalUnclaimed(splitConfig: SplitWithBalance): bigint {
	const recipientUnclaimed = splitConfig.unclaimedAmounts.reduce(
		(sum: bigint, u) => sum + u.amount,
		0n,
	);
	return recipientUnclaimed + splitConfig.protocolUnclaimed;
}

/**
 * Check if splitConfig can be updated or closed.
 * Requires empty vault and no unclaimed amounts.
 */
export function canUpdateOrClose(
	splitConfig: SplitWithBalance,
	vaultBalance: bigint,
): boolean {
	return vaultBalance === 0n && !hasUnclaimedAmounts(splitConfig);
}

// =============================================================================
// Distribution Preview
// =============================================================================

export interface DistributionPreview {
	distributions: Array<{ address: string; amount: bigint; share: number }>;
	protocolFee: bigint;
}

/**
 * Calculate distribution preview for a given vault balance.
 * Uses same math as on-chain: (amount * percentageBps) / 10000
 */
export function previewDistribution(
	vaultBalance: bigint,
	recipients: Array<{ address: string; percentageBps: number }>,
): DistributionPreview {
	const protocolFee = (vaultBalance * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
	const distributable = vaultBalance - protocolFee;
	const distributions = recipients.map((r) => ({
		address: r.address as string,
		amount: (distributable * BigInt(r.percentageBps)) / 10000n,
		share: bpsToShares(r.percentageBps),
	}));
	return { distributions, protocolFee };
}
