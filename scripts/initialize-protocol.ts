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

const FEE_WALLET = new PublicKey(
	"2zMEvEkyQKTRjiGkwYPXjPsJUp8eR1rVjoYQ7PzVVZnP",
);

// Usage: tsx initialize-protocol.ts <cluster> <wallet>
const [cluster, walletPath] = process.argv.slice(2);

if (!cluster || !walletPath) {
	console.error("Usage: tsx initialize-protocol.ts <cluster> <wallet>");
	console.error("  cluster: devnet | mainnet | localnet");
	console.error("  wallet: path to keypair JSON");
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
	const deployerKeypair = Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(readFileSync(resolvedPath, "utf-8"))),
	);

	console.log("Cluster:", cluster);
	console.log("Deployer:", deployerKeypair.publicKey.toBase58());
	console.log("Fee Wallet:", FEE_WALLET.toBase58());

	const connection = new Connection(rpcUrl, "confirmed");

	// Check if protocol is already initialized
	const { address: protocolConfigAddress } = deriveProtocolConfig();
	const protocolConfig = await connection.getAccountInfo(
		new PublicKey(protocolConfigAddress),
	);

	if (protocolConfig) {
		console.log("\n⚠️  Protocol already initialized");
		console.log("Protocol Config:", protocolConfigAddress);
		return;
	}

	// Build instruction
	const instruction = web3.buildInitializeProtocolInstruction(
		deployerKeypair.publicKey,
		FEE_WALLET,
	);

	// Create and send transaction
	const transaction = new Transaction().add(instruction);

	console.log("\nSending transaction...");
	const signature = await sendAndConfirmTransaction(connection, transaction, [
		deployerKeypair,
	]);

	console.log("\n✅ Protocol initialized!");
	console.log("Signature:", signature);
	console.log(
		"Explorer:",
		`https://explorer.solana.com/tx/${signature}?cluster=devnet`,
	);
}

main().catch(console.error);
