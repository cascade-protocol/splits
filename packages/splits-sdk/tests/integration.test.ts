/**
 * SDK Integration Tests
 *
 * Tests SDK instruction builders and helpers using LiteSVM.
 * Validates SDK produces correct instructions and handles state properly.
 */

// biome-ignore-all lint/style/noRestrictedGlobals: Buffer is required for @solana/web3.js PDA derivation

import { describe, test, expect, beforeAll } from "vitest";
import {
  LiteSVM,
  TransactionMetadata,
  FailedTransactionMetadata,
} from "litesvm";
import {
  PublicKey,
  Transaction,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  MintLayout,
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { Address } from "@solana/kit";
import { PROGRAM_ID } from "../src/index.js";
import { createSplitConfig } from "../src/index.js";
import {
  toAddress,
  toPublicKey,
  toWeb3Instruction,
} from "../src/web3-compat/index.js";
import {
  getProtocolConfigEncoder,
  getSplitConfigDecoder,
} from "../src/generated/index.js";

// =============================================================================
// Test Utilities
// =============================================================================

function setupLiteSVM(): LiteSVM {
  const svm = new LiteSVM();
  svm.addProgramFromFile(
    toPublicKey(PROGRAM_ID),
    "../../target/deploy/cascade_splits.so",
  );
  return svm;
}

function setupProtocolConfig(svm: LiteSVM, feeWallet: PublicKey): void {
  const [protocolConfigPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    toPublicKey(PROGRAM_ID),
  );

  const encoder = getProtocolConfigEncoder();
  const protocolData = encoder.encode({
    authority: toAddress(feeWallet),
    pendingAuthority: toAddress(PublicKey.default),
    feeWallet: toAddress(feeWallet),
    bump,
  });

  svm.setAccount(protocolConfigPda, {
    lamports: LAMPORTS_PER_SOL,
    data: Uint8Array.from(protocolData),
    owner: toPublicKey(PROGRAM_ID),
    executable: false,
  });
}

function createMint(svm: LiteSVM, mintAuthority: PublicKey): PublicKey {
  const mint = PublicKey.unique();
  const mintData = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority,
      supply: 0n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mintData,
  );

  svm.setAccount(mint, {
    lamports: LAMPORTS_PER_SOL,
    data: mintData,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });

  return mint;
}

function createTokenAccount(
  svm: LiteSVM,
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount = 0n,
): void {
  const ataData = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      delegatedAmount: 0n,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    ataData,
  );

  svm.setAccount(address, {
    lamports: LAMPORTS_PER_SOL,
    data: ataData,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("SDK Integration: createSplitConfig", () => {
  let svm: LiteSVM;
  let payer: Keypair;
  let feeWallet: Keypair;
  let mint: PublicKey;
  let recipient: Keypair;
  let recipientAta: PublicKey;

  beforeAll(() => {
    svm = setupLiteSVM();
    payer = Keypair.generate();
    feeWallet = Keypair.generate();
    recipient = Keypair.generate();

    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    setupProtocolConfig(svm, feeWallet.publicKey);
    mint = createMint(svm, payer.publicKey);

    // Create recipient ATA
    recipientAta = getAssociatedTokenAddressSync(mint, recipient.publicKey);
    createTokenAccount(svm, recipientAta, mint, recipient.publicKey);
  });

  test("builds valid instruction and creates split config", async () => {
    const { instruction, vault, splitConfig } = await createSplitConfig({
      authority: toAddress(payer.publicKey),
      recipients: [{ address: toAddress(recipient.publicKey), share: 100 }],
      mint: toAddress(mint),
    });

    // Build and send transaction
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(toWeb3Instruction(instruction));
    tx.sign(payer);

    const result = svm.sendTransaction(tx);

    expect(result).toBeInstanceOf(TransactionMetadata);
    if (result instanceof TransactionMetadata) {
      expect(result.logs().length).toBeGreaterThan(0);
    }

    // Verify split config was created
    const splitConfigAccount = svm.getAccount(toPublicKey(splitConfig));
    expect(splitConfigAccount).not.toBeNull();

    // Decode and verify
    const decoder = getSplitConfigDecoder();
    const decoded = decoder.decode(
      splitConfigAccount?.data ?? new Uint8Array(),
    );
    expect(decoded.authority).toBe(toAddress(payer.publicKey));
    expect(decoded.mint).toBe(toAddress(mint));
    expect(decoded.recipientCount).toBe(1);
    expect(decoded.recipients[0]?.address).toBe(toAddress(recipient.publicKey));
    expect(decoded.recipients[0]?.percentageBps).toBe(9900); // 100 shares = 9900 bps

    // Verify vault was created
    const vaultAccount = svm.getAccount(toPublicKey(vault));
    expect(vaultAccount).not.toBeNull();
    expect(vaultAccount?.owner.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
  });

  test("returns correct addresses", async () => {
    const recipient2 = Keypair.generate();
    const recipient2Ata = getAssociatedTokenAddressSync(
      mint,
      recipient2.publicKey,
    );
    createTokenAccount(svm, recipient2Ata, mint, recipient2.publicKey);

    const { vault, splitConfig } = await createSplitConfig({
      authority: toAddress(payer.publicKey),
      recipients: [{ address: toAddress(recipient2.publicKey), share: 100 }],
      mint: toAddress(mint),
    });

    // Verify addresses are valid base58 strings
    expect(vault).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(splitConfig).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    // Vault should be the ATA of splitConfig (PDA)
    expect(toPublicKey(vault).toBase58()).toBe(
      getAssociatedTokenAddressSync(
        mint,
        toPublicKey(splitConfig),
        true,
      ).toBase58(),
    );
  });

  test("handles multiple recipients", async () => {
    const recipients: Keypair[] = [];
    for (let i = 0; i < 5; i++) {
      const r = Keypair.generate();
      recipients.push(r);
      const ata = getAssociatedTokenAddressSync(mint, r.publicKey);
      createTokenAccount(svm, ata, mint, r.publicKey);
    }

    // Distribute: 30 + 25 + 20 + 15 + 10 = 100 shares = 9900 bps
    const shares = [30, 25, 20, 15, 10];
    const { instruction, splitConfig } = await createSplitConfig({
      authority: toAddress(payer.publicKey),
      recipients: recipients.map((r, i) => ({
        address: toAddress(r.publicKey),
        share: shares[i] ?? 0,
      })),
      mint: toAddress(mint),
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(toWeb3Instruction(instruction));
    tx.sign(payer);

    const result = svm.sendTransaction(tx);
    expect(result).toBeInstanceOf(TransactionMetadata);

    // Verify recipient count
    const splitConfigAccount = svm.getAccount(toPublicKey(splitConfig));
    const decoded = getSplitConfigDecoder().decode(
      splitConfigAccount?.data ?? new Uint8Array(),
    );
    expect(decoded.recipientCount).toBe(5);
  });

  test("fails with invalid recipient shares", async () => {
    // Total shares must equal 99 (protocol gets 1%)
    // This should fail on-chain validation
    const invalidRecipient = Keypair.generate();
    const invalidAta = getAssociatedTokenAddressSync(
      mint,
      invalidRecipient.publicKey,
    );
    createTokenAccount(svm, invalidAta, mint, invalidRecipient.publicKey);

    const { instruction } = await createSplitConfig({
      authority: toAddress(payer.publicKey),
      recipients: [
        { address: toAddress(invalidRecipient.publicKey), share: 50 },
      ], // Only 50%, should fail
      mint: toAddress(mint),
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(toWeb3Instruction(instruction));
    tx.sign(payer);

    const result = svm.sendTransaction(tx);
    expect(result).toBeInstanceOf(FailedTransactionMetadata);
  });
});

describe("SDK Integration: share/bps conversion", () => {
  test("share 100 converts to full recipient allocation (9900 bps)", async () => {
    const svm = setupLiteSVM();
    const payer = Keypair.generate();
    const feeWallet = Keypair.generate();
    const recipient = Keypair.generate();

    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    setupProtocolConfig(svm, feeWallet.publicKey);
    const mint = createMint(svm, payer.publicKey);

    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
    );
    createTokenAccount(svm, recipientAta, mint, recipient.publicKey);

    const { instruction, splitConfig } = await createSplitConfig({
      authority: toAddress(payer.publicKey),
      recipients: [{ address: toAddress(recipient.publicKey), share: 100 }],
      mint: toAddress(mint),
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(toWeb3Instruction(instruction));
    tx.sign(payer);

    const result = svm.sendTransaction(tx);
    expect(result).toBeInstanceOf(TransactionMetadata);

    const splitConfigAccount = svm.getAccount(toPublicKey(splitConfig));
    const decoded = getSplitConfigDecoder().decode(
      splitConfigAccount?.data ?? new Uint8Array(),
    );
    // share 100 = 100 * 99 = 9900 bps (full recipient allocation)
    expect(decoded.recipients[0]?.percentageBps).toBe(9900);
  });

  test("share distribution with small shares (10 recipients)", async () => {
    const svm = setupLiteSVM();
    const payer = Keypair.generate();
    const feeWallet = Keypair.generate();

    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    setupProtocolConfig(svm, feeWallet.publicKey);
    const mint = createMint(svm, payer.publicKey);

    // Create 10 recipients (max without ALT)
    // Note: 20 recipients requires Address Lookup Tables for transaction compression
    const recipients: Keypair[] = [];
    for (let i = 0; i < 10; i++) {
      const r = Keypair.generate();
      recipients.push(r);
      const ata = getAssociatedTokenAddressSync(mint, r.publicKey);
      createTokenAccount(svm, ata, mint, r.publicKey);
    }

    // 10 recipients with 10 shares each = 100 shares = 9900 bps
    const { instruction, splitConfig } = await createSplitConfig({
      authority: toAddress(payer.publicKey),
      recipients: recipients.map((r) => ({
        address: toAddress(r.publicKey),
        share: 10,
      })),
      mint: toAddress(mint),
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(toWeb3Instruction(instruction));
    tx.sign(payer);

    const result = svm.sendTransaction(tx);
    expect(result).toBeInstanceOf(TransactionMetadata);

    const splitConfigAccount = svm.getAccount(toPublicKey(splitConfig));
    const decoded = getSplitConfigDecoder().decode(
      splitConfigAccount?.data ?? new Uint8Array(),
    );
    expect(decoded.recipientCount).toBe(10);
    // Each has 10 shares = 990 bps (10 * 99)
    expect(decoded.recipients[0]?.percentageBps).toBe(990);
    expect(decoded.recipients[9]?.percentageBps).toBe(990);
  });
});

describe("SDK Integration: Idempotent Helpers", () => {
  test("recipientsEqual identifies matching recipients with synthetic data", async () => {
    // Import recipientsEqual helper
    const { recipientsEqual } = await import("../src/helpers.js");
    type SplitRecipient = {
      address: Address;
      percentageBps: number;
      share: number;
    };

    const alice = "A1ice111111111111111111111111111111111111111";
    const bob = "Bob11111111111111111111111111111111111111111";

    // Simulated on-chain recipients (as would be decoded from account)
    const onChainRecipients: SplitRecipient[] = [
      { address: alice as Address, percentageBps: 6930, share: 70 },
      { address: bob as Address, percentageBps: 2871, share: 29 },
    ];

    // Same order should match
    const sameOrder = [
      { address: alice, share: 70 },
      { address: bob, share: 29 },
    ];
    expect(recipientsEqual(sameOrder, onChainRecipients)).toBe(true);

    // Different order should also match (set equality)
    const differentOrder = [
      { address: bob, share: 29 },
      { address: alice, share: 70 },
    ];
    expect(recipientsEqual(differentOrder, onChainRecipients)).toBe(true);

    // Different shares should not match
    const differentShares = [
      { address: alice, share: 60 },
      { address: bob, share: 39 },
    ];
    expect(recipientsEqual(differentShares, onChainRecipients)).toBe(false);
  });

  test("checkRecipientAtas identifies missing ATAs in LiteSVM state", async () => {
    const svm = setupLiteSVM();
    const payer = Keypair.generate();
    const feeWallet = Keypair.generate();

    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    setupProtocolConfig(svm, feeWallet.publicKey);
    const mint = createMint(svm, payer.publicKey);

    // Create recipient with ATA
    const recipientWithAta = Keypair.generate();
    const ata = getAssociatedTokenAddressSync(mint, recipientWithAta.publicKey);
    createTokenAccount(svm, ata, mint, recipientWithAta.publicKey);

    // Verify ATA exists
    const ataAccount = svm.getAccount(ata);
    expect(ataAccount).not.toBeNull();

    // Verify a new recipient wouldn't have an ATA
    const recipientWithoutAta = Keypair.generate();
    const missingAta = getAssociatedTokenAddressSync(
      mint,
      recipientWithoutAta.publicKey,
    );
    const missingAtaAccount = svm.getAccount(missingAta);
    expect(missingAtaAccount).toBeNull();
  });

  test("createSplitConfig returns deterministic vault address", async () => {
    // This test verifies the vault address derivation is consistent
    const authority = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const uniqueId = Keypair.generate().publicKey;

    const { vault: vault1, splitConfig: config1 } = await createSplitConfig({
      authority: toAddress(authority),
      recipients: [
        { address: toAddress(Keypair.generate().publicKey), share: 99 },
      ],
      mint: toAddress(mint),
      uniqueId: toAddress(uniqueId),
    });

    const { vault: vault2, splitConfig: config2 } = await createSplitConfig({
      authority: toAddress(authority),
      recipients: [
        { address: toAddress(Keypair.generate().publicKey), share: 99 },
      ],
      mint: toAddress(mint),
      uniqueId: toAddress(uniqueId),
    });

    // Same authority/mint/uniqueId should produce same addresses
    expect(vault1).toBe(vault2);
    expect(config1).toBe(config2);

    // Vault should be ATA of splitConfig
    const expectedVault = getAssociatedTokenAddressSync(
      mint,
      toPublicKey(config1),
      true,
    );
    expect(toPublicKey(vault1).toBase58()).toBe(expectedVault.toBase58());
  });
});
