/**
 * Tests for updateSplit
 *
 * Uses Vitest mocking to test idempotent update logic
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
    checkRecipientAtas: vi.fn(),
    detectTokenProgram: vi.fn(),
    getCreateAtaInstructions: vi.fn(() => []),
    recipientsEqual: actual.recipientsEqual, // Use real implementation
  };
});

// Mock instructions
vi.mock("./instructions.js", () => ({
  updateSplitConfig: vi.fn(),
  executeSplit: vi.fn(),
}));

import { sendAndConfirmTransactionFactory } from "@solana/kit";
import {
  getSplitConfig,
  getVaultBalance,
  checkRecipientAtas,
  detectTokenProgram,
  type SplitRecipient,
} from "./helpers.js";
import { updateSplitConfig, executeSplit } from "./instructions.js";
import { updateSplit } from "./updateSplit.js";
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
  rentPayer: mockAlice,
});

// =============================================================================
// Tests
// =============================================================================

describe("updateSplit", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(detectTokenProgram).mockResolvedValue(mockTokenProgram);
    vi.mocked(checkRecipientAtas).mockResolvedValue([]);
    vi.mocked(getVaultBalance).mockResolvedValue(0n);

    // Default send and confirm
    const mockSendAndConfirm = vi.fn().mockResolvedValue(undefined);
    vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
      mockSendAndConfirm,
    );
  });

  test("returns updated when recipients differ", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(updateSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    const result = await updateSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
      recipients: [
        { address: mockAlice as string, share: 60 },
        { address: mockBob as string, share: 39 },
      ],
    });

    expect(result.status).toBe("updated");
    if (result.status === "updated") {
      expect(result.signature).toBeDefined();
    }
  });

  test("returns no_change when recipients match", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);

    const result = await updateSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
      recipients: [
        { address: mockAlice as string, share: 70 },
        { address: mockBob as string, share: 29 },
      ],
    });

    expect(result.status).toBe("no_change");
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
    vi.mocked(updateSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    const result = await updateSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
      recipients: [
        { address: mockAlice as string, share: 60 },
        { address: mockBob as string, share: 39 },
      ],
    });

    expect(result.status).toBe("updated");
    expect(executeSplit).toHaveBeenCalled();
  });

  test("returns blocked when split not found", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );

    const result = await updateSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
      recipients: [{ address: mockAlice as string, share: 99 }],
    });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      // Uses not_authority with a descriptive message for "not found" case
      expect(result.reason).toBe("not_authority");
      expect(result.message).toContain("Split not found");
    }
  });

  test("returns blocked not_authority when signer != authority", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner(mockBob); // Different address

    const existingConfig = createMockSplitConfig({ authority: mockAlice });
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);

    const result = await updateSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
      recipients: [
        { address: mockAlice as string, share: 60 },
        { address: mockBob as string, share: 39 },
      ],
    });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("not_authority");
    }
  });

  test("auto-executes when unclaimed exists", async () => {
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
    vi.mocked(updateSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    const result = await updateSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
      recipients: [
        { address: mockAlice as string, share: 60 },
        { address: mockBob as string, share: 39 },
      ],
    });

    expect(result.status).toBe("updated");
    expect(executeSplit).toHaveBeenCalled();
  });

  test("returns blocked recipient_atas_missing when ATAs missing and createMissingAtas=false", async () => {
    const rpc = createMockRpc();
    const rpcSubscriptions = createMockRpcSubscriptions();
    const signer = createMockSigner();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(checkRecipientAtas).mockResolvedValue([
      { recipient: mockAlice, ata: "MissingAta1" as Address },
    ]);

    const result = await updateSplit({
      rpc,
      rpcSubscriptions,
      signer,
      splitConfig: mockSplitConfig,
      recipients: [
        { address: mockAlice as string, share: 60 },
        { address: mockBob as string, share: 39 },
      ],
      createMissingAtas: false, // Opt-out of auto-creation
    });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("recipient_atas_missing");
    }
  });
});
