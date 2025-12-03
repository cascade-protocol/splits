/**
 * Cascade Splits SDK
 *
 * Types, constants, and helpers for the Cascade Splits payment splitter.
 *
 * @example
 * ```typescript
 * // Types and helpers
 * import { type Recipient, sharesToBps, bpsToShares } from '@cascade-fyi/splits-sdk';
 *
 * // Solana instructions
 * import { createSplitConfig, executeSplit } from '@cascade-fyi/splits-sdk/solana';
 *
 * // Using share (1-100, user-friendly)
 * const recipients: Recipient[] = [
 *   { address: "alice...", share: 60 },
 *   { address: "bob...", share: 40 }
 * ];
 *
 * // Or using percentageBps directly (advanced)
 * const recipientsAdvanced: Recipient[] = [
 *   { address: "alice...", percentageBps: 5940 },
 *   { address: "bob...", percentageBps: 3960 }
 * ];
 * ```
 */

import type { Address } from "@solana/kit";
import { InvalidRecipientsError } from "./errors.js";

// =============================================================================
// Constants
// =============================================================================

/** Program ID for Cascade Splits */
export const PROGRAM_ID: Address =
	"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address;

/** Maximum recipients per split (protocol limit) */
export const MAX_RECIPIENTS = 20;

/** Protocol fee in basis points (1% = 100 bps) */
export const PROTOCOL_FEE_BPS = 100;

/** Total basis points for all recipients (99% = 9900 bps) */
export const TOTAL_RECIPIENT_BPS = 9900;

/** SPL Token program ID */
export const TOKEN_PROGRAM_ID: Address =
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

/** SPL Token 2022 program ID */
export const TOKEN_2022_PROGRAM_ID: Address =
	"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;

/** Associated Token Account program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID: Address =
	"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;

/** System program ID */
export const SYSTEM_PROGRAM_ID: Address =
	"11111111111111111111111111111111" as Address;

/** Default USDC mint (mainnet) */
export const USDC_MINT: Address =
	"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;

// PDA Seeds
export const PROTOCOL_CONFIG_SEED = "protocol_config";
export const SPLIT_CONFIG_SEED = "split_config";

// =============================================================================
// Types
// =============================================================================

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
export interface Recipient {
	address: string;
	/** Share percentage 1-100 (converted to bps: share × 99) */
	share?: number;
	/** Raw basis points 1-9900 (for advanced usage) */
	percentageBps?: number;
}

// =============================================================================
// Conversion Helpers
// =============================================================================

/**
 * Convert user-facing share (1-100) to protocol basis points.
 * Each share point = 99 bps (total 9900 bps for 100 shares)
 */
export function sharesToBps(share: number): number {
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
export function bpsToShares(bps: number): number {
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
		return sharesToBps(r.share);
	}
	throw new InvalidRecipientsError(
		"Recipient must have either share or percentageBps",
	);
}

// =============================================================================
// Utilities
// =============================================================================

export { generateUniqueId } from "./solana/helpers.js";

// =============================================================================
// Errors
// =============================================================================

export * from "./errors.js";
