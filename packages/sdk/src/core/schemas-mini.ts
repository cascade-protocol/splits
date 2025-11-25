/**
 * Zod Mini schemas for Cascade Splits SDK
 * 6.6x smaller bundle size (1.88kb vs 12.47kb gzipped)
 * Use this when bundle size is critical
 */

import * as z from "zod/mini";

/**
 * Share: integer 1-100 (single recipient can have 100%)
 */
const Share = z.number().check(
	z.gte(1),
	z.lte(100),
	z.refine((n) => Number.isInteger(n)),
);

/**
 * Recipient with share
 */
export const ShareRecipientSchema = z.object({
	address: z.string().check(z.minLength(32), z.maxLength(44)),
	share: Share,
});

/**
 * Create split input
 */
export const CreateSplitInputSchema = z.object({
	recipients: z.array(ShareRecipientSchema).check(
		z.minLength(1),
		z.maxLength(20),
		z.refine((r) => r.reduce((sum, x) => sum + x.share, 0) === 100),
		z.refine((r) => {
			const addresses = new Set(r.map((x) => x.address));
			return addresses.size === r.length;
		}),
	),
	token: z.optional(z.string().check(z.minLength(32), z.maxLength(44))),
});

/**
 * Update split input
 */
export const UpdateSplitInputSchema = z.object({
	vault: z.string().check(z.minLength(32), z.maxLength(44)),
	recipients: z.array(ShareRecipientSchema).check(
		z.minLength(1),
		z.maxLength(20),
		z.refine((r) => r.reduce((sum, x) => sum + x.share, 0) === 100),
		z.refine((r) => {
			const addresses = new Set(r.map((x) => x.address));
			return addresses.size === r.length;
		}),
	),
});

// Type inference
export type ShareRecipient = z.infer<typeof ShareRecipientSchema>;
export type CreateSplitInput = z.infer<typeof CreateSplitInputSchema>;
export type UpdateSplitInput = z.infer<typeof UpdateSplitInputSchema>;
