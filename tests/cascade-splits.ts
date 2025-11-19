import * as anchor from '@coral-xyz/anchor';
import type { Program } from '@coral-xyz/anchor';
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { assert } from 'chai';
import type { CascadeSplits } from '../target/types/cascade_splits';

describe('cascade-splits', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CascadeSplits as Program<CascadeSplits>;
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

  before(async () => {
    // Create test mint
    mint = await createMint(
      connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    console.log('Test mint:', mint.toBase58());

    // Generate test accounts
    uniqueId = Keypair.generate();
    recipient1 = Keypair.generate();
    recipient2 = Keypair.generate();

    // Get or initialize protocol config
    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('protocol_config')],
      program.programId
    );

    // Check if running on localnet
    const endpoint = connection.rpcEndpoint;
    const isLocalnet = endpoint.includes('localhost') || endpoint.includes('127.0.0.1');

    // Check if protocol is initialized
    const protocolAccount = await connection.getAccountInfo(protocolConfigPda);

    if (!protocolAccount && isLocalnet) {
      // Initialize protocol for localnet testing
      const [programData] = PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
      );

      await program.methods
        .initializeProtocol(payer.publicKey)
        .accounts({
          protocolConfig: protocolConfigPda,
          authority: payer.publicKey,
          programData,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      feeWallet = payer.publicKey;
    } else if (!protocolAccount) {
      throw new Error('Protocol not initialized. Run initialization script first.');
    } else {
      const protocolConfig = await program.account.protocolConfig.fetch(protocolConfigPda);
      feeWallet = protocolConfig.feeWallet;
      console.log('Fee wallet:', feeWallet.toBase58());
    }

    // Derive split config PDA
    [splitConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('split_config'),
        payer.publicKey.toBuffer(),
        mint.toBuffer(),
        uniqueId.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Derive vault (ATA of split config)
    vault = getAssociatedTokenAddressSync(mint, splitConfig, true);

    // Create recipient ATAs
    recipient1Ata = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient1.publicKey
    );
    recipient2Ata = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      recipient2.publicKey
    );

    // Create protocol fee ATA
    protocolAta = await createAssociatedTokenAccount(
      connection,
      payer.payer,
      mint,
      feeWallet
    );

    console.log('Split config:', splitConfig.toBase58());
    console.log('Vault:', vault.toBase58());
    console.log('Recipient 1 ATA:', recipient1Ata.toBase58());
    console.log('Recipient 2 ATA:', recipient2Ata.toBase58());
    console.log('Protocol ATA:', protocolAta.toBase58());
  });

  it('creates a split config', async () => {
    const recipients = [
      { address: recipient1.publicKey, percentageBps: 5000 },
      { address: recipient2.publicKey, percentageBps: 4900 },
    ];

    const tx = await program.methods
      .createSplitConfig(mint, recipients)
      .accounts({
        splitConfig,
        uniqueId: uniqueId.publicKey,
        authority: payer.publicKey,
        mintAccount: mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: false, isSigner: false },
        { pubkey: recipient2Ata, isWritable: false, isSigner: false },
      ])
      .rpc();

    console.log('Create split config tx:', tx);

    // Verify the split config was created
    const config = await program.account.splitConfig.fetch(splitConfig);
    assert.equal(config.authority.toBase58(), payer.publicKey.toBase58());
    assert.equal(config.mint.toBase58(), mint.toBase58());
    assert.equal(config.recipientCount, 2);
  });

  it('executes a split', async () => {
    // Mint tokens to vault
    const amount = 1_000_000; // 1 token with 6 decimals
    await mintTo(
      connection,
      payer.payer,
      mint,
      vault,
      payer.publicKey,
      amount
    );

    console.log('Minted', amount, 'tokens to vault');

    // Get protocol config PDA
    const [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('protocol_config')],
      program.programId
    );

    // Execute split
    const tx = await program.methods
      .executeSplit()
      .accounts({
        splitConfig,
        vault,
        mint,
        protocolConfig: protocolConfigPda,
        executor: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient1Ata, isWritable: true, isSigner: false },
        { pubkey: recipient2Ata, isWritable: true, isSigner: false },
        { pubkey: protocolAta, isWritable: true, isSigner: false },
      ])
      .rpc();

    console.log('Execute split tx:', tx);

    // Verify balances
    const recipient1Balance = await getAccount(connection, recipient1Ata);
    const recipient2Balance = await getAccount(connection, recipient2Ata);
    const protocolBalance = await getAccount(connection, protocolAta);
    const vaultBalance = await getAccount(connection, vault);

    console.log('Recipient 1 balance:', recipient1Balance.amount.toString());
    console.log('Recipient 2 balance:', recipient2Balance.amount.toString());
    console.log('Protocol fee:', protocolBalance.amount.toString());
    console.log('Vault balance:', vaultBalance.amount.toString());

    // Verify vault is empty
    assert.equal(vaultBalance.amount.toString(), '0');

    // Verify recipients received their share
    // 50% of 1_000_000 = 500_000
    assert.equal(recipient1Balance.amount.toString(), '500000');
    // 49% of 1_000_000 = 490_000
    assert.equal(recipient2Balance.amount.toString(), '490000');
    // 1% protocol fee = 10_000
    assert.equal(protocolBalance.amount.toString(), '10000');
  });

  it('closes the split config', async () => {
    const tx = await program.methods
      .closeSplitConfig()
      .accounts({
        splitConfig,
        vault,
        authority: payer.publicKey,
      })
      .rpc();

    console.log('Close split config tx:', tx);

    // Verify account is closed
    const accountInfo = await connection.getAccountInfo(splitConfig);
    assert.isNull(accountInfo);
  });
});
