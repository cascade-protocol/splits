import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, clusterApiUrl } from '@solana/web3.js';
import { readFileSync } from 'fs';
import * as web3 from '../sdk/src/web3';
import { deriveProtocolConfig } from '../sdk/src/index';

// Usage: tsx update-fee-wallet.ts <cluster> <wallet> <new-fee-wallet>
const [cluster, walletPath, newFeeWalletArg] = process.argv.slice(2);

if (!cluster || !walletPath || !newFeeWalletArg) {
  console.error('Usage: tsx update-fee-wallet.ts <cluster> <wallet> <new-fee-wallet>');
  console.error('  cluster: devnet | mainnet | localnet');
  console.error('  wallet: path to authority keypair JSON');
  console.error('  new-fee-wallet: public key of new fee wallet');
  process.exit(1);
}

const rpcUrl = cluster === 'mainnet' ? clusterApiUrl('mainnet-beta')
  : cluster === 'localnet' ? 'http://127.0.0.1:8899'
  : clusterApiUrl('devnet');

async function main() {
  const resolvedPath = walletPath.replace('~', process.env.HOME || '');
  const authorityKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(resolvedPath, 'utf-8')))
  );

  const newFeeWallet = new PublicKey(newFeeWalletArg);

  console.log('Cluster:', cluster);
  console.log('Authority:', authorityKeypair.publicKey.toBase58());
  console.log('New Fee Wallet:', newFeeWallet.toBase58());

  const connection = new Connection(rpcUrl, 'confirmed');

  // Check if protocol is initialized
  const { address: protocolConfigAddress } = deriveProtocolConfig();
  const protocolConfigInfo = await connection.getAccountInfo(new PublicKey(protocolConfigAddress));

  if (!protocolConfigInfo) {
    console.error('\n❌ Protocol not initialized');
    console.error('Run initialize-protocol.ts first');
    process.exit(1);
  }

  // Build instruction
  const instruction = web3.buildUpdateProtocolConfigInstruction(
    authorityKeypair.publicKey,
    newFeeWallet
  );

  // Create and send transaction
  const transaction = new Transaction().add(instruction);

  console.log('\nSending transaction...');
  const signature = await sendAndConfirmTransaction(connection, transaction, [authorityKeypair]);

  console.log('\n✅ Fee wallet updated!');
  console.log('Signature:', signature);
  console.log('Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=${cluster === 'mainnet' ? 'mainnet-beta' : cluster}`);
}

main().catch(console.error);
