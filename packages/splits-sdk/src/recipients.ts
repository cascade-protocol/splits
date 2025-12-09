/**
 * Recipient types and conversion utilities
 *
 * Separated to avoid circular imports - internal code imports from here,
 * index.ts re-exports for public API.
 */

import { InvalidRecipientsError } from "./errors.js";

/**
 * Recipient input for creating/updating splits.
 *
 * Provide either `share` (1-100) or `percentageBps` (1-9900).
 *
 * @example
 * ```typescript
 * // User-friendly: share (1-100)
 * { address: "...", share: 60 }
 *
 * // Advanced: exact basis points
 * { address: "...", percentageBps: 5940 }
 * ```
 */
export type Recipient = {
	address: string;
} & (
	| {
			/** Share percentage 1-100 (converted to bps: share × 99) */
			share: number;
			percentageBps?: never;
	  }
	| {
			/** Raw basis points 1-9900 (for advanced usage) */
			percentageBps: number;
			share?: never;
	  }
);

/**
 * Convert user-facing share (1-100) to protocol basis points.
 * Each share point = 99 bps (total 9900 bps for 100 shares)
 */
export function shareToPercentageBps(share: number): number {
	if (!Number.isInteger(share) || share < 1 || share > 100) {
		throw new InvalidRecipientsError(
			`Share must be integer 1-100, got ${share}`,
		);
	}
	return share * 99;
}

/**
 * Convert protocol basis points to user-facing share (1-100).
 */
export function percentageBpsToShares(bps: number): number {
	return Math.round(bps / 99);
}

/**
 * Get percentageBps from a Recipient (handles both share and percentageBps).
 */
export function toPercentageBps(r: Recipient): number {
	if (r.percentageBps !== undefined) {
		if (
			!Number.isInteger(r.percentageBps) ||
			r.percentageBps < 1 ||
			r.percentageBps > 9900
		) {
			throw new InvalidRecipientsError(
				`percentageBps must be integer 1-9900, got ${r.percentageBps}`,
			);
		}
		return r.percentageBps;
	}
	if (r.share !== undefined) {
		return shareToPercentageBps(r.share);
	}
	throw new InvalidRecipientsError(
		"Recipient must have either share or percentageBps",
	);
}
