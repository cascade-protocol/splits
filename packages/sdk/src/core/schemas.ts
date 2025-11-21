/**
 * Zod schemas for Cascade Splits SDK
 * Uses Zod 4.1 features: .meta() for documentation, enhanced error messages
 */

import * as z from "zod";
import { USDC_MINT } from "./constants.js";

/**
 * Share represents a percentage (1-99) that a recipient receives.
 * Internally converted to basis points (share * 99).
 */
const Share = z
	.number({ message: "Share must be a number" })
	.int({ message: "Share must be a whole number (no decimals)" })
	.min(1, "Minimum share is 1")
	.max(99, "Maximum share is 99")
	.meta({
		description: "Integer percentage (1-99) this recipient receives",
		examples: [60, 40, 25, 75, 50],
	});

/**
 * Schema for a single recipient with their share
 */
export const ShareRecipientSchema = z.object({
	address: z
		.string({ message: "Address must be a string" })
		.min(32, "Invalid Solana address")
		.max(44, "Invalid Solana address")
		.meta({
			description: "Base58-encoded Solana public key",
			examples: [
				"9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
				"HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
			],
		}),
	share: Share,
});

/**
 * Schema for creating a split config
 */
export const CreateSplitInputSchema = z
	.object({
		recipients: z
			.array(ShareRecipientSchema, { message: "Recipients must be an array" })
			.min(1, "At least one recipient required")
			.max(20, "Maximum 20 recipients allowed")
			.refine(
				(recipients) => recipients.reduce((sum, r) => sum + r.share, 0) === 100,
				{
					message: "Shares must sum to exactly 100",
					path: ["recipients"],
				},
			)
			.refine(
				(recipients) => {
					const addresses = new Set(recipients.map((r) => r.address));
					return addresses.size === recipients.length;
				},
				{
					message: "Duplicate recipient addresses not allowed",
					path: ["recipients"],
				},
			),
		token: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.default(USDC_MINT)
			.meta({
				description: "Token mint address (defaults to USDC)",
				examples: [USDC_MINT],
			}),
	})
	.meta({
		description: "Parameters for creating a new split configuration",
	});

/**
 * Schema for updating a split config
 */
export const UpdateSplitInputSchema = z
	.object({
		vault: z
			.string({ message: "Vault address must be a string" })
			.min(32)
			.max(44)
			.meta({
				description: "Vault address of the split to update",
			}),
		recipients: z
			.array(ShareRecipientSchema)
			.min(1, "At least one recipient required")
			.max(20, "Maximum 20 recipients allowed")
			.refine(
				(recipients) => recipients.reduce((sum, r) => sum + r.share, 0) === 100,
				{
					message: "Shares must sum to exactly 100",
					path: ["recipients"],
				},
			)
			.refine(
				(recipients) => {
					const addresses = new Set(recipients.map((r) => r.address));
					return addresses.size === recipients.length;
				},
				{
					message: "Duplicate recipient addresses not allowed",
					path: ["recipients"],
				},
			),
	})
	.meta({
		description: "Parameters for updating an existing split configuration",
	});

// Type inference - single source of truth
export type ShareRecipient = z.infer<typeof ShareRecipientSchema>;
export type CreateSplitInput = z.infer<typeof CreateSplitInputSchema>;
export type UpdateSplitInput = z.infer<typeof UpdateSplitInputSchema>;

/**
 * Helper to format Zod errors in a user-friendly way
 */
export function formatZodError(error: z.ZodError): string {
	const issues = error.issues;
	return issues
		.map((err) => {
			const path = err.path.length > 0 ? `${err.path.join(".")}: ` : "";
			return `${path}${err.message}`;
		})
		.join("; ");
}
