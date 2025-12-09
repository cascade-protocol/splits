import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import * as web3 from "../sdk/src/web3";
import { deriveProtocolConfig } from "../sdk/src/index";

// Usage: tsx accept-protocol-authority.ts <cluster> <wallet>
const [cluster, walletPath] = process.argv.slice(2);

if (!cluster || !walletPath) {
  console.error("Usage: tsx accept-protocol-authority.ts <cluster> <wallet>");
  console.error("  cluster: devnet | mainnet | localnet");
  console.error("  wallet: path to new authority keypair JSON");
  console.error("");
  console.error("NOTE: This completes a two-step transfer initiated by");
  console.error(
    "transfer-protocol-authority.ts. You must be the pending authority.",
  );
  process.exit(1);
}

const rpcUrl =
  cluster === "mainnet"
    ? clusterApiUrl("mainnet-beta")
    : cluster === "localnet"
      ? "http://127.0.0.1:8899"
      : clusterApiUrl("devnet");

async function main() {
  const resolvedPath = walletPath.replace("~", process.env.HOME || "");
  const newAuthorityKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(resolvedPath, "utf-8"))),
  );

  console.log("Cluster:", cluster);
  console.log("New Authority:", newAuthorityKeypair.publicKey.toBase58());

  const connection = new Connection(rpcUrl, "confirmed");

  // Check if protocol is initialized and has pending transfer
  const { address: protocolConfigAddress } = deriveProtocolConfig();
  const protocolConfigInfo = await connection.getAccountInfo(
    new PublicKey(protocolConfigAddress),
  );

  if (!protocolConfigInfo) {
    console.error("\n❌ Protocol not initialized");
    process.exit(1);
  }

  // Check pending authority matches
  const data = protocolConfigInfo.data;
  const pendingAuthority = new PublicKey(data.slice(40, 72));

  if (pendingAuthority.equals(PublicKey.default)) {
    console.error("\n❌ No pending authority transfer");
    console.error("Run transfer-protocol-authority.ts first");
    process.exit(1);
  }

  if (!pendingAuthority.equals(newAuthorityKeypair.publicKey)) {
    console.error("\n❌ Wallet does not match pending authority");
    console.error("Expected:", pendingAuthority.toBase58());
    console.error("Got:", newAuthorityKeypair.publicKey.toBase58());
    process.exit(1);
  }

  // Build instruction
  const instruction = web3.buildAcceptProtocolAuthorityInstruction(
    newAuthorityKeypair.publicKey,
  );

  // Create and send transaction
  const transaction = new Transaction().add(instruction);

  console.log("\nSending transaction...");
  const signature = await sendAndConfirmTransaction(connection, transaction, [
    newAuthorityKeypair,
  ]);

  console.log("\n✅ Authority transfer complete!");
  console.log("New Authority:", newAuthorityKeypair.publicKey.toBase58());
  console.log("");
  console.log("Signature:", signature);
  console.log(
    "Explorer:",
    `https://explorer.solana.com/tx/${signature}?cluster=${cluster === "mainnet" ? "mainnet-beta" : cluster}`,
  );
}

main().catch(console.error);
