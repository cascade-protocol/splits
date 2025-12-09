/**
 * Tests for closeSplit
 *
 * Uses Vitest mocking to test idempotent close logic
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import type {
  Address,
  TransactionSigner,
  Rpc,
  SolanaRpcApi,
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
} from "@solana/kit";

// Mock @solana/kit transaction functions
vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return {
    ...actual,
    sendAndConfirmTransactionFactory: vi.fn(),
    createTransactionMessage: vi.fn(() => ({})),
    setTransactionMessageFeePayerSigner: vi.fn((_signer, msg) => msg),
    setTransactionMessageLifetimeUsingBlockhash: vi.fn(
      (_blockhash, msg) => msg,
    ),
    appendTransactionMessageInstructions: vi.fn((_instructions, msg) => msg),
    signTransactionMessageWithSigners: vi.fn(async () => ({
      messageBytes: new Uint8Array(),
      signatures: {},
      lifetimeConstraint: { lastValidBlockHeight: 1000n },
    })),
    getSignatureFromTransaction: vi.fn(
      () =>
        "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
    ),
    assertIsTransactionWithBlockhashLifetime: vi.fn(),
    pipe: vi.fn((initial, ...fns) => fns.reduce((acc, fn) => fn(acc), initial)),
  };
});

// Mock @solana-program/compute-budget
vi.mock("@solana-program/compute-budget", () => ({
  getSetComputeUnitPriceInstruction: vi.fn(() => ({
    programAddress: "ComputeBudget111111111111111111111111111111" as Address,
    accounts: [],
    data: new Uint8Array(),
  })),
}));

// Mock helpers
vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return {
    ...actual,
    getSplitConfig: vi.fn(),
    getVaultBalance: vi.fn(),
    detectTokenProgram: vi.fn(),
    checkRecipientAtas: vi.fn(),
    getCreateAtaInstructions: vi.fn(() => []),
  };
});

// Mock instructions
vi.mock("./instructions.js", () => ({
  closeSplitConfig: vi.fn(),
  executeSplit: vi.fn(),
}));

import { sendAndConfirmTransactionFactory } from "@solana/kit";
import {
  getSplitConfig,
  getVaultBalance,
  detectTokenProgram,
  checkRecipientAtas,
  type SplitRecipient,
} from "./helpers.js";
import { closeSplitConfig, executeSplit } from "./instructions.js";
import { closeSplit } from "./closeSplit.js";
import { SplitConfigNotFoundError } from "./errors.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const mockSplitConfig =
  "SpCfg111111111111111111111111111111111111111" as Address;
const mockVault = "Vault111111111111111111111111111111111111111" as Address;
const mockTokenProgram =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const mockAlice = "A1ice111111111111111111111111111111111111111" as Address;
const mockBob = "Bob11111111111111111111111111111111111111111" as Address;
const mockUsdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const mockRentPayer = "RentPayer1111111111111111111111111111111111" as Address;

type MockRpc = Rpc<SolanaRpcApi>;
type MockRpcSubscriptions = RpcSubscriptions<
  SignatureNotificationsApi & SlotNotificationsApi
>;

const createMockRpc = (): MockRpc => {
  const rpc = {
    getLatestBlockhash: vi.fn(() => ({
      send: vi.fn(async () => ({
        value: {
          blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi",
          lastValidBlockHeight: 1000n,
        },
      })),
    })),
    getMinimumBalanceForRentExemption: vi.fn((size: bigint) => ({
      send: vi.fn(async () => {
        if (size === 1832n) return 14616000n;
        if (size === 165n) return 2039280n;
        return 0n;
      }),
    })),
  };
  return rpc as unknown as MockRpc;
};

const createMockRpcSubscriptions = (): MockRpcSubscriptions => {
  return {} as MockRpcSubscriptions;
};

const createMockSigner = (address: Address = mockAlice): TransactionSigner => {
  return {
    address,
    signTransactions: vi.fn(),
  } as unknown as TransactionSigner;
};

const createMockSplitConfig = (overrides?: {
  authority?: Address;
  rentPayer?: Address;
  recipients?: SplitRecipient[];
  unclaimedAmounts?: Array<{
    recipient: Address;
    amount: bigint;
    timestamp: bigint;
  }>;
  protocolUnclaimed?: bigint;
}): {
  address: Address;
  version: number;
  authority: Address;
  mint: Address;
  vault: Address;
  uniqueId: Address;
  bump: number;
  recipients: SplitRecipient[];
  unclaimedAmounts: Array<{
    recipient: Address;
    amount: bigint;
    timestamp: bigint;
  }>;
  protocolUnclaimed: bigint;
  lastActivity: bigint;
  rentPayer: Address;
} => ({
  address: mockSplitConfig,
  version: 1,
  authority: overrides?.authority ?? mockAlice,
  mint: mockUsdc,
  vault: mockVault,
  uniqueId: "11111111111111111111111111111111" as Address,
  bump: 255,
  recipients: overrides?.recipients ?? [
    { address: mockAlice, percentageBps: 6930, share: 70 },
    { address: mockBob, percentageBps: 2871, share: 29 },
  ],
  unclaimedAmounts: overrides?.unclaimedAmounts ?? [],
  protocolUnclaimed: overrides?.protocolUnclaimed ?? 0n,
  lastActivity: 0n,
  rentPayer: overrides?.rentPayer ?? mockRentPayer,
});

// =============================================================================
// Tests
// =============================================================================

describe("closeSplit", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(detectTokenProgram).mockResolvedValue(mockTokenProgram);
    vi.mocked(getVaultBalance).mockResolvedValue(0n);
    vi.mocked(checkRecipientAtas).mockResolvedValue([]);

    // Default send and confirm
    const mockSendAndConfirm = vi.fn().mockResolvedValue(undefined);
    vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
      mockSendAndConfirm,
    );
  });

  test("returns closed with rent recovered", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(closeSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    const result = await closeSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
    });

    expect(result.status).toBe("closed");
    if (result.status === "closed") {
      expect(result.rentRecovered).toBe(14616000n + 2039280n);
      expect(result.signature).toBeDefined();
    }
  });

  test("returns already_closed for non-existent splitConfig", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );

    const result = await closeSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
    });

    expect(result.status).toBe("already_closed");
  });

  test("auto-executes when vault has balance", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(getVaultBalance).mockResolvedValue(1_000_000n);
    vi.mocked(executeSplit).mockResolvedValue({
      status: "success",
      instruction: {
        programAddress:
          "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
        accounts: [],
        data: new Uint8Array(),
      },
    });
    vi.mocked(closeSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    const result = await closeSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
    });

    expect(result.status).toBe("closed");
    expect(executeSplit).toHaveBeenCalled();
  });

  test("auto-executes when unclaimed pending", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    const existingConfig = createMockSplitConfig({
      unclaimedAmounts: [
        { recipient: mockAlice, amount: 100_000n, timestamp: 0n },
      ],
    });
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(executeSplit).mockResolvedValue({
      status: "success",
      instruction: {
        programAddress:
          "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
        accounts: [],
        data: new Uint8Array(),
      },
    });
    vi.mocked(closeSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    const result = await closeSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
    });

    expect(result.status).toBe("closed");
    expect(executeSplit).toHaveBeenCalled();
  });

  test("returns blocked not_authority when signer != authority", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner(mockBob); // Different address

    const existingConfig = createMockSplitConfig({ authority: mockAlice });
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);

    const result = await closeSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
    });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("not_authority");
    }
  });

  test("uses rentPayer from config as rent_destination", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    const existingConfig = createMockSplitConfig({
      rentPayer: mockRentPayer,
    });
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(closeSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    await closeSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
    });

    // Verify closeSplitConfig was called with rentPayer from config
    expect(closeSplitConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        rentReceiver: mockRentPayer,
      }),
    );
  });

  test("auto-executes when protocolUnclaimed > 0", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    const existingConfig = createMockSplitConfig({
      protocolUnclaimed: 50_000n,
    });
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(executeSplit).mockResolvedValue({
      status: "success",
      instruction: {
        programAddress:
          "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
        accounts: [],
        data: new Uint8Array(),
      },
    });
    vi.mocked(closeSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    const result = await closeSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
    });

    expect(result.status).toBe("closed");
    expect(executeSplit).toHaveBeenCalled();
  });
});
