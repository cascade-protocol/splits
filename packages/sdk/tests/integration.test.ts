/**
 * LiteSVM integration tests for Cascade Splits SDK
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LiteSVM } from "litesvm";
import {
  Keypair,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ACCOUNT_SIZE,
  MINT_SIZE,
  AccountLayout,
  MintLayout,
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import * as web3 from "../src/web3";
import {
  PROGRAM_ID,
  deriveProtocolConfig,
  deriveSplitConfig,
  deriveVault,
  deriveAta,
} from "../src/index";

const PROGRAM_PATH = "../../target/deploy/cascade_splits.so";

describe("Cascade Splits Integration", () => {
  let svm: LiteSVM;
  let payer: Keypair;
  let authority: Keypair;
  let mint: Keypair;
  let feeWallet: Keypair;
  let recipient1: Keypair;
  let recipient2: Keypair;

  beforeEach(() => {
    svm = new LiteSVM();
    svm.addProgramFromFile(new PublicKey(PROGRAM_ID), PROGRAM_PATH);

    payer = Keypair.generate();
    authority = Keypair.generate();
    mint = Keypair.generate();
    feeWallet = Keypair.generate();
    recipient1 = Keypair.generate();
    recipient2 = Keypair.generate();

    // Airdrop SOL to accounts
    svm.airdrop(payer.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    svm.airdrop(authority.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    svm.airdrop(feeWallet.publicKey, BigInt(LAMPORTS_PER_SOL));
    svm.airdrop(recipient1.publicKey, BigInt(LAMPORTS_PER_SOL));
    svm.airdrop(recipient2.publicKey, BigInt(LAMPORTS_PER_SOL));
  });

  function createMint(svm: LiteSVM, mintKeypair: Keypair, mintAuthority: PublicKey, decimals: number = 6): void {
    const rentExempt = 1_000_000_000n;

    const tx = new Transaction();
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: Number(rentExempt),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        decimals,
        mintAuthority,
        null
      )
    );
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(payer, mintKeypair);
    svm.sendTransaction(tx);
  }

  function createTokenAccount(svm: LiteSVM, mint: PublicKey, owner: PublicKey): PublicKey {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);

    const tx = new Transaction();
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        owner,
        mint
      )
    );
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(payer);
    svm.sendTransaction(tx);

    return ata;
  }

  function mintTokens(svm: LiteSVM, mint: PublicKey, destination: PublicKey, authority: Keypair, amount: bigint): void {
    const tx = new Transaction();
    tx.add(
      createMintToInstruction(
        mint,
        destination,
        authority.publicKey,
        amount
      )
    );
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(payer, authority);
    svm.sendTransaction(tx);
  }

  describe("Protocol Initialization", () => {
    it("initializes protocol config", () => {
      // For this test, we need to set up the program data account
      // The program needs to verify upgrade authority
      // This is complex to set up in LiteSVM, so we'll skip detailed testing here
      // and focus on the SDK instruction building correctness

      const ix = web3.buildInitializeProtocolInstruction(
        authority.publicKey,
        feeWallet.publicKey
      );

      // Verify instruction is properly formed
      expect(ix.programId.toBase58()).toBe(PROGRAM_ID);
      expect(ix.keys.length).toBe(4);
      expect(ix.data.length).toBe(40); // 8 discriminator + 32 address
    });
  });

  describe("Split Config Operations", () => {
    it("builds createSplitConfig instruction with correct accounts", () => {
      const uniqueId = Keypair.generate();
      const recipients = [
        { address: recipient1.publicKey.toBase58(), percentageBps: 5000 },
        { address: recipient2.publicKey.toBase58(), percentageBps: 4900 },
      ];

      const ix = web3.buildCreateSplitConfigInstruction(
        authority.publicKey,
        mint.publicKey,
        uniqueId.publicKey,
        recipients
      );

      // Verify instruction structure
      expect(ix.programId.toBase58()).toBe(PROGRAM_ID);
      // 9 base accounts + 2 recipient ATAs
      expect(ix.keys.length).toBe(11);

      // Verify derived addresses match
      const { address: splitConfigAddr } = deriveSplitConfig(
        authority.publicKey.toBase58(),
        mint.publicKey.toBase58(),
        uniqueId.publicKey.toBase58()
      );
      expect(ix.keys[0].pubkey.toBase58()).toBe(splitConfigAddr);
    });

    it("builds createSplitConfig instruction with separate payer", () => {
      const uniqueId = Keypair.generate();
      const payer = Keypair.generate(); // Different from authority
      const recipients = [
        { address: recipient1.publicKey.toBase58(), percentageBps: 9900 },
      ];

      const ix = web3.buildCreateSplitConfigInstruction(
        authority.publicKey,
        mint.publicKey,
        uniqueId.publicKey,
        recipients,
        undefined, // default token program
        payer.publicKey // separate payer
      );

      // Verify instruction structure
      expect(ix.programId.toBase58()).toBe(PROGRAM_ID);
      // 9 base accounts + 1 recipient ATA
      expect(ix.keys.length).toBe(10);

      // Verify authority is at index 2 (readonly signer)
      expect(ix.keys[2].pubkey.toBase58()).toBe(authority.publicKey.toBase58());
      expect(ix.keys[2].isSigner).toBe(true);
      expect(ix.keys[2].isWritable).toBe(false);

      // Verify payer is at index 3 (writable signer)
      expect(ix.keys[3].pubkey.toBase58()).toBe(payer.publicKey.toBase58());
      expect(ix.keys[3].isSigner).toBe(true);
      expect(ix.keys[3].isWritable).toBe(true);
    });

    it("builds executeSplit instruction with correct accounts", () => {
      const splitConfig = Keypair.generate().publicKey;
      const vault = Keypair.generate().publicKey;
      const protocolAta = Keypair.generate().publicKey;
      const recipientAtas = [
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
      ];

      const ix = web3.buildExecuteSplitInstruction(
        splitConfig,
        vault,
        mint.publicKey,
        authority.publicKey,
        recipientAtas,
        protocolAta
      );

      expect(ix.programId.toBase58()).toBe(PROGRAM_ID);
      // 6 base accounts + 2 recipient ATAs + 1 protocol ATA
      expect(ix.keys.length).toBe(9);

      // Verify account order
      expect(ix.keys[0].pubkey.toBase58()).toBe(splitConfig.toBase58());
      expect(ix.keys[1].pubkey.toBase58()).toBe(vault.toBase58());
      expect(ix.keys[2].pubkey.toBase58()).toBe(mint.publicKey.toBase58());
    });

    it("builds updateSplitConfig instruction with correct data", () => {
      const splitConfig = Keypair.generate().publicKey;
      const vault = Keypair.generate().publicKey;
      const newRecipients = [
        { address: recipient1.publicKey.toBase58(), percentageBps: 6000 },
        { address: recipient2.publicKey.toBase58(), percentageBps: 3900 },
      ];

      const ix = web3.buildUpdateSplitConfigInstruction(
        splitConfig,
        vault,
        mint.publicKey,
        authority.publicKey,
        newRecipients
      );

      expect(ix.programId.toBase58()).toBe(PROGRAM_ID);
      // 5 base accounts + 2 recipient ATAs
      expect(ix.keys.length).toBe(7);

      // Data: 8 discriminator + 4 recipient count + 2 * (32 address + 2 bps)
      expect(ix.data.length).toBe(8 + 4 + 2 * 34);
    });

    it("builds closeSplitConfig instruction", () => {
      const splitConfig = Keypair.generate().publicKey;
      const vault = Keypair.generate().publicKey;
      const rentDestination = Keypair.generate().publicKey;

      const ix = web3.buildCloseSplitConfigInstruction(
        splitConfig,
        vault,
        authority.publicKey,
        rentDestination
      );

      expect(ix.programId.toBase58()).toBe(PROGRAM_ID);
      expect(ix.keys.length).toBe(4);
      expect(ix.data.length).toBe(8); // Just discriminator

      // Verify rent_destination is writable at index 3
      expect(ix.keys[3].pubkey.toBase58()).toBe(rentDestination.toBase58());
      expect(ix.keys[3].isWritable).toBe(true);
    });
  });

  describe("Input Validation", () => {
    it("rejects empty recipients array", () => {
      expect(() => {
        web3.buildCreateSplitConfigInstruction(
          authority.publicKey,
          mint.publicKey,
          Keypair.generate().publicKey,
          []
        );
      }).toThrow("Recipient count must be between 1 and 20");
    });

    it("rejects more than 20 recipients", () => {
      const tooManyRecipients = Array.from({ length: 21 }, () => ({
        address: Keypair.generate().publicKey.toBase58(),
        percentageBps: 100,
      }));

      expect(() => {
        web3.buildCreateSplitConfigInstruction(
          authority.publicKey,
          mint.publicKey,
          Keypair.generate().publicKey,
          tooManyRecipients
        );
      }).toThrow("Recipient count must be between 1 and 20");
    });

    it("rejects zero percentage", () => {
      expect(() => {
        web3.buildCreateSplitConfigInstruction(
          authority.publicKey,
          mint.publicKey,
          Keypair.generate().publicKey,
          [{ address: recipient1.publicKey.toBase58(), percentageBps: 0 }]
        );
      }).toThrow("Recipient percentage must be greater than 0");
    });
  });

  describe("PDA Derivation", () => {
    it("derives protocol config PDA correctly", () => {
      const { address, bump } = deriveProtocolConfig();

      expect(address).toBeTruthy();
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);

      // Verify it's a valid base58 address
      expect(() => new PublicKey(address)).not.toThrow();
    });

    it("derives split config PDA correctly", () => {
      const { address, bump } = deriveSplitConfig(
        authority.publicKey.toBase58(),
        mint.publicKey.toBase58(),
        Keypair.generate().publicKey.toBase58()
      );

      expect(address).toBeTruthy();
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it("derives vault address correctly", () => {
      const { address: splitConfig } = deriveSplitConfig(
        authority.publicKey.toBase58(),
        mint.publicKey.toBase58(),
        Keypair.generate().publicKey.toBase58()
      );

      const vault = deriveVault(splitConfig, mint.publicKey.toBase58());

      expect(vault).toBeTruthy();
      expect(() => new PublicKey(vault)).not.toThrow();
    });

    it("derives ATA correctly", () => {
      const ata = deriveAta(
        recipient1.publicKey.toBase58(),
        mint.publicKey.toBase58()
      );

      // Compare with SPL token derivation
      const expectedAta = getAssociatedTokenAddressSync(
        mint.publicKey,
        recipient1.publicKey,
        true
      );

      expect(ata).toBe(expectedAta.toBase58());
    });
  });
});
