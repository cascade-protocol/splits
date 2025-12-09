/**
 * Tests for helpers.ts
 *
 * Covers:
 * - isCascadeSplit caching (split detection)
 * - getProtocolConfig caching
 * - recipientsEqual (set equality comparison)
 * - labelToSeed / seedToLabel (human-readable split identifiers)
 */

import { describe, test, it, expect, vi, beforeEach } from "vitest";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";

// =============================================================================
// Mocks
// =============================================================================

const mockFetchMaybeSplitConfig = vi.fn();
const mockFetchProtocolConfig = vi.fn();

vi.mock("./generated/accounts/splitConfig.js", () => ({
	fetchMaybeSplitConfig: (...args: unknown[]) =>
		mockFetchMaybeSplitConfig(...args),
}));

vi.mock("./generated/accounts/protocolConfig.js", () => ({
	fetchProtocolConfig: (...args: unknown[]) => mockFetchProtocolConfig(...args),
}));

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert Uint8Array to base64 string without using Node.js Buffer global
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
	const binary = Array.from(bytes)
		.map((byte) => String.fromCharCode(byte))
		.join("");
	return btoa(binary);
}

// =============================================================================
// Test Fixtures
// =============================================================================

const mockVault1 = "Vault111111111111111111111111111111111111111" as Address;
const mockVault2 = "Vault222222222222222222222222222222222222222" as Address;
const alice = "A1ice111111111111111111111111111111111111111" as Address;
const bob = "Bob11111111111111111111111111111111111111111" as Address;
const charlie = "Char1ie11111111111111111111111111111111111111" as Address;

const createMockRpc = () => {
	const rpc = {
		getAccountInfo: vi.fn((address: Address) => ({
			send: vi.fn(async () => {
				// Return different results based on address
				if (address === mockVault1) {
					// Valid token account with splitConfig as owner
					const data = new Uint8Array(165);
					// Set owner (bytes 32-64) to mock address bytes
					const ownerBytes = new Uint8Array(32);
					for (let i = 0; i < 32; i++) {
						ownerBytes[i] = i + 1;
					}
					data.set(ownerBytes, 32);
					return {
						value: {
							data: [uint8ArrayToBase64(data), "base64"],
							owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
						},
					};
				}
				return { value: null };
			}),
		})),
	};
	return rpc as unknown as Rpc<SolanaRpcApi>;
};

// =============================================================================
// Tests: isCascadeSplit Caching
// =============================================================================

describe("isCascadeSplit caching", () => {
	const mockSplitConfig1 =
		"SpCfg111111111111111111111111111111111111111" as Address;

	beforeEach(async () => {
		vi.clearAllMocks();
		// Clear the cache between tests
		const helpers = await import("./helpers.js");
		helpers.clearSplitCache();
	});

	test("caches positive results", async () => {
		const { isCascadeSplit, clearSplitCache } = await import("./helpers.js");
		clearSplitCache();

		const rpc = createMockRpc();

		// Mock successful split config fetch
		mockFetchMaybeSplitConfig.mockResolvedValue({
			exists: true,
			data: {
				version: 1,
				authority: alice,
				mint: mockVault1,
				vault: mockVault1,
				uniqueId: mockVault1,
				bump: 255,
				recipientCount: 1,
				recipients: [{ address: alice, percentageBps: 9900 }],
				unclaimedAmounts: [],
				protocolUnclaimed: 0n,
				lastActivity: 0n,
				rentPayer: alice,
			},
		});

		// First call should fetch
		const result1 = await isCascadeSplit(rpc, mockSplitConfig1);
		expect(result1).toBe(true);
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(1);

		// Second call should use cache
		const result2 = await isCascadeSplit(rpc, mockSplitConfig1);
		expect(result2).toBe(true);
		// Should not have made additional fetch calls
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(1);
	});

	test("does NOT cache false results (splitConfig may be created later)", async () => {
		const { isCascadeSplit, clearSplitCache } = await import("./helpers.js");
		clearSplitCache();

		const rpc = createMockRpc();

		// Mock splitConfig not found
		mockFetchMaybeSplitConfig.mockResolvedValue({ exists: false });

		// First call - should query and get false
		const result1 = await isCascadeSplit(rpc, mockSplitConfig1);
		expect(result1).toBe(false);
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(1);

		// Second call - should query again (NOT cached, could be created later)
		const result2 = await isCascadeSplit(rpc, mockSplitConfig1);
		expect(result2).toBe(false);
		// Should have made additional fetch call (not cached)
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(2);
	});

	test("does NOT cache on RPC errors", async () => {
		const { isCascadeSplit, clearSplitCache } = await import("./helpers.js");
		clearSplitCache();

		const rpc = createMockRpc();

		// Mock fetch throws an error
		mockFetchMaybeSplitConfig.mockRejectedValue(
			new Error("RPC connection failed"),
		);

		// First call should throw
		await expect(isCascadeSplit(rpc, mockSplitConfig1)).rejects.toThrow(
			"RPC connection failed",
		);

		// Second call should also throw (not cached)
		await expect(isCascadeSplit(rpc, mockSplitConfig1)).rejects.toThrow(
			"RPC connection failed",
		);

		// Should have made two fetch calls (not cached)
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(2);
	});

	test("invalidateSplitCache clears specific entry", async () => {
		const { isCascadeSplit, invalidateSplitCache, clearSplitCache } =
			await import("./helpers.js");
		clearSplitCache();

		const rpc = createMockRpc();

		// Mock successful split config fetch
		mockFetchMaybeSplitConfig.mockResolvedValue({
			exists: true,
			data: {
				version: 1,
				authority: alice,
				mint: mockVault1,
				vault: mockVault1,
				uniqueId: mockVault1,
				bump: 255,
				recipientCount: 1,
				recipients: [{ address: alice, percentageBps: 9900 }],
				unclaimedAmounts: [],
				protocolUnclaimed: 0n,
				lastActivity: 0n,
				rentPayer: alice,
			},
		});

		// Populate cache
		await isCascadeSplit(rpc, mockSplitConfig1);
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(1);

		// Invalidate
		invalidateSplitCache(mockSplitConfig1);

		// Should query again
		await isCascadeSplit(rpc, mockSplitConfig1);
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(2);
	});

	test("clearSplitCache clears all entries", async () => {
		const { isCascadeSplit, clearSplitCache } = await import("./helpers.js");
		clearSplitCache();

		const rpc = createMockRpc();

		// Mock successful split config fetch
		mockFetchMaybeSplitConfig.mockResolvedValue({
			exists: true,
			data: {
				version: 1,
				authority: alice,
				mint: mockVault1,
				vault: mockVault1,
				uniqueId: mockVault1,
				bump: 255,
				recipientCount: 1,
				recipients: [{ address: alice, percentageBps: 9900 }],
				unclaimedAmounts: [],
				protocolUnclaimed: 0n,
				lastActivity: 0n,
				rentPayer: alice,
			},
		});

		// Populate cache
		await isCascadeSplit(rpc, mockSplitConfig1);
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(1);

		// Clear all
		clearSplitCache();

		// Should query again
		await isCascadeSplit(rpc, mockSplitConfig1);
		expect(mockFetchMaybeSplitConfig).toHaveBeenCalledTimes(2);
	});
});

// =============================================================================
// Tests: Protocol Config Caching
// =============================================================================

describe("protocol config caching", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		// Clear the cache
		const helpers = await import("./helpers.js");
		helpers.invalidateProtocolConfigCache();
	});

	test("caches protocol config after first fetch", async () => {
		const { getProtocolConfig, invalidateProtocolConfigCache } = await import(
			"./helpers.js"
		);
		invalidateProtocolConfigCache();

		const mockProtocolData = {
			authority: mockVault1,
			pendingAuthority: mockVault1,
			feeWallet: mockVault1,
			bump: 255,
		};

		mockFetchProtocolConfig.mockResolvedValue({ data: mockProtocolData });

		const rpc = {} as Rpc<SolanaRpcApi>;

		// First call
		const result1 = await getProtocolConfig(rpc);
		expect(result1.feeWallet).toBe(mockVault1);
		expect(mockFetchProtocolConfig).toHaveBeenCalledTimes(1);

		// Second call - should use cache
		const result2 = await getProtocolConfig(rpc);
		expect(result2.feeWallet).toBe(mockVault1);
		expect(mockFetchProtocolConfig).toHaveBeenCalledTimes(1);
	});

	test("invalidateProtocolConfigCache clears cache", async () => {
		const { getProtocolConfig, invalidateProtocolConfigCache } = await import(
			"./helpers.js"
		);
		invalidateProtocolConfigCache();

		const mockProtocolData = {
			authority: mockVault1,
			pendingAuthority: mockVault1,
			feeWallet: mockVault1,
			bump: 255,
		};

		mockFetchProtocolConfig.mockResolvedValue({ data: mockProtocolData });

		const rpc = {} as Rpc<SolanaRpcApi>;

		// First call
		await getProtocolConfig(rpc);
		expect(mockFetchProtocolConfig).toHaveBeenCalledTimes(1);

		// Invalidate
		invalidateProtocolConfigCache();

		// Should fetch again
		await getProtocolConfig(rpc);
		expect(mockFetchProtocolConfig).toHaveBeenCalledTimes(2);
	});

	test("refetches after invalidation with new data", async () => {
		const { getProtocolConfig, invalidateProtocolConfigCache } = await import(
			"./helpers.js"
		);
		invalidateProtocolConfigCache();

		const oldFeeWallet = mockVault1;
		const newFeeWallet = mockVault2;

		mockFetchProtocolConfig
			.mockResolvedValueOnce({
				data: {
					authority: mockVault1,
					pendingAuthority: mockVault1,
					feeWallet: oldFeeWallet,
					bump: 255,
				},
			})
			.mockResolvedValueOnce({
				data: {
					authority: mockVault1,
					pendingAuthority: mockVault1,
					feeWallet: newFeeWallet,
					bump: 255,
				},
			});

		const rpc = {} as Rpc<SolanaRpcApi>;

		// First call - old fee wallet
		const result1 = await getProtocolConfig(rpc);
		expect(result1.feeWallet).toBe(oldFeeWallet);

		// Invalidate (simulating fee_wallet change detection)
		invalidateProtocolConfigCache();

		// Second call - new fee wallet
		const result2 = await getProtocolConfig(rpc);
		expect(result2.feeWallet).toBe(newFeeWallet);
	});
});

// =============================================================================
// Tests: recipientsEqual
// =============================================================================

import { recipientsEqual, type SplitRecipient } from "./helpers.js";

const makeSplitRecipient = (
	address: Address,
	percentageBps: number,
): SplitRecipient => ({
	address,
	percentageBps,
	share: Math.round(percentageBps / 99),
});

describe("recipientsEqual", () => {
	it("returns true for identical recipients", () => {
		const input = [
			{ address: alice as string, share: 70 },
			{ address: bob as string, share: 29 },
		];
		const onChain: SplitRecipient[] = [
			makeSplitRecipient(alice, 6930), // 70 * 99 = 6930
			makeSplitRecipient(bob, 2871), // 29 * 99 = 2871
		];

		expect(recipientsEqual(input, onChain)).toBe(true);
	});

	it("returns true for same recipients different order", () => {
		const input = [
			{ address: bob as string, share: 29 },
			{ address: alice as string, share: 70 },
		];
		const onChain: SplitRecipient[] = [
			makeSplitRecipient(alice, 6930),
			makeSplitRecipient(bob, 2871),
		];

		expect(recipientsEqual(input, onChain)).toBe(true);
	});

	it("returns false for different addresses", () => {
		const input = [
			{ address: alice as string, share: 70 },
			{ address: charlie as string, share: 29 },
		];
		const onChain: SplitRecipient[] = [
			makeSplitRecipient(alice, 6930),
			makeSplitRecipient(bob, 2871),
		];

		expect(recipientsEqual(input, onChain)).toBe(false);
	});

	it("returns false for same addresses different shares", () => {
		const input = [
			{ address: alice as string, share: 60 },
			{ address: bob as string, share: 39 },
		];
		const onChain: SplitRecipient[] = [
			makeSplitRecipient(alice, 6930), // 70 shares
			makeSplitRecipient(bob, 2871), // 29 shares
		];

		expect(recipientsEqual(input, onChain)).toBe(false);
	});

	it("returns false for different lengths", () => {
		const input = [
			{ address: alice as string, share: 70 },
			{ address: bob as string, share: 20 },
			{ address: charlie as string, share: 9 },
		];
		const onChain: SplitRecipient[] = [
			makeSplitRecipient(alice, 6930),
			makeSplitRecipient(bob, 2871),
		];

		expect(recipientsEqual(input, onChain)).toBe(false);
	});

	it("handles share vs percentageBps input", () => {
		// Input with percentageBps directly
		const inputWithBps = [
			{ address: alice as string, percentageBps: 6930 },
			{ address: bob as string, percentageBps: 2871 },
		];
		const onChain: SplitRecipient[] = [
			makeSplitRecipient(alice, 6930),
			makeSplitRecipient(bob, 2871),
		];

		expect(recipientsEqual(inputWithBps, onChain)).toBe(true);
	});

	it("returns true for empty arrays", () => {
		expect(recipientsEqual([], [])).toBe(true);
	});

	it("returns false when input is empty but onChain is not", () => {
		const onChain: SplitRecipient[] = [makeSplitRecipient(alice, 9900)];

		expect(recipientsEqual([], onChain)).toBe(false);
	});
});

// =============================================================================
// Tests: labelToSeed / seedToLabel
// =============================================================================

import { labelToSeed, seedToLabel, generateUniqueId } from "./helpers.js";

describe("labelToSeed", () => {
	test("converts label to deterministic seed", () => {
		const seed1 = labelToSeed("Split 1");
		const seed2 = labelToSeed("Split 1");

		// Same label = same seed
		expect(seed1).toBe(seed2);
	});

	test("different labels produce different seeds", () => {
		const seed1 = labelToSeed("Split 1");
		const seed2 = labelToSeed("Split 2");

		expect(seed1).not.toBe(seed2);
	});

	test("handles max length label (27 chars)", () => {
		const maxLabel = "abcdefghijklmnopqrstuvwxyza"; // 27 chars
		expect(maxLabel.length).toBe(27);

		const seed = labelToSeed(maxLabel);
		expect(seed).toBeDefined();
	});

	test("throws for label exceeding max length", () => {
		const tooLong = "abcdefghijklmnopqrstuvwxyzab"; // 28 chars
		expect(tooLong.length).toBe(28);

		expect(() => labelToSeed(tooLong)).toThrow("Label too long");
	});

	test("handles empty label", () => {
		const seed = labelToSeed("");
		expect(seed).toBeDefined();
	});

	test("handles special characters", () => {
		const seed = labelToSeed("Split #1 - Test!");
		expect(seed).toBeDefined();
	});
});

describe("seedToLabel", () => {
	test("extracts label from labeled seed", () => {
		const label = "My Split";
		const seed = labelToSeed(label);
		const extracted = seedToLabel(seed);

		expect(extracted).toBe(label);
	});

	test("returns null for random seed", () => {
		const randomSeed = generateUniqueId();
		const label = seedToLabel(randomSeed);

		expect(label).toBeNull();
	});

	test("handles empty label roundtrip", () => {
		const seed = labelToSeed("");
		const extracted = seedToLabel(seed);

		expect(extracted).toBe("");
	});

	test("handles max length label roundtrip", () => {
		const maxLabel = "abcdefghijklmnopqrstuvwxyza";
		const seed = labelToSeed(maxLabel);
		const extracted = seedToLabel(seed);

		expect(extracted).toBe(maxLabel);
	});

	test("handles special characters roundtrip", () => {
		const label = "API Revenue - 2025";
		const seed = labelToSeed(label);
		const extracted = seedToLabel(seed);

		expect(extracted).toBe(label);
	});
});

describe("cross-chain compatibility", () => {
	test("labeled seed has CSPL: prefix in bytes", () => {
		const seed = labelToSeed("Test");

		// The seed should decode back to label
		expect(seedToLabel(seed)).toBe("Test");
	});

	test("multiple labeled seeds are distinguishable", () => {
		const seedA = labelToSeed("Product A");
		const seedB = labelToSeed("Product B");
		const seedC = labelToSeed("Product C");

		// All unique
		expect(new Set([seedA, seedB, seedC]).size).toBe(3);

		// All extractable
		expect(seedToLabel(seedA)).toBe("Product A");
		expect(seedToLabel(seedB)).toBe("Product B");
		expect(seedToLabel(seedC)).toBe("Product C");
	});
});
