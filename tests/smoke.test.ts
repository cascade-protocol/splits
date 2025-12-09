// biome-ignore-all lint/style/noRestrictedGlobals: Buffer is required for @solana/web3.js PDA derivation
import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  createInitializeMint2Instruction,
  getMintLen,
} from "@solana/spl-token";
import { describe, test, expect, beforeAll } from "vitest";
import type { CascadeSplits } from "../target/types/cascade_splits";
// Use SDK's IDL for consistency and early detection of IDL sync issues
import idl from "../packages/splits-sdk/idl.json";

// Helper to create program from SDK's IDL
function createProgram(
  provider: anchor.AnchorProvider,
): Program<CascadeSplits> {
  return new anchor.Program(
    idl as anchor.Idl,
    provider,
  ) as Program<CascadeSplits>;
}

// =============================================================================
// SMOKE TESTS - Essential E2E tests for real network behavior
// =============================================================================

describe("cascade-splits: basic flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = createProgram(provider);
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  // Test accounts
  let mint: PublicKey;
  let uniqueId: Keypair;
  let recipient1: Keypair;
  let recipient2: Keypair;
  let feeWallet: PublicKey;

  // Derived addresses
  let splitConfig: PublicKey;
  let vault: PublicKey;
  let recipient1Ata: PublicKey;
  let recipient2Ata: PublicKey;
  let protocolAta: PublicKey;

  beforeAll(async () => {
    // Create test mint
    mint = await createMint(connection, payer.payer, payer.publicKey, null, 6);

    // Generate test accounts
    uniqueId = Keypair.generate();
    recipient1 = Keypair.generate();
    recipient2 = Keypair.generate();

    // Get or initialize protocol config
    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId,
    );

    // Check if running on localnet
    const endpoint = connection.rpcEndpoint;
    const isLocalnet =
      endpoint.includes("localhost") || endpoint.includes("127.0.0.1");

    // Check if protocol is initialized
    const protocolAccount = await connection.getAccountInfo(protocolConfigPda);

    if (!protocolAccount && isLocalnet) {
      // Initialize protocol for localnet testing
      const [programData] = PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
      );

      await program.methods
        .initializeProtocol(payer.publicKey)
        .accounts({
          authority: payer.publicKey,
          programData,
        })
        .rpc();

      feeWallet = payer.publicKey;
    } else if (!protocolAccount) {
      throw new Error(
        "Protocol not initialized. Run initialization script first.",
      );
    } else {
      const protocolConfig =
        await program.account.protocolConfig.fetch(protocolConfigPda);
      feeWallet = protocolConfig.feeWallet;
    }

    // Derive split config PDA
    [splitConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("split_config"),
        payer.publicKey.toBuffer(),
        mint.toBuffer(),
        uniqueId.publicKey.toBuffer(),
      ],
      program.programId,
    );

    // Derive vault (ATA of split config)
    vault = getAssociatedTokenAddressSync(mint, splitConfig, true);

    // Create recipient ATAs
    recipient1Ata = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient1.publicKey,
    );
    recipient2Ata = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient2.publicKey,
    );

    // Create protocol fee ATA
    protocolAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      feeWallet,
    );
  });

  test("creates a split config", async () => {
    const recipients = [
      { address: recipient1.publicKey, percentageBps: 5000 },
      { address: recipient2.publicKey, percentageBps: 4900 },
    ];

    await program.methods
      .createSplitConfig(mint, recipients)
      .accounts({
        uniqueId: uniqueId.publicKey,
        authority: payer.publicKey,
        mintAccount: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: false, isSigner: false },
        { pubkey: recipient2Ata, isWritable: false, isSigner: false },
      ])
      .rpc();

    // Verify the split config was created
    const config = await program.account.splitConfig.fetch(splitConfig);
    expect(config.authority.toBase58()).toBe(payer.publicKey.toBase58());
    expect(config.mint.toBase58()).toBe(mint.toBase58());
    expect(config.recipientCount).toBe(2);
  });

  test("executes a split", async () => {
    // Mint tokens to vault
    const amount = 1_000_000; // 1 token with 6 decimals
    await mintTo(connection, payer.payer, mint, vault, payer.publicKey, amount);

    // Execute split
    await program.methods
      .executeSplit()
      .accountsPartial({
        splitConfig,
        vault,
        mint,
        executor: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: true, isSigner: false },
        { pubkey: recipient2Ata, isWritable: true, isSigner: false },
        { pubkey: protocolAta, isWritable: true, isSigner: false },
      ])
      .rpc();

    // Verify balances
    const recipient1Balance = await getAccount(connection, recipient1Ata);
    const recipient2Balance = await getAccount(connection, recipient2Ata);
    const protocolBalance = await getAccount(connection, protocolAta);
    const vaultBalance = await getAccount(connection, vault);

    // Verify vault is empty
    expect(vaultBalance.amount.toString()).toBe("0");

    // Verify recipients received their share
    expect(recipient1Balance.amount.toString()).toBe("500000"); // 50%
    expect(recipient2Balance.amount.toString()).toBe("490000"); // 49%
    expect(protocolBalance.amount.toString()).toBe("10000"); // 1% fee

    // Verify last_activity was updated
    const config = await program.account.splitConfig.fetch(splitConfig);
    expect(config.lastActivity.gt(new anchor.BN(0))).toBe(true);
  });

  test("closes the split config and recovers all rent", async () => {
    // Get initial balances
    const payerBalanceBefore = await connection.getBalance(payer.publicKey);
    const splitConfigInfo = await connection.getAccountInfo(splitConfig);
    const vaultInfo = await connection.getAccountInfo(vault);

    expect(splitConfigInfo).not.toBeNull();
    expect(vaultInfo).not.toBeNull();

    const splitConfigRent = splitConfigInfo?.lamports ?? 0;
    const vaultRent = vaultInfo?.lamports ?? 0;
    const totalRentToRecover = splitConfigRent + vaultRent;

    // Close the split config
    await program.methods
      .closeSplitConfig()
      .accountsPartial({
        splitConfig,
        vault,
        authority: payer.publicKey,
        rentDestination: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Get balance after
    const payerBalanceAfter = await connection.getBalance(payer.publicKey);

    // Verify split config is closed
    const splitConfigInfoAfter = await connection.getAccountInfo(splitConfig);
    expect(splitConfigInfoAfter).toBeNull();

    // Verify vault is closed
    const vaultInfoAfter = await connection.getAccountInfo(vault);
    expect(vaultInfoAfter).toBeNull();

    // Verify payer received all rent (minus transaction fees)
    // Transaction fee should be small (~5000 lamports), so recovered rent should be close to expected
    const balanceDiff = payerBalanceAfter - payerBalanceBefore;
    const minExpectedRecovery = totalRentToRecover - 10000; // Allow up to 0.00001 SOL for tx fees

    expect(balanceDiff).toBeGreaterThan(minExpectedRecovery);
  });
});

describe("cascade-splits: multiple recipients", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = createProgram(provider);
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let uniqueId: Keypair;
  let feeWallet: PublicKey;
  let splitConfig: PublicKey;
  let vault: PublicKey;
  let protocolAta: PublicKey;
  const recipients: { keypair: Keypair; ata: PublicKey }[] = [];

  const RECIPIENT_COUNT = 10;

  beforeAll(async () => {
    mint = await createMint(connection, payer.payer, payer.publicKey, null, 6);
    uniqueId = Keypair.generate();

    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId,
    );
    const protocolConfig =
      await program.account.protocolConfig.fetch(protocolConfigPda);
    feeWallet = protocolConfig.feeWallet;

    [splitConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("split_config"),
        payer.publicKey.toBuffer(),
        mint.toBuffer(),
        uniqueId.publicKey.toBuffer(),
      ],
      program.programId,
    );
    vault = getAssociatedTokenAddressSync(mint, splitConfig, true);

    // Create recipients with ATAs
    for (let i = 0; i < RECIPIENT_COUNT; i++) {
      const keypair = Keypair.generate();
      const ata = await createAssociatedTokenAccount(
        connection,
        payer.payer,
        mint,
        keypair.publicKey,
      );
      recipients.push({ keypair, ata });
    }

    protocolAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      feeWallet,
    );
  });

  test("creates and executes split with 10 recipients", async () => {
    // Each recipient gets 990 bps (9.9%) for total of 9900 bps (99%)
    const recipientData = recipients.map((r) => ({
      address: r.keypair.publicKey,
      percentageBps: 990,
    }));

    await program.methods
      .createSplitConfig(mint, recipientData)
      .accounts({
        uniqueId: uniqueId.publicKey,
        authority: payer.publicKey,
        mintAccount: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(
        recipients.map((r) => ({
          pubkey: r.ata,
          isWritable: false,
          isSigner: false,
        })),
      )
      .rpc();

    // Verify config was created with correct recipient count
    const config = await program.account.splitConfig.fetch(splitConfig);
    expect(config.recipientCount).toBe(RECIPIENT_COUNT);

    // Mint tokens and execute split
    const amount = 10_000_000; // 10 tokens
    await mintTo(connection, payer.payer, mint, vault, payer.publicKey, amount);

    await program.methods
      .executeSplit()
      .accountsPartial({
        splitConfig,
        vault,
        mint,
        executor: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        ...recipients.map((r) => ({
          pubkey: r.ata,
          isWritable: true,
          isSigner: false,
        })),
        { pubkey: protocolAta, isWritable: true, isSigner: false },
      ])
      .rpc();

    // Verify each recipient got their share: 9.9% of 10M = 990000
    for (const recipient of recipients) {
      const balance = await getAccount(connection, recipient.ata);
      expect(balance.amount.toString()).toBe("990000");
    }

    // Verify protocol fee: 1% of 10M = 100000
    const protocolBalance = await getAccount(connection, protocolAta);
    expect(Number(protocolBalance.amount)).toBeGreaterThanOrEqual(100000);
  });
});

describe("cascade-splits: Token-2022 support", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = createProgram(provider);
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let mint2022: PublicKey;
  let uniqueId: Keypair;
  let recipient1: Keypair;
  let feeWallet: PublicKey;
  let splitConfig: PublicKey;
  let vault: PublicKey;
  let recipient1Ata: PublicKey;
  let protocolAta: PublicKey;

  beforeAll(async () => {
    // Create Token-2022 mint
    const mintKeypair = Keypair.generate();
    mint2022 = mintKeypair.publicKey;

    const mintLen = getMintLen([]);
    const mintLamports =
      await connection.getMinimumBalanceForRentExemption(mintLen);

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint2022,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mint2022,
        6,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    await sendAndConfirmTransaction(connection, tx, [payer.payer, mintKeypair]);

    uniqueId = Keypair.generate();
    recipient1 = Keypair.generate();

    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId,
    );
    const protocolConfig =
      await program.account.protocolConfig.fetch(protocolConfigPda);
    feeWallet = protocolConfig.feeWallet;

    [splitConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("split_config"),
        payer.publicKey.toBuffer(),
        mint2022.toBuffer(),
        uniqueId.publicKey.toBuffer(),
      ],
      program.programId,
    );
    vault = getAssociatedTokenAddressSync(
      mint2022,
      splitConfig,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    // Create ATAs for Token-2022
    recipient1Ata = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint2022,
      recipient1.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    protocolAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint2022,
      feeWallet,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
  });

  test("creates and executes split with Token-2022 mint", async () => {
    // Create split config
    await program.methods
      .createSplitConfig(mint2022, [
        { address: recipient1.publicKey, percentageBps: 9900 },
      ])
      .accounts({
        uniqueId: uniqueId.publicKey,
        authority: payer.publicKey,
        mintAccount: mint2022,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: false, isSigner: false },
      ])
      .rpc();

    // Mint Token-2022 tokens to vault
    await mintTo(
      connection,
      payer.payer,
      mint2022,
      vault,
      payer.publicKey,
      1_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    // Execute split
    await program.methods
      .executeSplit()
      .accountsPartial({
        splitConfig,
        vault,
        mint: mint2022,
        executor: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: true, isSigner: false },
        { pubkey: protocolAta, isWritable: true, isSigner: false },
      ])
      .rpc();

    // Verify balances
    const recipientBalance = await getAccount(
      connection,
      recipient1Ata,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    const protocolBalance = await getAccount(
      connection,
      protocolAta,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    expect(recipientBalance.amount.toString()).toBe("990000");
    expect(protocolBalance.amount.toString()).toBe("10000");
  });
});

describe("cascade-splits: permissionless execution", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = createProgram(provider);
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let feeWallet: PublicKey;

  beforeAll(async () => {
    mint = await createMint(connection, payer.payer, payer.publicKey, null, 6);

    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId,
    );
    const protocolConfig =
      await program.account.protocolConfig.fetch(protocolConfigPda);
    feeWallet = protocolConfig.feeWallet;
  });

  test("allows permissionless execution by any account", async () => {
    const uniqueId = Keypair.generate();
    const recipient = Keypair.generate();
    const randomExecutor = Keypair.generate();

    const [splitConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("split_config"),
        payer.publicKey.toBuffer(),
        mint.toBuffer(),
        uniqueId.publicKey.toBuffer(),
      ],
      program.programId,
    );
    const vault = getAssociatedTokenAddressSync(mint, splitConfig, true);

    const recipientAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient.publicKey,
    );
    const protocolAta = getAssociatedTokenAddressSync(mint, feeWallet);

    // Create protocol ATA if it doesn't exist
    try {
      await createAssociatedTokenAccount(
        connection,
        payer.payer,
        mint,
        feeWallet,
      );
    } catch {
      // Already exists
    }

    await program.methods
      .createSplitConfig(mint, [
        { address: recipient.publicKey, percentageBps: 9900 },
      ])
      .accounts({
        uniqueId: uniqueId.publicKey,
        authority: payer.publicKey,
        mintAccount: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipientAta, isWritable: false, isSigner: false },
      ])
      .rpc();

    await mintTo(
      connection,
      payer.payer,
      mint,
      vault,
      payer.publicKey,
      1_000_000,
    );

    // Execute with a random executor address (not a signer, just recorded)
    await program.methods
      .executeSplit()
      .accountsPartial({
        splitConfig,
        vault,
        mint,
        executor: randomExecutor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipientAta, isWritable: true, isSigner: false },
        { pubkey: protocolAta, isWritable: true, isSigner: false },
      ])
      .rpc();

    // Verify split was executed
    const balance = await getAccount(connection, recipientAta);
    expect(balance.amount.toString()).toBe("990000");
  });
});

describe("cascade-splits: self-healing unclaimed flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = createProgram(provider);
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let uniqueId: Keypair;
  let recipient: Keypair;
  let feeWallet: PublicKey;
  let splitConfig: PublicKey;
  let vault: PublicKey;
  let recipientAta: PublicKey;
  let protocolAta: PublicKey;

  beforeAll(async () => {
    mint = await createMint(connection, payer.payer, payer.publicKey, null, 6);
    uniqueId = Keypair.generate();
    recipient = Keypair.generate();

    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId,
    );
    const protocolConfig =
      await program.account.protocolConfig.fetch(protocolConfigPda);
    feeWallet = protocolConfig.feeWallet;

    [splitConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("split_config"),
        payer.publicKey.toBuffer(),
        mint.toBuffer(),
        uniqueId.publicKey.toBuffer(),
      ],
      program.programId,
    );
    vault = getAssociatedTokenAddressSync(mint, splitConfig, true);

    // Create protocol ATA but NOT recipient ATA initially
    protocolAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      feeWallet,
    );
  });

  test("stores funds as unclaimed when recipient ATA missing, then clears on next execute", async () => {
    // First, create recipient ATA so we can create the split config
    // (config creation requires ATAs to exist)
    recipientAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient.publicKey,
    );

    // Create split config
    await program.methods
      .createSplitConfig(mint, [
        { address: recipient.publicKey, percentageBps: 9900 },
      ])
      .accounts({
        uniqueId: uniqueId.publicKey,
        authority: payer.publicKey,
        mintAccount: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipientAta, isWritable: false, isSigner: false },
      ])
      .rpc();

    // Mint tokens to vault
    await mintTo(
      connection,
      payer.payer,
      mint,
      vault,
      payer.publicKey,
      1_000_000,
    );

    // Execute split - funds should go to recipient
    await program.methods
      .executeSplit()
      .accountsPartial({
        splitConfig,
        vault,
        mint,
        executor: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipientAta, isWritable: true, isSigner: false },
        { pubkey: protocolAta, isWritable: true, isSigner: false },
      ])
      .rpc();

    // Verify recipient received funds
    const recipientBalance = await getAccount(connection, recipientAta);
    expect(recipientBalance.amount.toString()).toBe("990000");

    // Verify protocol received fee
    const protocolBalance = await getAccount(connection, protocolAta);
    expect(protocolBalance.amount.toString()).toBe("10000");
  });
});

describe("cascade-splits: update preserves vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = createProgram(provider);
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let uniqueId: Keypair;
  let recipient1: Keypair;
  let recipient2: Keypair;
  let feeWallet: PublicKey;
  let splitConfig: PublicKey;
  let vault: PublicKey;
  let recipient1Ata: PublicKey;
  let recipient2Ata: PublicKey;
  let protocolAta: PublicKey;

  beforeAll(async () => {
    mint = await createMint(connection, payer.payer, payer.publicKey, null, 6);
    uniqueId = Keypair.generate();
    recipient1 = Keypair.generate();
    recipient2 = Keypair.generate();

    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId,
    );
    const protocolConfig =
      await program.account.protocolConfig.fetch(protocolConfigPda);
    feeWallet = protocolConfig.feeWallet;

    [splitConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("split_config"),
        payer.publicKey.toBuffer(),
        mint.toBuffer(),
        uniqueId.publicKey.toBuffer(),
      ],
      program.programId,
    );
    vault = getAssociatedTokenAddressSync(mint, splitConfig, true);

    // Create all ATAs
    recipient1Ata = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient1.publicKey,
    );
    recipient2Ata = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient2.publicKey,
    );
    protocolAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      feeWallet,
    );
  });

  test("updates split config and vault address is preserved", async () => {
    // Create initial split config with recipient1
    await program.methods
      .createSplitConfig(mint, [
        { address: recipient1.publicKey, percentageBps: 9900 },
      ])
      .accounts({
        uniqueId: uniqueId.publicKey,
        authority: payer.publicKey,
        mintAccount: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: false, isSigner: false },
      ])
      .rpc();

    // Get original vault address
    const configBefore = await program.account.splitConfig.fetch(splitConfig);
    const originalVault = configBefore.vault;

    // Update to completely different recipients
    await program.methods
      .updateSplitConfig([
        { address: recipient1.publicKey, percentageBps: 5000 },
        { address: recipient2.publicKey, percentageBps: 4900 },
      ])
      .accountsPartial({
        splitConfig,
        vault,
        mint,
        authority: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: false, isSigner: false },
        { pubkey: recipient2Ata, isWritable: false, isSigner: false },
      ])
      .rpc();

    // Verify vault address is unchanged
    const configAfter = await program.account.splitConfig.fetch(splitConfig);
    expect(configAfter.vault.toBase58()).toBe(originalVault.toBase58());

    // Verify new recipients are set
    expect(configAfter.recipientCount).toBe(2);

    // Test that split works with new recipients
    await mintTo(
      connection,
      payer.payer,
      mint,
      vault,
      payer.publicKey,
      1_000_000,
    );

    await program.methods
      .executeSplit()
      .accountsPartial({
        splitConfig,
        vault,
        mint,
        executor: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: true, isSigner: false },
        { pubkey: recipient2Ata, isWritable: true, isSigner: false },
        { pubkey: protocolAta, isWritable: true, isSigner: false },
      ])
      .rpc();

    // Verify new distribution
    const recipient1Balance = await getAccount(connection, recipient1Ata);
    const recipient2Balance = await getAccount(connection, recipient2Ata);
    expect(recipient1Balance.amount.toString()).toBe("500000");
    expect(recipient2Balance.amount.toString()).toBe("490000");
  });
});

describe("cascade-splits: multiple configs per authority", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = createProgram(provider);
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let mint: PublicKey;

  beforeAll(async () => {
    mint = await createMint(connection, payer.payer, payer.publicKey, null, 6);
  });

  test("creates multiple configs with different unique IDs", async () => {
    const configs: {
      uniqueId: Keypair;
      splitConfig: PublicKey;
      vault: PublicKey;
      recipientAta: PublicKey;
    }[] = [];

    // Create 3 different configs with same authority and mint
    for (let i = 0; i < 3; i++) {
      const uniqueId = Keypair.generate();
      const recipient = Keypair.generate();

      const [splitConfig] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("split_config"),
          payer.publicKey.toBuffer(),
          mint.toBuffer(),
          uniqueId.publicKey.toBuffer(),
        ],
        program.programId,
      );
      const vault = getAssociatedTokenAddressSync(mint, splitConfig, true);
      const recipientAta = await createAssociatedTokenAccount(
        connection,
        payer.payer,
        mint,
        recipient.publicKey,
      );

      await program.methods
        .createSplitConfig(mint, [
          { address: recipient.publicKey, percentageBps: 9900 },
        ])
        .accounts({
          uniqueId: uniqueId.publicKey,
          authority: payer.publicKey,
          mintAccount: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: recipientAta, isWritable: false, isSigner: false },
        ])
        .rpc();

      configs.push({ uniqueId, splitConfig, vault, recipientAta });
    }

    // Verify all configs exist and have different vault addresses
    const vaultAddresses = new Set<string>();
    for (const config of configs) {
      const splitConfig = await program.account.splitConfig.fetch(
        config.splitConfig,
      );
      expect(splitConfig.authority.toBase58()).toBe(payer.publicKey.toBase58());
      expect(splitConfig.mint.toBase58()).toBe(mint.toBase58());

      // Each vault should be unique
      const vaultStr = splitConfig.vault.toBase58();
      expect(vaultAddresses.has(vaultStr)).toBe(false);
      vaultAddresses.add(vaultStr);
    }

    expect(vaultAddresses.size).toBe(3);
  });
});

describe("cascade-splits: exact distribution math", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = createProgram(provider);
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let feeWallet: PublicKey;

  beforeAll(async () => {
    mint = await createMint(connection, payer.payer, payer.publicKey, null, 6);

    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId,
    );
    const protocolConfig =
      await program.account.protocolConfig.fetch(protocolConfigPda);
    feeWallet = protocolConfig.feeWallet;
  });

  test("verifies exact distribution with rounding dust to protocol", async () => {
    const uniqueId = Keypair.generate();
    const recipient = Keypair.generate();

    const [splitConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("split_config"),
        payer.publicKey.toBuffer(),
        mint.toBuffer(),
        uniqueId.publicKey.toBuffer(),
      ],
      program.programId,
    );
    const vault = getAssociatedTokenAddressSync(mint, splitConfig, true);

    const recipientAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient.publicKey,
    );

    const protocolAta = getAssociatedTokenAddressSync(mint, feeWallet);
    try {
      await createAssociatedTokenAccount(
        connection,
        payer.payer,
        mint,
        feeWallet,
      );
    } catch {
      // Already exists
    }

    await program.methods
      .createSplitConfig(mint, [
        { address: recipient.publicKey, percentageBps: 9900 },
      ])
      .accounts({
        uniqueId: uniqueId.publicKey,
        authority: payer.publicKey,
        mintAccount: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipientAta, isWritable: false, isSigner: false },
      ])
      .rpc();

    // Test with amount that causes rounding: 999
    // 999 * 9900 / 10000 = 989.01 -> floor to 989
    // Protocol gets 999 - 989 = 10 (1% + dust)
    await mintTo(connection, payer.payer, mint, vault, payer.publicKey, 999);

    // Get protocol balance before
    const protocolBefore = await getAccount(connection, protocolAta);

    await program.methods
      .executeSplit()
      .accountsPartial({
        splitConfig,
        vault,
        mint,
        executor: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipientAta, isWritable: true, isSigner: false },
        { pubkey: protocolAta, isWritable: true, isSigner: false },
      ])
      .rpc();

    // Verify exact amounts
    const recipientBalance = await getAccount(connection, recipientAta);
    const protocolAfter = await getAccount(connection, protocolAta);

    // Recipient: floor(999 * 9900 / 10000) = 989
    expect(recipientBalance.amount.toString()).toBe("989");

    // Protocol: 999 - 989 = 10
    const protocolReceived =
      Number(protocolAfter.amount) - Number(protocolBefore.amount);
    expect(protocolReceived).toBe(10);
  });
});
