/**
 * Tests for caching behavior in helpers.ts
 *
 * Tests:
 * - isCascadeSplit caching (split detection)
 * - getProtocolConfig caching
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";

// Create a mock module for the generated accounts
const mockFetchMaybeSplitConfig = vi.fn();
const mockFetchProtocolConfig = vi.fn();

vi.mock("../src/solana/generated/accounts/splitConfig.js", () => ({
	fetchMaybeSplitConfig: (...args: unknown[]) =>
		mockFetchMaybeSplitConfig(...args),
}));

vi.mock("../src/solana/generated/accounts/protocolConfig.js", () => ({
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
	beforeEach(async () => {
		vi.clearAllMocks();
		// Clear the cache between tests
		const helpers = await import("../src/solana/helpers.js");
		helpers.clearSplitCache();
	});

	test("caches positive results", async () => {
		const { isCascadeSplit, clearSplitCache } = await import(
			"../src/solana/helpers.js"
		);
		clearSplitCache();

		const rpc = createMockRpc();

		// Mock successful split config fetch
		mockFetchMaybeSplitConfig.mockResolvedValue({
			exists: true,
			data: {
				version: 1,
				authority: mockVault1,
				mint: mockVault1,
				vault: mockVault1,
				uniqueId: mockVault1,
				bump: 255,
				recipientCount: 1,
				recipients: [{ address: mockVault1, percentageBps: 9900 }],
				unclaimedAmounts: [],
				protocolUnclaimed: 0n,
				lastActivity: 0n,
				rentPayer: mockVault1,
			},
		});

		// First call should fetch
		const result1 = await isCascadeSplit(rpc, mockVault1);
		expect(result1).toBe(true);
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1);

		// Second call should use cache
		const result2 = await isCascadeSplit(rpc, mockVault1);
		expect(result2).toBe(true);
		// Should not have made additional RPC calls
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1);
	});

	test("caches negative results for existing non-split accounts", async () => {
		const { isCascadeSplit, clearSplitCache } = await import(
			"../src/solana/helpers.js"
		);
		clearSplitCache();

		// Create RPC that returns an account but splitConfig doesn't exist
		const rpc = {
			getAccountInfo: vi.fn(() => ({
				send: vi.fn(async () => ({
					value: {
						// Valid token account data (72+ bytes)
						data: [uint8ArrayToBase64(new Uint8Array(165)), "base64"],
						owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
					},
				})),
			})),
		} as unknown as Rpc<SolanaRpcApi>;

		// Mock splitConfig not found
		mockFetchMaybeSplitConfig.mockResolvedValue({ exists: false });

		// First call - should query and get false
		const result1 = await isCascadeSplit(rpc, mockVault1);
		expect(result1).toBe(false);
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1);

		// Second call - should use cache
		const result2 = await isCascadeSplit(rpc, mockVault1);
		expect(result2).toBe(false);
		// Should not have made additional RPC calls
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1);
	});

	test("does NOT cache when account doesn't exist", async () => {
		const { isCascadeSplit, clearSplitCache } = await import(
			"../src/solana/helpers.js"
		);
		clearSplitCache();

		// RPC returns null (account doesn't exist)
		const rpc = {
			getAccountInfo: vi.fn(() => ({
				send: vi.fn(async () => ({ value: null })),
			})),
		} as unknown as Rpc<SolanaRpcApi>;

		// First call
		const result1 = await isCascadeSplit(rpc, mockVault2);
		expect(result1).toBe(false);
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1);

		// Second call - should query again (not cached)
		const result2 = await isCascadeSplit(rpc, mockVault2);
		expect(result2).toBe(false);
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(2);
	});

	test("does NOT cache on RPC errors", async () => {
		const { isCascadeSplit, clearSplitCache } = await import(
			"../src/solana/helpers.js"
		);
		clearSplitCache();

		// RPC throws an error
		const rpc = {
			getAccountInfo: vi.fn(() => ({
				send: vi.fn(async () => {
					throw new Error("RPC connection failed");
				}),
			})),
		} as unknown as Rpc<SolanaRpcApi>;

		// First call should throw
		await expect(isCascadeSplit(rpc, mockVault1)).rejects.toThrow(
			"RPC connection failed",
		);

		// Second call should also throw (not cached)
		await expect(isCascadeSplit(rpc, mockVault1)).rejects.toThrow(
			"RPC connection failed",
		);

		// Should have made two RPC calls (not cached)
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(2);
	});

	test("invalidateSplitCache clears specific entry", async () => {
		const { isCascadeSplit, invalidateSplitCache, clearSplitCache } =
			await import("../src/solana/helpers.js");
		clearSplitCache();

		const rpc = createMockRpc();

		// Mock successful split config fetch
		mockFetchMaybeSplitConfig.mockResolvedValue({
			exists: true,
			data: {
				version: 1,
				authority: mockVault1,
				mint: mockVault1,
				vault: mockVault1,
				uniqueId: mockVault1,
				bump: 255,
				recipientCount: 1,
				recipients: [{ address: mockVault1, percentageBps: 9900 }],
				unclaimedAmounts: [],
				protocolUnclaimed: 0n,
				lastActivity: 0n,
				rentPayer: mockVault1,
			},
		});

		// Populate cache
		await isCascadeSplit(rpc, mockVault1);
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1);

		// Invalidate
		invalidateSplitCache(mockVault1);

		// Should query again
		await isCascadeSplit(rpc, mockVault1);
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(2);
	});

	test("clearSplitCache clears all entries", async () => {
		const { isCascadeSplit, clearSplitCache } = await import(
			"../src/solana/helpers.js"
		);
		clearSplitCache();

		const rpc = createMockRpc();

		// Mock successful split config fetch
		mockFetchMaybeSplitConfig.mockResolvedValue({
			exists: true,
			data: {
				version: 1,
				authority: mockVault1,
				mint: mockVault1,
				vault: mockVault1,
				uniqueId: mockVault1,
				bump: 255,
				recipientCount: 1,
				recipients: [{ address: mockVault1, percentageBps: 9900 }],
				unclaimedAmounts: [],
				protocolUnclaimed: 0n,
				lastActivity: 0n,
				rentPayer: mockVault1,
			},
		});

		// Populate cache
		await isCascadeSplit(rpc, mockVault1);
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1);

		// Clear all
		clearSplitCache();

		// Should query again
		await isCascadeSplit(rpc, mockVault1);
		expect(rpc.getAccountInfo).toHaveBeenCalledTimes(2);
	});
});

// =============================================================================
// Tests: Protocol Config Caching
// =============================================================================

describe("protocol config caching", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		// Clear the cache
		const helpers = await import("../src/solana/helpers.js");
		helpers.invalidateProtocolConfigCache();
	});

	test("caches protocol config after first fetch", async () => {
		const { getProtocolConfig, invalidateProtocolConfigCache } = await import(
			"../src/solana/helpers.js"
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
			"../src/solana/helpers.js"
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
			"../src/solana/helpers.js"
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
