/**
 * Tests for estimateSplitRent
 *
 * Uses Vitest mocking to test rent estimation logic
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";

// Mock helpers module
vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return {
    ...actual,
    deriveSplitConfig: vi.fn(),
    deriveVault: vi.fn(),
    getSplitConfig: vi.fn(),
    detectTokenProgram: vi.fn(),
  };
});

import {
  deriveSplitConfig,
  deriveVault,
  getSplitConfig,
  detectTokenProgram,
  type SplitRecipient,
} from "./helpers.js";
import { estimateSplitRent } from "./estimateSplitRent.js";
import { SplitConfigNotFoundError } from "./errors.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const mockAuthority = "Auth1111111111111111111111111111111111111111" as Address;
const mockSplitConfig =
  "SpCfg111111111111111111111111111111111111111" as Address;
const mockVault = "Vault111111111111111111111111111111111111111" as Address;
const mockTokenProgram =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const mockAlice = "A1ice111111111111111111111111111111111111111" as Address;
const mockBob = "Bob11111111111111111111111111111111111111111" as Address;

type MockRpc = Rpc<SolanaRpcApi>;

const createMockRpc = (splitConfigRent = 14616000n, vaultRent = 2039280n) => {
  const rpc = {
    getMinimumBalanceForRentExemption: vi.fn((size: bigint) => ({
      send: vi.fn(async () => {
        if (size === 1832n) return splitConfigRent;
        if (size === 165n) return vaultRent;
        return 0n;
      }),
    })),
  };
  return rpc as unknown as MockRpc;
};

const createMockSplitConfig = (): {
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
  authority: mockAuthority,
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
  vault: mockVault,
  uniqueId: "11111111111111111111111111111111" as Address,
  bump: 255,
  recipients: [
    { address: mockAlice, percentageBps: 6930, share: 70 },
    { address: mockBob, percentageBps: 2871, share: 29 },
  ],
  unclaimedAmounts: [],
  protocolUnclaimed: 0n,
  lastActivity: 0n,
  rentPayer: mockAuthority,
});

// =============================================================================
// Tests
// =============================================================================

describe("estimateSplitRent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(deriveSplitConfig).mockResolvedValue(mockSplitConfig);
    vi.mocked(deriveVault).mockResolvedValue(mockVault);
    vi.mocked(detectTokenProgram).mockResolvedValue(mockTokenProgram);
  });

  test("returns correct rent amounts", async () => {
    const rpc = createMockRpc();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );

    const result = await estimateSplitRent(rpc, {
      authority: mockAuthority,
      recipients: [
        { address: mockAlice as string, share: 70 },
        { address: mockBob as string, share: 29 },
      ],
    });

    expect(result.splitConfigRent).toBe(14616000n);
    expect(result.vaultRent).toBe(2039280n);
    expect(result.rentRequired).toBe(14616000n + 2039280n);
  });

  test("returns existsOnChain: true for existing config", async () => {
    const rpc = createMockRpc();
    const mockConfig = createMockSplitConfig();

    vi.mocked(getSplitConfig).mockResolvedValue(mockConfig);

    const result = await estimateSplitRent(rpc, {
      authority: mockAuthority,
      recipients: [
        { address: mockAlice as string, share: 70 },
        { address: mockBob as string, share: 29 },
      ],
    });

    expect(result.existsOnChain).toBe(true);
  });

  test("returns currentRecipients when exists", async () => {
    const rpc = createMockRpc();
    const mockConfig = createMockSplitConfig();

    vi.mocked(getSplitConfig).mockResolvedValue(mockConfig);

    const result = await estimateSplitRent(rpc, {
      authority: mockAuthority,
      recipients: [
        { address: mockAlice as string, share: 70 },
        { address: mockBob as string, share: 29 },
      ],
    });

    expect(result.currentRecipients).toEqual(mockConfig.recipients);
    expect(result.currentRecipients?.length).toBe(2);
  });

  test("derives correct addresses", async () => {
    const rpc = createMockRpc();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );

    const result = await estimateSplitRent(rpc, {
      authority: mockAuthority,
      recipients: [{ address: mockAlice as string, share: 99 }],
    });

    expect(result.vault).toBe(mockVault);
    expect(result.splitConfig).toBe(mockSplitConfig);

    // Verify derivation was called with correct params
    expect(deriveSplitConfig).toHaveBeenCalledWith(
      mockAuthority,
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC_MINT
      "11111111111111111111111111111111", // SYSTEM_PROGRAM_ID (default seed)
    );
  });

  test("returns existsOnChain: false and undefined currentRecipients when not exists", async () => {
    const rpc = createMockRpc();

    vi.mocked(getSplitConfig).mockRejectedValue(
      new SplitConfigNotFoundError(mockSplitConfig),
    );

    const result = await estimateSplitRent(rpc, {
      authority: mockAuthority,
      recipients: [{ address: mockAlice as string, share: 99 }],
    });

    expect(result.existsOnChain).toBe(false);
    expect(result.currentRecipients).toBeUndefined();
  });
});
