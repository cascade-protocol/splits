/**
 * Tests for state inspection helpers
 */

import { describe, it, expect } from "vitest";
import {
	hasUnclaimedAmounts,
	getTotalUnclaimed,
	canUpdateOrClose,
} from "../src/core/helpers.js";
import type { SplitConfig } from "../src/core/types.js";

// Factory for creating test split configs
function createSplit(overrides: Partial<SplitConfig> = {}): SplitConfig {
	return {
		version: 1,
		authority: "TestAuthority11111111111111111111111111111",
		mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
		vault: "TestVault111111111111111111111111111111111",
		uniqueId: "TestId1111111111111111111111111111111111",
		bump: 255,
		recipientCount: 2,
		recipients: [
			{ address: "Alice11111111111111111111111111111111111111", share: 60 },
			{ address: "Bob111111111111111111111111111111111111111", share: 40 },
		],
		unclaimedAmounts: [],
		protocolUnclaimed: 0n,
		lastActivity: BigInt(Math.floor(Date.now() / 1000)),
		rentPayer: "TestAuthority11111111111111111111111111111",
		...overrides,
	};
}

describe("hasUnclaimedAmounts", () => {
	it("returns false when both unclaimedAmounts and protocolUnclaimed are empty/zero", () => {
		const split = createSplit({
			unclaimedAmounts: [],
			protocolUnclaimed: 0n,
		});
		expect(hasUnclaimedAmounts(split)).toBe(false);
	});

	it("returns true when unclaimedAmounts has entries", () => {
		const split = createSplit({
			unclaimedAmounts: [
				{
					recipient: "Alice11111111111111111111111111111111111111",
					amount: 100_000_000n,
					timestamp: BigInt(Math.floor(Date.now() / 1000)),
				},
			],
			protocolUnclaimed: 0n,
		});
		expect(hasUnclaimedAmounts(split)).toBe(true);
	});

	it("returns true when protocolUnclaimed > 0", () => {
		const split = createSplit({
			unclaimedAmounts: [],
			protocolUnclaimed: 50_000_000n,
		});
		expect(hasUnclaimedAmounts(split)).toBe(true);
	});

	it("returns true when both have values", () => {
		const split = createSplit({
			unclaimedAmounts: [
				{
					recipient: "Alice11111111111111111111111111111111111111",
					amount: 100_000_000n,
					timestamp: BigInt(Math.floor(Date.now() / 1000)),
				},
			],
			protocolUnclaimed: 10_000_000n,
		});
		expect(hasUnclaimedAmounts(split)).toBe(true);
	});
});

describe("getTotalUnclaimed", () => {
	it("returns 0 when no unclaimed amounts", () => {
		const split = createSplit({
			unclaimedAmounts: [],
			protocolUnclaimed: 0n,
		});
		expect(getTotalUnclaimed(split)).toBe(0n);
	});

	it("returns sum of recipient unclaimed amounts", () => {
		const split = createSplit({
			unclaimedAmounts: [
				{
					recipient: "Alice11111111111111111111111111111111111111",
					amount: 100_000_000n,
					timestamp: BigInt(Math.floor(Date.now() / 1000)),
				},
				{
					recipient: "Bob111111111111111111111111111111111111111",
					amount: 50_000_000n,
					timestamp: BigInt(Math.floor(Date.now() / 1000)),
				},
			],
			protocolUnclaimed: 0n,
		});
		expect(getTotalUnclaimed(split)).toBe(150_000_000n);
	});

	it("includes protocolUnclaimed in total", () => {
		const split = createSplit({
			unclaimedAmounts: [],
			protocolUnclaimed: 25_000_000n,
		});
		expect(getTotalUnclaimed(split)).toBe(25_000_000n);
	});

	it("returns combined total of recipient + protocol unclaimed", () => {
		const split = createSplit({
			unclaimedAmounts: [
				{
					recipient: "Alice11111111111111111111111111111111111111",
					amount: 100_000_000n,
					timestamp: BigInt(Math.floor(Date.now() / 1000)),
				},
			],
			protocolUnclaimed: 10_000_000n,
		});
		expect(getTotalUnclaimed(split)).toBe(110_000_000n);
	});
});

describe("canUpdateOrClose", () => {
	it("returns true when vault is empty and no unclaimed amounts", () => {
		const split = createSplit({
			unclaimedAmounts: [],
			protocolUnclaimed: 0n,
		});
		expect(canUpdateOrClose(split, 0n)).toBe(true);
	});

	it("returns false when vault has balance", () => {
		const split = createSplit({
			unclaimedAmounts: [],
			protocolUnclaimed: 0n,
		});
		expect(canUpdateOrClose(split, 1_000_000n)).toBe(false);
	});

	it("returns false when unclaimed amounts exist (even with empty vault)", () => {
		const split = createSplit({
			unclaimedAmounts: [
				{
					recipient: "Alice11111111111111111111111111111111111111",
					amount: 100_000_000n,
					timestamp: BigInt(Math.floor(Date.now() / 1000)),
				},
			],
			protocolUnclaimed: 0n,
		});
		expect(canUpdateOrClose(split, 0n)).toBe(false);
	});

	it("returns false when protocol unclaimed exists (even with empty vault)", () => {
		const split = createSplit({
			unclaimedAmounts: [],
			protocolUnclaimed: 5_000_000n,
		});
		expect(canUpdateOrClose(split, 0n)).toBe(false);
	});

	it("returns false when both vault has balance and unclaimed exist", () => {
		const split = createSplit({
			unclaimedAmounts: [
				{
					recipient: "Alice11111111111111111111111111111111111111",
					amount: 100_000_000n,
					timestamp: BigInt(Math.floor(Date.now() / 1000)),
				},
			],
			protocolUnclaimed: 10_000_000n,
		});
		expect(canUpdateOrClose(split, 500_000_000n)).toBe(false);
	});
});
