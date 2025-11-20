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

// Usage: tsx transfer-protocol-authority.ts <cluster> <wallet> <new-authority>
const [cluster, walletPath, newAuthorityArg] = process.argv.slice(2);

if (!cluster || !walletPath || !newAuthorityArg) {
	console.error(
		"Usage: tsx transfer-protocol-authority.ts <cluster> <wallet> <new-authority>",
	);
	console.error("  cluster: devnet | mainnet | localnet");
	console.error("  wallet: path to current authority keypair JSON");
	console.error("  new-authority: public key of new authority");
	console.error("");
	console.error("NOTE: This initiates a two-step transfer. The new authority");
	console.error(
		"must call accept-protocol-authority.ts to complete the transfer.",
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
	const authorityKeypair = Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(readFileSync(resolvedPath, "utf-8"))),
	);

	const newAuthority = new PublicKey(newAuthorityArg);

	console.log("Cluster:", cluster);
	console.log("Current Authority:", authorityKeypair.publicKey.toBase58());
	console.log("New Authority:", newAuthority.toBase58());

	const connection = new Connection(rpcUrl, "confirmed");

	// Check if protocol is initialized
	const { address: protocolConfigAddress } = deriveProtocolConfig();
	const protocolConfigInfo = await connection.getAccountInfo(
		new PublicKey(protocolConfigAddress),
	);

	if (!protocolConfigInfo) {
		console.error("\n❌ Protocol not initialized");
		console.error("Run initialize-protocol.ts first");
		process.exit(1);
	}

	// Build instruction
	const instruction = web3.buildTransferProtocolAuthorityInstruction(
		authorityKeypair.publicKey,
		newAuthority,
	);

	// Create and send transaction
	const transaction = new Transaction().add(instruction);

	console.log("\nSending transaction...");
	const signature = await sendAndConfirmTransaction(connection, transaction, [
		authorityKeypair,
	]);

	console.log("\n✅ Authority transfer initiated!");
	console.log("Pending Authority:", newAuthority.toBase58());
	console.log("");
	console.log("⚠️  Transfer is NOT complete. The new authority must run:");
	console.log(
		`   tsx scripts/accept-protocol-authority.ts ${cluster} <new-authority-wallet>`,
	);
	console.log("");
	console.log("Signature:", signature);
	console.log(
		"Explorer:",
		`https://explorer.solana.com/tx/${signature}?cluster=${cluster === "mainnet" ? "mainnet-beta" : cluster}`,
	);
}

main().catch(console.error);
