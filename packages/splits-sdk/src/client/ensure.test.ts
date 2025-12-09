/**
 * Tests for ensureSplit client implementation
 *
 * Tests the high-level client API with mocked wallet and RPC
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import type {
  Address,
  Rpc,
  SolanaRpcApi,
  Signature,
  Blockhash,
} from "@solana/kit";
import type { SplitsWallet } from "./types.js";

// Mock helpers
vi.mock("../helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers.js")>();
  return {
    ...actual,
    deriveSplitConfig: vi.fn(),
    deriveVault: vi.fn(),
    getSplitConfig: vi.fn(),
    getVaultBalance: vi.fn(),
    checkRecipientAtas: vi.fn(),
    detectTokenProgram: vi.fn(),
    labelToSeed: actual.labelToSeed,
    recipientsEqual: actual.recipientsEqual,
  };
});

// Mock instructions
vi.mock("../instructions.js", () => ({
  createSplitConfig: vi.fn(),
  updateSplitConfig: vi.fn(),
}));

// Mock buildTransaction - returns kit TransactionMessage structure
vi.mock("./buildTransaction.js", () => ({
  buildTransaction: vi.fn(async () => ({
    feePayer: "A1ice111111111111111111111111111111111111111",
    instructions: [],
    lifetimeConstraint: {
      blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi",
      lastValidBlockHeight: 1000n,
    },
  })),
}));

import {
  deriveSplitConfig,
  deriveVault,
  getSplitConfig,
  getVaultBalance,
  checkRecipientAtas,
  detectTokenProgram,
  labelToSeed,
  type SplitRecipient,
} from "../helpers.js";
import { createSplitConfig, updateSplitConfig } from "../instructions.js";
import { ensureSplitImpl } from "./ensure.js";
import { SplitConfigNotFoundError } from "../errors.js";

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
const mockSignature =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW" as Signature;
const mockBlockhash =
  "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi" as Blockhash;

type MockRpc = Rpc<SolanaRpcApi>;

const createMockRpc = (): MockRpc => {
  const rpc = {
    getLatestBlockhash: vi.fn(() => ({
      send: vi.fn(async () => ({
        value: {
          blockhash: mockBlockhash,
          lastValidBlockHeight: 1000n,
        },
      })),
    })),
    getMinimumBalanceForRentExemption: vi.fn(() => ({
      send: vi.fn(async () => 14616000n),
    })),
  };
  return rpc as unknown as MockRpc;
};

const createMockWallet = (address: Address = mockAlice): SplitsWallet => ({
  address,
  signAndSend: vi.fn(async () => mockSignature),
});

const createMockSplitConfig = (overrides?: {
  recipients?: SplitRecipient[];
  unclaimedAmounts?: Array<{
    recipient: Address;
    amount: bigint;
    timestamp: bigint;
  }>;
  protocolUnclaimed?: bigint;
}) => ({
  address: mockSplitConfig,
  version: 1,
  authority: mockAlice,
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

describe("ensureSplitImpl", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(deriveSplitConfig).mockResolvedValue(mockSplitConfig);
    vi.mocked(deriveVault).mockResolvedValue(mockVault);
    vi.mocked(detectTokenProgram).mockResolvedValue(mockTokenProgram);
    vi.mocked(checkRecipientAtas).mockResolvedValue([]);
    vi.mocked(getVaultBalance).mockResolvedValue(0n);
  });

  test("returns created for new config", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );
    vi.mocked(createSplitConfig).mockResolvedValue({
      instruction: {
        programAddress:
          "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
        accounts: [],
        data: new Uint8Array(),
      },
      vault: mockVault,
      splitConfig: mockSplitConfig,
    });

    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [
          { address: mockAlice as string, share: 70 },
          { address: mockBob as string, share: 29 },
        ],
      },
      {},
    );

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.vault).toBe(mockVault);
      expect(result.splitConfig).toBe(mockSplitConfig);
      expect(result.signature).toBe(mockSignature);
      expect(result.rentPaid).toBeGreaterThan(0n);
    }
  });

  test("returns no_change when recipients match", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);

    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [
          { address: mockAlice as string, share: 70 },
          { address: mockBob as string, share: 29 },
        ],
      },
      {},
    );

    expect(result.status).toBe("no_change");
    if (result.status === "no_change") {
      expect(result.vault).toBe(mockVault);
    }
    // Should not call signAndSend
    expect(wallet.signAndSend).not.toHaveBeenCalled();
  });

  test("returns no_change when recipients match (different order)", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);

    // Recipients in different order
    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [
          { address: mockBob as string, share: 29 },
          { address: mockAlice as string, share: 70 },
        ],
      },
      {},
    );

    expect(result.status).toBe("no_change");
  });

  test("returns updated when recipients differ and vault empty", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(getVaultBalance).mockResolvedValue(0n);
    vi.mocked(updateSplitConfig).mockResolvedValue({
      programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
      accounts: [],
      data: new Uint8Array(),
    });

    // Different shares
    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [
          { address: mockAlice as string, share: 60 },
          { address: mockBob as string, share: 39 },
        ],
      },
      {},
    );

    expect(result.status).toBe("updated");
    if (result.status === "updated") {
      expect(result.signature).toBe(mockSignature);
    }
  });

  test("returns blocked vault_not_empty when vault has balance", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(getVaultBalance).mockResolvedValue(1_000_000n); // 1 USDC

    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [
          { address: mockAlice as string, share: 60 },
          { address: mockBob as string, share: 39 },
        ],
      },
      {},
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("vault_not_empty");
      expect(result.message).toContain("Execute the split first");
    }
  });

  test("returns blocked unclaimed_pending when unclaimed exists", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    const existingConfig = createMockSplitConfig({
      unclaimedAmounts: [
        { recipient: mockAlice, amount: 100_000n, timestamp: 0n },
      ],
    });
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(getVaultBalance).mockResolvedValue(0n);

    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [
          { address: mockAlice as string, share: 60 },
          { address: mockBob as string, share: 39 },
        ],
      },
      {},
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("unclaimed_pending");
    }
  });

  test("returns blocked recipient_atas_missing on create with missing ATAs when opt-out", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );
    vi.mocked(checkRecipientAtas).mockResolvedValue([
      { recipient: mockAlice, ata: "MissingAta1" as Address },
    ]);

    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [{ address: mockAlice as string, share: 99 }],
        createMissingAtas: false, // Opt-out of auto-creation
      },
      {},
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("recipient_atas_missing");
    }
  });

  test("returns blocked recipient_atas_missing on update with missing ATAs when opt-out", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    const existingConfig = createMockSplitConfig();
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(checkRecipientAtas).mockResolvedValue([
      { recipient: mockAlice, ata: "MissingAta1" as Address },
    ]);

    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [
          { address: mockAlice as string, share: 60 },
          { address: mockBob as string, share: 39 },
        ],
        createMissingAtas: false, // Opt-out of auto-creation
      },
      {},
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("recipient_atas_missing");
    }
  });

  test("uses labelToSeed for uniqueId derivation", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );
    vi.mocked(createSplitConfig).mockResolvedValue({
      instruction: {
        programAddress:
          "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
        accounts: [],
        data: new Uint8Array(),
      },
      vault: mockVault,
      splitConfig: mockSplitConfig,
    });

    const hashedSeed = labelToSeed("my-revenue-share");

    await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [{ address: mockAlice as string, share: 99 }],
        uniqueId: hashedSeed,
      },
      {},
    );

    // deriveSplitConfig should be called with the hashed seed
    expect(deriveSplitConfig).toHaveBeenCalled();
    const callArgs = vi.mocked(deriveSplitConfig).mock.calls[0];
    expect(callArgs?.[2]).toBe(hashedSeed);
  });

  test("returns blocked protocolUnclaimed > 0", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    const existingConfig = createMockSplitConfig({
      protocolUnclaimed: 50_000n,
    });
    vi.mocked(getSplitConfig).mockResolvedValue(existingConfig);
    vi.mocked(getVaultBalance).mockResolvedValue(0n);

    const result = await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [
          { address: mockAlice as string, share: 60 },
          { address: mockBob as string, share: 39 },
        ],
      },
      {},
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("unclaimed_pending");
    }
  });

  test("calls wallet.signAndSend on create", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );
    vi.mocked(createSplitConfig).mockResolvedValue({
      instruction: {
        programAddress:
          "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
        accounts: [],
        data: new Uint8Array(),
      },
      vault: mockVault,
      splitConfig: mockSplitConfig,
    });

    await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [{ address: mockAlice as string, share: 99 }],
      },
      {},
    );

    expect(wallet.signAndSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ commitment: "confirmed" }),
    );
  });

  test("uses custom commitment when provided", async () => {
    const rpc = createMockRpc();
    const wallet = createMockWallet();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );
    vi.mocked(createSplitConfig).mockResolvedValue({
      instruction: {
        programAddress:
          "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
        accounts: [],
        data: new Uint8Array(),
      },
      vault: mockVault,
      splitConfig: mockSplitConfig,
    });

    await ensureSplitImpl(
      rpc,
      wallet,
      {
        recipients: [{ address: mockAlice as string, share: 99 }],
      },
      { commitment: "finalized" },
    );

    expect(wallet.signAndSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ commitment: "finalized" }),
    );
  });
});
