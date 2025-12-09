/**
 * Tests for helpers.ts - PDA derivation and sync message compilation
 */

import { describe, test, expect } from "vitest";
import type { Address } from "@solana/kit";
import {
  compileToSynchronousMessage,
  deriveProgramConfig,
  deriveSettings,
  deriveSmartAccount,
  deriveSpendingLimit,
  deriveAta,
} from "./helpers.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const ALICE = "A1ice111111111111111111111111111111111111111" as Address;
const BOB = "Bob11111111111111111111111111111111111111111" as Address;
const CHARLIE = "Char1ie11111111111111111111111111111111111111" as Address;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

// USDC mint for ATA tests
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;

// =============================================================================
// PDA Derivation Tests
// =============================================================================

describe("deriveProgramConfig", () => {
  test("returns deterministic address", async () => {
    const pda1 = await deriveProgramConfig();
    const pda2 = await deriveProgramConfig();

    expect(pda1).toBe(pda2);
    expect(typeof pda1).toBe("string");
    expect(pda1.length).toBe(44); // base58 pubkey length
  });
});

describe("deriveSettings", () => {
  test("accountIndex = 0n (first account)", async () => {
    const pda = await deriveSettings(0n);

    expect(typeof pda).toBe("string");
    expect(pda.length).toBe(44);
  });

  test("accountIndex = 2^64 (beyond u64, tests u128 encoding)", async () => {
    const pda = await deriveSettings(2n ** 64n);

    expect(typeof pda).toBe("string");
    expect(pda.length).toBe(44);
  });

  test("accountIndex = 2^128 - 1 (max u128)", async () => {
    const pda = await deriveSettings(2n ** 128n - 1n);

    expect(typeof pda).toBe("string");
    expect(pda.length).toBe(44);
  });

  test("same index returns same PDA (determinism)", async () => {
    const pda1 = await deriveSettings(42n);
    const pda2 = await deriveSettings(42n);

    expect(pda1).toBe(pda2);
  });

  test("different indices return different PDAs", async () => {
    const pda0 = await deriveSettings(0n);
    const pda1 = await deriveSettings(1n);

    expect(pda0).not.toBe(pda1);
  });
});

describe("deriveSmartAccount", () => {
  test("vaultIndex = 0 (default)", async () => {
    const settings = await deriveSettings(0n);
    const vault = await deriveSmartAccount(settings, 0);

    expect(typeof vault).toBe("string");
    expect(vault.length).toBe(44);
  });

  test("vaultIndex = 255 (max u8)", async () => {
    const settings = await deriveSettings(0n);
    const vault = await deriveSmartAccount(settings, 255);

    expect(typeof vault).toBe("string");
    expect(vault.length).toBe(44);
  });

  test("different settings produce different vaults", async () => {
    const settings0 = await deriveSettings(0n);
    const settings1 = await deriveSettings(1n);

    const vault0 = await deriveSmartAccount(settings0, 0);
    const vault1 = await deriveSmartAccount(settings1, 0);

    expect(vault0).not.toBe(vault1);
  });

  test("same settings, different vault index produces different vaults", async () => {
    const settings = await deriveSettings(0n);

    const vault0 = await deriveSmartAccount(settings, 0);
    const vault1 = await deriveSmartAccount(settings, 1);

    expect(vault0).not.toBe(vault1);
  });

  test("same inputs return same PDA (determinism)", async () => {
    const settings = await deriveSettings(0n);

    const vault1 = await deriveSmartAccount(settings, 0);
    const vault2 = await deriveSmartAccount(settings, 0);

    expect(vault1).toBe(vault2);
  });
});

describe("deriveSpendingLimit", () => {
  test("same inputs return same PDA (determinism)", async () => {
    const settings = await deriveSettings(0n);

    const limit1 = await deriveSpendingLimit(settings, ALICE);
    const limit2 = await deriveSpendingLimit(settings, ALICE);

    expect(limit1).toBe(limit2);
  });

  test("different seeds produce different PDAs", async () => {
    const settings = await deriveSettings(0n);

    const limitAlice = await deriveSpendingLimit(settings, ALICE);
    const limitBob = await deriveSpendingLimit(settings, BOB);

    expect(limitAlice).not.toBe(limitBob);
  });

  test("different settings produce different PDAs", async () => {
    const settings0 = await deriveSettings(0n);
    const settings1 = await deriveSettings(1n);

    const limit0 = await deriveSpendingLimit(settings0, ALICE);
    const limit1 = await deriveSpendingLimit(settings1, ALICE);

    expect(limit0).not.toBe(limit1);
  });
});

describe("deriveAta", () => {
  test("default token program (SPL Token)", async () => {
    const ata = await deriveAta(ALICE, USDC_MINT);

    expect(typeof ata).toBe("string");
    expect(ata.length).toBe(44);
  });

  test("explicit SPL Token program matches default", async () => {
    const ataDefault = await deriveAta(ALICE, USDC_MINT);
    const ataExplicit = await deriveAta(
      ALICE,
      USDC_MINT,
      TOKEN_PROGRAM_ID as Address,
    );

    expect(ataDefault).toBe(ataExplicit);
  });

  test("Token-2022 produces different ATA", async () => {
    const ataSpl = await deriveAta(
      ALICE,
      USDC_MINT,
      TOKEN_PROGRAM_ID as Address,
    );
    const ata2022 = await deriveAta(
      ALICE,
      USDC_MINT,
      TOKEN_2022_PROGRAM_ID as Address,
    );

    expect(ataSpl).not.toBe(ata2022);
  });

  test("same inputs return same ATA (determinism)", async () => {
    const ata1 = await deriveAta(ALICE, USDC_MINT);
    const ata2 = await deriveAta(ALICE, USDC_MINT);

    expect(ata1).toBe(ata2);
  });

  test("different owners produce different ATAs", async () => {
    const ataAlice = await deriveAta(ALICE, USDC_MINT);
    const ataBob = await deriveAta(BOB, USDC_MINT);

    expect(ataAlice).not.toBe(ataBob);
  });

  test("different mints produce different ATAs", async () => {
    const ataUsdc = await deriveAta(ALICE, USDC_MINT);
    const ataOther = await deriveAta(ALICE, BOB); // BOB as fake mint

    expect(ataUsdc).not.toBe(ataOther);
  });
});

// =============================================================================
// compileToSynchronousMessage Tests
// =============================================================================

describe("compileToSynchronousMessage", () => {
  test("places signers first in remaining accounts", () => {
    const vaultPda = ALICE;
    const members = [BOB];
    const instructions = [
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: CHARLIE, role: 0 }],
        data: new Uint8Array([1, 2, 3]),
      },
    ];

    const result = compileToSynchronousMessage(vaultPda, members, instructions);

    const firstAccount = result.accounts[0];
    expect(firstAccount).toBeDefined();
    expect(firstAccount?.pubkey).toBe(BOB);
    expect(firstAccount?.isSigner).toBe(true);
  });

  test("deduplicates accounts with merged permissions", () => {
    const vaultPda = ALICE;
    const members = [BOB];
    const instructions = [
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: CHARLIE, role: 0 }], // readonly
        data: new Uint8Array([1]),
      },
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: CHARLIE, role: 1 }], // writable
        data: new Uint8Array([2]),
      },
    ];

    const result = compileToSynchronousMessage(vaultPda, members, instructions);

    const charlieAccounts = result.accounts.filter((a) => a.pubkey === CHARLIE);
    expect(charlieAccounts.length).toBe(1);
    expect(charlieAccounts[0]?.isWritable).toBe(true);
  });

  test("vault is not marked as signer", () => {
    const vaultPda = ALICE;
    const members = [BOB];
    const instructions = [
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: ALICE, role: 3 }], // writable+signer
        data: new Uint8Array([1, 2, 3]),
      },
    ];

    const result = compileToSynchronousMessage(vaultPda, members, instructions);

    const vaultAccount = result.accounts.find((a) => a.pubkey === ALICE);
    expect(vaultAccount).toBeDefined();
    expect(vaultAccount?.isSigner).toBe(false);
    expect(vaultAccount?.isWritable).toBe(true);
  });

  test("serializes instructions with correct format", () => {
    const vaultPda = ALICE;
    const members = [BOB];
    const instructions = [
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: CHARLIE, role: 1 }],
        data: new Uint8Array([0xaa, 0xbb, 0xcc]),
      },
    ];

    const result = compileToSynchronousMessage(vaultPda, members, instructions);

    // First byte: number of instructions (u8)
    expect(result.instructions[0]).toBe(1);

    // Should contain the instruction data
    const dataStr = Array.from(result.instructions)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(dataStr).toContain("aabbcc");
  });

  test("handles multiple instructions", () => {
    const vaultPda = ALICE;
    const members = [BOB];
    const instructions = [
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: CHARLIE, role: 0 }],
        data: new Uint8Array([1]),
      },
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: CHARLIE, role: 0 }],
        data: new Uint8Array([2]),
      },
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: CHARLIE, role: 0 }],
        data: new Uint8Array([3]),
      },
    ];

    const result = compileToSynchronousMessage(vaultPda, members, instructions);
    expect(result.instructions[0]).toBe(3);
  });

  test("handles empty instructions array", () => {
    const vaultPda = ALICE;
    const members = [BOB];
    const instructions: Array<{
      programAddress: Address;
      accounts: Array<{ address: Address; role: number }>;
      data: Uint8Array;
    }> = [];

    const result = compileToSynchronousMessage(vaultPda, members, instructions);

    expect(result.instructions[0]).toBe(0);
    expect(result.accounts.some((a) => a.pubkey === BOB)).toBe(true);
  });

  test("includes program address in accounts", () => {
    const vaultPda = ALICE;
    const members = [BOB];
    const instructions = [
      {
        programAddress: TOKEN_PROGRAM,
        accounts: [{ address: CHARLIE, role: 0 }],
        data: new Uint8Array([1]),
      },
    ];

    const result = compileToSynchronousMessage(vaultPda, members, instructions);

    expect(result.accounts.some((a) => a.pubkey === TOKEN_PROGRAM)).toBe(true);

    const programAccount = result.accounts.find(
      (a) => a.pubkey === TOKEN_PROGRAM,
    );
    expect(programAccount?.isSigner).toBe(false);
    expect(programAccount?.isWritable).toBe(false);
  });
});
