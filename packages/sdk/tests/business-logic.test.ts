/**
 * Tests for business logic functions
 */

import { describe, it, expect } from "vitest";
import {
	sharesToBasisPoints,
	basisPointsToShares,
	validateAndTransformCreate,
	validateAndTransformUpdate,
	calculateDistribution,
	previewDistribution,
} from "../src/core/business-logic.js";
import { USDC_MINT } from "../src/core/constants.js";

describe("sharesToBasisPoints", () => {
	it("converts shares to basis points correctly", () => {
		expect(sharesToBasisPoints(60)).toBe(5940); // 60 * 99 = 5940
		expect(sharesToBasisPoints(40)).toBe(3960); // 40 * 99 = 3960
		expect(sharesToBasisPoints(1)).toBe(99); // 1 * 99 = 99
		expect(sharesToBasisPoints(99)).toBe(9801); // 99 * 99 = 9801
	});

	it("rejects non-integer shares", () => {
		expect(() => sharesToBasisPoints(50.5)).toThrow("must be an integer");
	});

	it("rejects share < 1", () => {
		expect(() => sharesToBasisPoints(0)).toThrow("must be between 1-99");
	});

	it("rejects share > 99", () => {
		expect(() => sharesToBasisPoints(100)).toThrow("must be between 1-99");
	});
});

describe("basisPointsToShares", () => {
	it("converts basis points to shares correctly", () => {
		expect(basisPointsToShares(5940)).toBe(60);
		expect(basisPointsToShares(3960)).toBe(40);
		expect(basisPointsToShares(99)).toBe(1);
	});

	it("rounds correctly", () => {
		expect(basisPointsToShares(5941)).toBe(60); // Rounds to 60
		expect(basisPointsToShares(5989)).toBe(60); // Rounds to 60
		expect(basisPointsToShares(5990)).toBe(61); // Rounds to 61
	});

	it("rejects non-integer basis points", () => {
		expect(() => basisPointsToShares(5940.5)).toThrow(
			"must be an integer",
		);
	});
});

describe("validateAndTransformCreate", () => {
	it("transforms valid input correctly", () => {
		const result = validateAndTransformCreate({
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

		expect(result.token).toBe(USDC_MINT);
		expect(result.recipients).toHaveLength(2);
		expect(result.recipients[0]?.percentageBps).toBe(5940);
		expect(result.recipients[1]?.percentageBps).toBe(3960);
	});

	it("throws on invalid input", () => {
		expect(() =>
			validateAndTransformCreate({
				recipients: [
					{
						address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
						share: 50,
					},
				],
			}),
		).toThrow("Validation failed");
	});
});

describe("validateAndTransformUpdate", () => {
	it("transforms valid input correctly", () => {
		const result = validateAndTransformUpdate({
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

		expect(result.vault).toBe(
			"9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
		);
		expect(result.recipients).toHaveLength(2);
		expect(result.recipients[0]?.percentageBps).toBe(6930);
		expect(result.recipients[1]?.percentageBps).toBe(2970);
	});

	it("throws on invalid input", () => {
		expect(() =>
			validateAndTransformUpdate({
				vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
				recipients: [
					{
						address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
						share: 50,
					},
				],
			}),
		).toThrow("Validation failed");
	});
});

describe("calculateDistribution", () => {
	it("distributes 60/40 split correctly", () => {
		const distributions = calculateDistribution(1000000n, [
			{
				address: "alice",
				share: 60,
			},
			{
				address: "bob",
				share: 40,
			},
		]);

		expect(distributions).toHaveLength(2);
		expect(distributions[0]?.address).toBe("alice");
		expect(distributions[0]?.amount).toBe(594000n); // 1000000 * 5940 / 10000
		expect(distributions[1]?.address).toBe("bob");
		expect(distributions[1]?.amount).toBe(396000n); // Remainder (990000 - 594000)
	});

	it("handles rounding without losing tokens", () => {
		const distributions = calculateDistribution(1000000n, [
			{
				address: "a",
				share: 33,
			},
			{
				address: "b",
				share: 33,
			},
			{
				address: "c",
				share: 34,
			},
		]);

		const total = distributions.reduce((sum, d) => sum + d.amount, 0n);
		expect(total).toBe(990000n); // Exactly 99% (protocol gets 1%)

		// Last recipient gets rounding dust
		expect(distributions[0]?.amount).toBe(326700n);
		expect(distributions[1]?.amount).toBe(326700n);
		expect(distributions[2]?.amount).toBe(336600n); // Gets remainder
	});

	it("handles single recipient", () => {
		const distributions = calculateDistribution(1000000n, [
			{
				address: "only",
				share: 100,
			},
		]);

		expect(distributions).toHaveLength(1);
		expect(distributions[0]?.amount).toBe(990000n); // 99% (protocol gets 1%)
	});

	it("throws on empty recipients", () => {
		expect(() => calculateDistribution(1000000n, [])).toThrow(
			"At least one recipient required",
		);
	});

	it("throws on shares that don't sum to 100", () => {
		expect(() =>
			calculateDistribution(1000000n, [
				{ address: "a", share: 60 },
				{ address: "b", share: 30 },
			]),
		).toThrow("must sum to 100");
	});
});

describe("previewDistribution", () => {
	it("calculates preview correctly", () => {
		const preview = previewDistribution(1000000n, [
			{ address: "alice", share: 60 },
			{ address: "bob", share: 40 },
		]);

		expect(preview.distributions).toHaveLength(2);
		expect(preview.protocolFee).toBe(10000n); // 1% of 1000000
		expect(preview.total).toBe(1000000n); // recipients + protocol
		expect(preview.distributions[0]?.amount).toBe(594000n);
		expect(preview.distributions[1]?.amount).toBe(396000n);
	});

	it("calculates zero balance preview", () => {
		const preview = previewDistribution(0n, [
			{ address: "alice", share: 100 },
		]);

		expect(preview.protocolFee).toBe(0n);
		expect(preview.total).toBe(0n);
		expect(preview.distributions[0]?.amount).toBe(0n);
	});
});
