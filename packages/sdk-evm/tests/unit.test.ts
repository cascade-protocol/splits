/**
 * Unit tests for pure functions in the EVM SDK.
 * These tests don't require blockchain interaction.
 */

import { describe, test, expect } from "vitest";
import {
	toEvmRecipient,
	toEvmRecipients,
	getDefaultToken,
} from "../src/helpers.js";
import {
	getSplitFactoryAddress,
	getUsdcAddress,
	isSupportedChain,
	SPLIT_FACTORY_ADDRESSES,
	USDC_ADDRESSES,
	SUPPORTED_CHAIN_IDS,
} from "../src/addresses.js";

// =============================================================================
// Test Data
// =============================================================================

const VALID_ADDRESS = "0x1234567890123456789012345678901234567890";
const VALID_ADDRESS_2 = "0xabcdefabcdef12345678901234567890abcdefab";

// =============================================================================
// toEvmRecipient tests
// =============================================================================

describe("toEvmRecipient", () => {
	test("converts share to percentageBps correctly", () => {
		const result = toEvmRecipient({
			address: VALID_ADDRESS,
			share: 100,
		});

		expect(result.addr).toBe(VALID_ADDRESS);
		expect(result.percentageBps).toBe(9900); // 100 * 99 = 9900
	});

	test("converts partial share correctly", () => {
		const result = toEvmRecipient({
			address: VALID_ADDRESS,
			share: 50,
		});

		expect(result.percentageBps).toBe(4950); // 50 * 99 = 4950
	});

	test("converts small share correctly", () => {
		const result = toEvmRecipient({
			address: VALID_ADDRESS,
			share: 1,
		});

		expect(result.percentageBps).toBe(99); // 1 * 99 = 99
	});

	test("uses percentageBps directly when provided", () => {
		const result = toEvmRecipient({
			address: VALID_ADDRESS,
			percentageBps: 5000,
		});

		expect(result.percentageBps).toBe(5000);
	});

	test("prefers percentageBps over share when both provided", () => {
		const result = toEvmRecipient({
			address: VALID_ADDRESS,
			share: 50,
			percentageBps: 3000,
		});

		expect(result.percentageBps).toBe(3000);
	});

	test("throws on invalid address", () => {
		expect(() =>
			toEvmRecipient({
				address: "invalid-address" as `0x${string}`,
				share: 100,
			}),
		).toThrow("Invalid address");
	});

	test("throws on missing share and percentageBps", () => {
		expect(() =>
			toEvmRecipient({
				address: VALID_ADDRESS,
			}),
		).toThrow("Recipient must have either share or percentageBps");
	});

	test("handles share of 0", () => {
		const result = toEvmRecipient({
			address: VALID_ADDRESS,
			share: 0,
		});

		expect(result.percentageBps).toBe(0);
	});
});

// =============================================================================
// toEvmRecipients tests
// =============================================================================

describe("toEvmRecipients", () => {
	test("converts array of recipients", () => {
		const results = toEvmRecipients([
			{ address: VALID_ADDRESS, share: 60 },
			{ address: VALID_ADDRESS_2, share: 40 },
		]);

		expect(results).toHaveLength(2);
		expect(results[0]?.addr).toBe(VALID_ADDRESS);
		expect(results[0]?.percentageBps).toBe(5940); // 60 * 99
		expect(results[1]?.addr).toBe(VALID_ADDRESS_2);
		expect(results[1]?.percentageBps).toBe(3960); // 40 * 99
	});

	test("handles empty array", () => {
		const results = toEvmRecipients([]);
		expect(results).toHaveLength(0);
	});

	test("handles single recipient", () => {
		const results = toEvmRecipients([{ address: VALID_ADDRESS, share: 100 }]);
		expect(results).toHaveLength(1);
		expect(results[0]?.percentageBps).toBe(9900);
	});

	test("handles mixed share and percentageBps", () => {
		const results = toEvmRecipients([
			{ address: VALID_ADDRESS, share: 50 },
			{ address: VALID_ADDRESS_2, percentageBps: 4950 },
		]);

		expect(results[0]?.percentageBps).toBe(4950);
		expect(results[1]?.percentageBps).toBe(4950);
	});
});

// =============================================================================
// Address helpers tests
// =============================================================================

describe("getSplitFactoryAddress", () => {
	test("returns address for Base mainnet", () => {
		const address = getSplitFactoryAddress(8453);
		expect(address).toBe(SPLIT_FACTORY_ADDRESSES[8453]);
		expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
	});

	test("returns address for Base Sepolia", () => {
		const address = getSplitFactoryAddress(84532);
		expect(address).toBe(SPLIT_FACTORY_ADDRESSES[84532]);
	});

	test("throws for unsupported chain", () => {
		expect(() => getSplitFactoryAddress(1)).toThrow(
			"SplitFactory not deployed on chain 1",
		);
	});

	test("throws for unsupported chain with helpful message", () => {
		expect(() => getSplitFactoryAddress(137)).toThrow(
			"Supported chains: Base (8453), Base Sepolia (84532)",
		);
	});
});

describe("getUsdcAddress", () => {
	test("returns address for Base mainnet", () => {
		const address = getUsdcAddress(8453);
		expect(address).toBe(USDC_ADDRESSES[8453]);
		expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
	});

	test("returns address for Base Sepolia", () => {
		const address = getUsdcAddress(84532);
		expect(address).toBe(USDC_ADDRESSES[84532]);
	});

	test("throws for unsupported chain", () => {
		expect(() => getUsdcAddress(1)).toThrow("USDC not configured for chain 1");
	});
});

describe("isSupportedChain", () => {
	test("returns true for Base mainnet", () => {
		expect(isSupportedChain(8453)).toBe(true);
	});

	test("returns true for Base Sepolia", () => {
		expect(isSupportedChain(84532)).toBe(true);
	});

	test("returns false for Ethereum mainnet", () => {
		expect(isSupportedChain(1)).toBe(false);
	});

	test("returns false for Polygon", () => {
		expect(isSupportedChain(137)).toBe(false);
	});

	test("returns false for arbitrary chain ID", () => {
		expect(isSupportedChain(99999)).toBe(false);
	});
});

describe("SUPPORTED_CHAIN_IDS", () => {
	test("contains Base mainnet", () => {
		expect(SUPPORTED_CHAIN_IDS).toContain(8453);
	});

	test("contains Base Sepolia", () => {
		expect(SUPPORTED_CHAIN_IDS).toContain(84532);
	});

	test("has correct length", () => {
		expect(SUPPORTED_CHAIN_IDS).toHaveLength(2);
	});
});

describe("getDefaultToken", () => {
	test("returns USDC address for Base mainnet", () => {
		const token = getDefaultToken(8453);
		expect(token).toBe(USDC_ADDRESSES[8453]);
	});

	test("returns USDC address for Base Sepolia", () => {
		const token = getDefaultToken(84532);
		expect(token).toBe(USDC_ADDRESSES[84532]);
	});

	test("throws for unsupported chain", () => {
		expect(() => getDefaultToken(1)).toThrow("USDC not configured for chain 1");
	});
});

// =============================================================================
// Address constants tests
// =============================================================================

describe("SPLIT_FACTORY_ADDRESSES", () => {
	test("all addresses are valid EVM addresses", () => {
		for (const address of Object.values(SPLIT_FACTORY_ADDRESSES)) {
			expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
		}
	});

	test("Base mainnet and Sepolia have same factory (deterministic deployment)", () => {
		expect(SPLIT_FACTORY_ADDRESSES[8453]).toBe(SPLIT_FACTORY_ADDRESSES[84532]);
	});
});

describe("USDC_ADDRESSES", () => {
	test("all addresses are valid EVM addresses", () => {
		for (const address of Object.values(USDC_ADDRESSES)) {
			expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
		}
	});

	test("Base mainnet and Sepolia have different USDC addresses", () => {
		expect(USDC_ADDRESSES[8453]).not.toBe(USDC_ADDRESSES[84532]);
	});
});
