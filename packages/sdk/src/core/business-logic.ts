/**
 * Business logic for Cascade Splits SDK
 * Handles share conversion and distribution calculations
 */

import {
	CreateSplitInputSchema,
	UpdateSplitInputSchema,
	type ShareRecipient,
	formatZodError,
} from "./schemas.js";
import { ZodError } from "zod";

/**
 * Internal recipient format used by the protocol
 */
export interface ProtocolRecipient {
	address: string;
	percentageBps: number;
}

/**
 * Processed create split input ready for the protocol
 */
export interface ProcessedCreateSplit {
	recipients: ProtocolRecipient[];
	token: string;
}

/**
 * Processed update split input ready for the protocol
 */
export interface ProcessedUpdateSplit {
	vault: string;
	recipients: ProtocolRecipient[];
}

/**
 * Distribution preview for a single recipient
 */
export interface RecipientDistribution {
	address: string;
	amount: bigint;
	share: number;
}

/**
 * Convert user-facing share (1-100) to protocol basis points.
 * Formula: share * 99 = bps
 * Examples:
 *   60 -> 5940 bps (59.40%)
 *   40 -> 3960 bps (39.60%)
 *   Total: 9900 bps (99%)
 */
export function sharesToBasisPoints(share: number): number {
	if (!Number.isInteger(share)) {
		throw new Error(`Share must be an integer, got ${share}`);
	}
	if (share < 1 || share > 99) {
		throw new Error(`Share must be between 1-99, got ${share}`);
	}
	return share * 99;
}

/**
 * Convert protocol basis points back to user-facing share.
 * Formula: Math.round(bps / 99) = share
 */
export function basisPointsToShares(bps: number): number {
	if (!Number.isInteger(bps)) {
		throw new Error(`Basis points must be an integer, got ${bps}`);
	}
	return Math.round(bps / 99);
}

/**
 * Validate and transform create split input from user format to protocol format.
 * Throws ZodError if validation fails.
 */
export function validateAndTransformCreate(
	input: unknown,
): ProcessedCreateSplit {
	try {
		const validated = CreateSplitInputSchema.parse(input);

		return {
			token: validated.token,
			recipients: validated.recipients.map((r) => ({
				address: r.address,
				percentageBps: sharesToBasisPoints(r.share),
			})),
		};
	} catch (error) {
		if (error instanceof ZodError) {
			throw new Error(`Validation failed: ${formatZodError(error)}`);
		}
		throw error;
	}
}

/**
 * Validate and transform update split input from user format to protocol format.
 * Throws ZodError if validation fails.
 */
export function validateAndTransformUpdate(
	input: unknown,
): ProcessedUpdateSplit {
	try {
		const validated = UpdateSplitInputSchema.parse(input);

		return {
			vault: validated.vault,
			recipients: validated.recipients.map((r) => ({
				address: r.address,
				percentageBps: sharesToBasisPoints(r.share),
			})),
		};
	} catch (error) {
		if (error instanceof ZodError) {
			throw new Error(`Validation failed: ${formatZodError(error)}`);
		}
		throw error;
	}
}

/**
 * Calculate distribution amounts using bulletproof integer-only math.
 * Last recipient gets any rounding dust to ensure no tokens are lost.
 *
 * @param totalAmount - Total amount to distribute (before protocol fee)
 * @param recipients - Recipients with their shares (must sum to 100)
 * @returns Array of distributions with exact amounts
 */
export function calculateDistribution(
	totalAmount: bigint,
	recipients: ShareRecipient[],
): RecipientDistribution[] {
	if (recipients.length === 0) {
		throw new Error("At least one recipient required");
	}

	// Validate shares sum to 100
	const totalShares = recipients.reduce((sum, r) => sum + r.share, 0);
	if (totalShares !== 100) {
		throw new Error(`Shares must sum to 100, got ${totalShares}`);
	}

	// Calculate 99% of total (protocol takes 1%)
	const distributableAmount = (totalAmount * 9900n) / 10000n;

	const distributions: RecipientDistribution[] = [];
	let distributed = 0n;

	// Process all but last recipient
	for (let i = 0; i < recipients.length - 1; i++) {
		const recipient = recipients[i];
		if (!recipient) continue;

		const bps = BigInt(sharesToBasisPoints(recipient.share));
		const amount = (totalAmount * bps) / 10000n;

		distributions.push({
			address: recipient.address,
			amount,
			share: recipient.share,
		});

		distributed += amount;
	}

	// Last recipient gets remainder (handles rounding dust)
	const lastRecipient = recipients[recipients.length - 1];
	if (!lastRecipient) {
		throw new Error("Recipients array unexpectedly empty");
	}

	const remaining = distributableAmount - distributed;
	distributions.push({
		address: lastRecipient.address,
		amount: remaining,
		share: lastRecipient.share,
	});

	return distributions;
}

/**
 * Calculate what each recipient would receive from a given vault balance.
 * This is a preview only - actual execution may differ if balance changes.
 */
export function previewDistribution(
	vaultBalance: bigint,
	recipients: ShareRecipient[],
): {
	distributions: RecipientDistribution[];
	protocolFee: bigint;
	total: bigint;
} {
	const distributions = calculateDistribution(vaultBalance, recipients);

	const totalToRecipients = distributions.reduce(
		(sum, d) => sum + d.amount,
		0n,
	);
	const protocolFee = (vaultBalance * 100n) / 10000n; // 1%

	return {
		distributions,
		protocolFee,
		total: totalToRecipients + protocolFee,
	};
}
