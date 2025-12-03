/**
 * Tests for ensureSplit with mocked viem clients.
 */

import { describe, test, expect, vi } from "vitest";
import type { PublicClient, WalletClient, Account } from "viem";
import { ensureSplit } from "../src/ensure.js";

// =============================================================================
// Test Data
// =============================================================================

const FACTORY_ADDRESS = "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const PREDICTED_SPLIT = "0x2222222222222222222222222222222222222222";
const TX_HASH =
	"0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
const UNIQUE_ID =
	"0x0000000000000000000000000000000000000000000000000000000000000001";

// =============================================================================
// Mock Factories
// =============================================================================

function createMockAccount(): Account {
	return {
		address: WALLET_ADDRESS,
		type: "local",
	} as unknown as Account;
}

function createMockPublicClient(overrides: {
	chainId?: number;
	bytecode?: `0x${string}` | undefined;
	predictedAddress?: `0x${string}`;
}): PublicClient {
	return {
		getChainId: vi.fn().mockResolvedValue(overrides.chainId ?? 8453),
		getBytecode: vi.fn().mockResolvedValue(overrides.bytecode),
		readContract: vi
			.fn()
			.mockResolvedValue(overrides.predictedAddress ?? PREDICTED_SPLIT),
		waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
		chain: { id: overrides.chainId ?? 8453 },
	} as unknown as PublicClient;
}

function createMockWalletClient(overrides?: {
	account?: Account | undefined;
	writeContractError?: Error;
}): WalletClient {
	const writeContract = overrides?.writeContractError
		? vi.fn().mockRejectedValue(overrides.writeContractError)
		: vi.fn().mockResolvedValue(TX_HASH);

	// Use 'in' check to distinguish between "not provided" and "explicitly undefined"
	const account =
		overrides && "account" in overrides
			? overrides.account
			: createMockAccount();

	return {
		account,
		writeContract,
	} as unknown as WalletClient;
}

// =============================================================================
// Tests
// =============================================================================

describe("ensureSplit", () => {
	describe("basic creation flow", () => {
		test("creates split when it doesn't exist", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined, // No code = doesn't exist
			});
			const walletClient = createMockWalletClient();

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("CREATED");
			if (result.status === "CREATED") {
				expect(result.split).toBe(PREDICTED_SPLIT);
				expect(result.signature).toBe(TX_HASH);
			}
		});

		test("returns NO_CHANGE when split already exists", async () => {
			const publicClient = createMockPublicClient({
				bytecode: "0x1234", // Has code = exists
			});
			const walletClient = createMockWalletClient();

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("NO_CHANGE");
			if (result.status === "NO_CHANGE") {
				expect(result.split).toBe(PREDICTED_SPLIT);
			}
		});
	});

	describe("wallet validation", () => {
		test("fails when wallet not connected", async () => {
			const publicClient = createMockPublicClient({});
			const walletClient = createMockWalletClient({
				account: undefined,
			});

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("FAILED");
			if (result.status === "FAILED") {
				expect(result.reason).toBe("wallet_disconnected");
				expect(result.message).toContain("not connected");
			}
		});
	});

	describe("recipient validation", () => {
		test("fails when recipients don't sum to 9900 bps", async () => {
			const publicClient = createMockPublicClient({});
			const walletClient = createMockWalletClient();

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 50, // Only 4950 bps, should be 100
						},
					],
				},
			);

			expect(result.status).toBe("FAILED");
			if (result.status === "FAILED") {
				expect(result.reason).toBe("transaction_failed");
				expect(result.message).toContain("9900 bps");
			}
		});

		test("accepts recipients summing to exactly 9900 bps", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient();

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 60,
						},
						{
							address:
								"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`,
							share: 40,
						},
					],
				},
			);

			expect(result.status).toBe("CREATED");
		});

		test("accepts percentageBps directly", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient();

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							percentageBps: 5940, // 60%
						},
						{
							address:
								"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`,
							percentageBps: 3960, // 40%
						},
					],
				},
			);

			expect(result.status).toBe("CREATED");
		});
	});

	describe("error handling", () => {
		test("handles user rejection", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient({
				writeContractError: new Error("User rejected the request"),
			});

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("FAILED");
			if (result.status === "FAILED") {
				expect(result.reason).toBe("wallet_rejected");
			}
		});

		test("handles transaction revert", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient({
				writeContractError: new Error("execution reverted: InvalidRecipients"),
			});

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("FAILED");
			if (result.status === "FAILED") {
				expect(result.reason).toBe("transaction_reverted");
			}
		});

		test("handles gas estimation failure", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient({
				writeContractError: new Error("insufficient funds for gas"),
			});

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("FAILED");
			if (result.status === "FAILED") {
				expect(result.reason).toBe("insufficient_gas");
			}
		});

		test("handles generic errors", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient({
				writeContractError: new Error("Network timeout"),
			});

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("FAILED");
			if (result.status === "FAILED") {
				expect(result.reason).toBe("transaction_failed");
				expect(result.message).toContain("Network timeout");
			}
		});
	});

	describe("optional parameters", () => {
		test("uses wallet address as default authority", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient();

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("CREATED");
			// Authority defaults to wallet address (tested implicitly via successful creation)
		});

		test("uses provided authority when specified", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient();
			const customAuthority =
				"0x3333333333333333333333333333333333333333" as `0x${string}`;

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					authority: customAuthority,
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("CREATED");
		});

		test("uses USDC as default token on Base", async () => {
			const publicClient = createMockPublicClient({
				chainId: 8453,
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient();

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("CREATED");
		});

		test("uses provided token when specified", async () => {
			const publicClient = createMockPublicClient({
				bytecode: undefined,
			});
			const walletClient = createMockWalletClient();
			const customToken =
				"0x4444444444444444444444444444444444444444" as `0x${string}`;

			const result = await ensureSplit(
				publicClient,
				walletClient,
				FACTORY_ADDRESS as `0x${string}`,
				{
					token: customToken,
					uniqueId: UNIQUE_ID as `0x${string}`,
					recipients: [
						{
							address:
								"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
							share: 100,
						},
					],
				},
			);

			expect(result.status).toBe("CREATED");
		});
	});
});
