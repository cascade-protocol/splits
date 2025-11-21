/**
 * Tests for Zod schemas and validation
 */

import { describe, it, expect } from "vitest";
import {
	ShareRecipientSchema,
	CreateSplitInputSchema,
	UpdateSplitInputSchema,
} from "../src/core/schemas.js";
import { USDC_MINT } from "../src/core/constants.js";

describe("ShareRecipientSchema", () => {
	it("validates correct recipient", () => {
		const result = ShareRecipientSchema.safeParse({
			address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
			share: 60,
		});
		expect(result.success).toBe(true);
	});

	it("rejects non-integer share", () => {
		const result = ShareRecipientSchema.safeParse({
			address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
			share: 50.5,
		});
		expect(result.success).toBe(false);
	});

	it("rejects share < 1", () => {
		const result = ShareRecipientSchema.safeParse({
			address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
			share: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects share > 99", () => {
		const result = ShareRecipientSchema.safeParse({
			address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
			share: 100,
		});
		expect(result.success).toBe(false);
	});
});

describe("CreateSplitInputSchema", () => {
	it("validates correct input with 2 recipients", () => {
		const result = CreateSplitInputSchema.safeParse({
			recipients: [
				{
					address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
					share: 60,
				},
				{
					address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
					share: 40,
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.token).toBe(USDC_MINT); // Default
		}
	});

	it("validates with custom token", () => {
		const customMint = "So11111111111111111111111111111111111111112"; // SOL
		const result = CreateSplitInputSchema.safeParse({
			recipients: [
				{
					address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
					share: 60,
				},
				{
					address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
					share: 40,
				},
			],
			token: customMint,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.token).toBe(customMint);
		}
	});

	it("rejects shares that don't sum to 100", () => {
		const result = CreateSplitInputSchema.safeParse({
			recipients: [
				{
					address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
					share: 60,
				},
				{
					address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
					share: 30,
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects duplicate addresses", () => {
		const sameAddress = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
		const result = CreateSplitInputSchema.safeParse({
			recipients: [
				{ address: sameAddress, share: 50 },
				{ address: sameAddress, share: 50 },
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty recipients", () => {
		const result = CreateSplitInputSchema.safeParse({
			recipients: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects more than 20 recipients", () => {
		const recipients = Array.from({ length: 21 }, (_, i) => ({
			address: `addr${i}`.padEnd(44, "1"),
			share: i === 0 ? 79 : 1,
		}));
		const result = CreateSplitInputSchema.safeParse({ recipients });
		expect(result.success).toBe(false);
	});
});

describe("UpdateSplitInputSchema", () => {
	it("validates correct update input", () => {
		const result = UpdateSplitInputSchema.safeParse({
			vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
			recipients: [
				{
					address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
					share: 70,
				},
				{
					address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
					share: 30,
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects shares that don't sum to 100", () => {
		const result = UpdateSplitInputSchema.safeParse({
			vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
			recipients: [
				{
					address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
					share: 55,
				},
			],
		});
		expect(result.success).toBe(false);
	});
});
