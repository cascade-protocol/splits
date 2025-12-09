/**
 * Tests for executeSplit with mocked viem clients.
 */

import { describe, test, expect, vi } from "vitest";
import type { PublicClient, WalletClient, Account } from "viem";
import { executeSplit } from "../src/execute.js";

// =============================================================================
// Test Data
// =============================================================================

const SPLIT_ADDRESS = "0x2222222222222222222222222222222222222222";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const TX_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

// =============================================================================
// Mock Factories
// =============================================================================

function createMockAccount(): Account {
  return {
    address: WALLET_ADDRESS,
    type: "local",
  } as unknown as Account;
}

interface MockContractReadResults {
  isCascadeSplitConfig?: boolean;
  getBalance?: bigint;
  hasPendingFunds?: boolean;
}

function createMockPublicClient(
  overrides: MockContractReadResults = {},
): PublicClient {
  const readContract = vi
    .fn()
    .mockImplementation(async (args: { functionName: string }) => {
      switch (args.functionName) {
        case "isCascadeSplitConfig":
          return overrides.isCascadeSplitConfig ?? true;
        case "getBalance":
          return overrides.getBalance ?? 1000000n;
        case "hasPendingFunds":
          return overrides.hasPendingFunds ?? true;
        default:
          throw new Error(`Unknown function: ${args.functionName}`);
      }
    });

  return {
    getChainId: vi.fn().mockResolvedValue(8453),
    readContract,
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    chain: { id: 8453 },
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

describe("executeSplit", () => {
  describe("basic execution flow", () => {
    test("executes split successfully", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient();

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
      );

      expect(result.status).toBe("EXECUTED");
      if (result.status === "EXECUTED") {
        expect(result.signature).toBe(TX_HASH);
      }
    });
  });

  describe("skip conditions", () => {
    test("skips when address is not a split", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: false,
      });
      const walletClient = createMockWalletClient();

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
      );

      expect(result.status).toBe("SKIPPED");
      if (result.status === "SKIPPED") {
        expect(result.reason).toBe("not_a_split");
      }
    });

    test("skips when balance is below threshold", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        getBalance: 500000n, // 0.5 USDC
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient();

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
        { minBalance: 1000000n }, // 1 USDC threshold
      );

      expect(result.status).toBe("SKIPPED");
      if (result.status === "SKIPPED") {
        expect(result.reason).toBe("below_threshold");
      }
    });

    test("skips when no pending funds", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        hasPendingFunds: false,
      });
      const walletClient = createMockWalletClient();

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
      );

      expect(result.status).toBe("SKIPPED");
      if (result.status === "SKIPPED") {
        expect(result.reason).toBe("no_pending_funds");
      }
    });
  });

  describe("wallet validation", () => {
    test("fails when wallet not connected", async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient({
        account: undefined,
      });

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
      );

      expect(result.status).toBe("FAILED");
      if (result.status === "FAILED") {
        expect(result.reason).toBe("wallet_disconnected");
      }
    });
  });

  describe("error handling", () => {
    test("handles user rejection", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient({
        writeContractError: new Error("User rejected the request"),
      });

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
      );

      expect(result.status).toBe("FAILED");
      if (result.status === "FAILED") {
        expect(result.reason).toBe("wallet_rejected");
      }
    });

    test("handles transaction revert", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient({
        writeContractError: new Error(
          "execution reverted: NothingToDistribute",
        ),
      });

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
      );

      expect(result.status).toBe("FAILED");
      if (result.status === "FAILED") {
        expect(result.reason).toBe("transaction_reverted");
      }
    });

    test("handles gas estimation failure", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient({
        writeContractError: new Error("insufficient funds for gas"),
      });

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
      );

      expect(result.status).toBe("FAILED");
      if (result.status === "FAILED") {
        expect(result.reason).toBe("insufficient_gas");
      }
    });

    test("handles generic errors", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient({
        writeContractError: new Error("RPC unavailable"),
      });

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
      );

      expect(result.status).toBe("FAILED");
      if (result.status === "FAILED") {
        expect(result.reason).toBe("transaction_failed");
        expect(result.message).toContain("RPC unavailable");
      }
    });
  });

  describe("threshold options", () => {
    test("executes when balance meets threshold", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        getBalance: 1000000n, // Exactly 1 USDC
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient();

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
        { minBalance: 1000000n },
      );

      expect(result.status).toBe("EXECUTED");
    });

    test("executes when balance exceeds threshold", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        getBalance: 5000000n, // 5 USDC
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient();

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
        { minBalance: 1000000n },
      );

      expect(result.status).toBe("EXECUTED");
    });

    test("executes without threshold option", async () => {
      const publicClient = createMockPublicClient({
        isCascadeSplitConfig: true,
        getBalance: 100n, // Very small amount
        hasPendingFunds: true,
      });
      const walletClient = createMockWalletClient();

      const result = await executeSplit(
        publicClient,
        walletClient,
        SPLIT_ADDRESS as `0x${string}`,
        // No minBalance specified
      );

      expect(result.status).toBe("EXECUTED");
    });
  });
});
