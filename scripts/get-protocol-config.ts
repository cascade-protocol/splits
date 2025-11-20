import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { deriveProtocolConfig } from "../sdk/src/index";

// Usage: tsx get-protocol-config.ts <cluster>
const [cluster] = process.argv.slice(2);

if (!cluster) {
	console.error("Usage: tsx get-protocol-config.ts <cluster>");
	console.error("  cluster: devnet | mainnet | localnet");
	process.exit(1);
}

const rpcUrl =
	cluster === "mainnet"
		? clusterApiUrl("mainnet-beta")
		: cluster === "localnet"
			? "http://127.0.0.1:8899"
			: clusterApiUrl("devnet");

async function main() {
	const connection = new Connection(rpcUrl, "confirmed");

	const { address: protocolConfigAddress } = deriveProtocolConfig();
	const protocolConfigPubkey = new PublicKey(protocolConfigAddress);

	const accountInfo = await connection.getAccountInfo(protocolConfigPubkey);

	if (!accountInfo) {
		console.error("\n❌ Protocol not initialized");
		process.exit(1);
	}

	// Decode: 8 bytes discriminator + 32 bytes authority + 32 bytes pending_authority + 32 bytes feeWallet + 1 byte bump
	const data = accountInfo.data;
	const authority = new PublicKey(data.slice(8, 40));
	const pendingAuthority = new PublicKey(data.slice(40, 72));
	const feeWallet = new PublicKey(data.slice(72, 104));

	console.log("Cluster:", cluster);
	console.log("Protocol Config:", protocolConfigAddress);
	console.log("Authority:", authority.toBase58());
	console.log("Fee Wallet:", feeWallet.toBase58());

	// Show pending authority if there's an active transfer
	const isDefaultPubkey = pendingAuthority.equals(PublicKey.default);
	if (!isDefaultPubkey) {
		console.log("⚠️  Pending Authority:", pendingAuthority.toBase58());
	}
}

main().catch(console.error);
