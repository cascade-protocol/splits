/**
 * Read functions for @solana/kit v5
 * Fetches and deserializes on-chain accounts
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
	basisPointsToShares,
	previewDistribution as calculatePreview,
} from "../core/business-logic.js";
import type {
	SplitConfig,
	DistributionPreview,
	ProtocolConfig,
} from "../core/types.js";
import {
	deserializeSplitConfig,
	deserializeProtocolConfig,
} from "../core/deserialization.js";
import { deriveProtocolConfig } from "../pda.js";
import { encodeAddress } from "../core/encoding.js";

/**
 * Fetch and deserialize a split configuration account by vault address.
 * The vault is an ATA owned by the splitConfig PDA - we fetch the vault's owner
 * to get the splitConfig account.
 */
export async function getSplit(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
): Promise<SplitConfig> {
	// First, fetch the vault (ATA) to get its owner (splitConfig PDA)
	const vaultInfo = await rpc
		.getAccountInfo(vault, {
			encoding: "base64",
		})
		.send();

	if (!vaultInfo.value) {
		throw new Error(`Vault not found: ${vault}`);
	}

	const vaultData = Buffer.from(vaultInfo.value.data[0], "base64");

	// Parse owner from token account (offset 32)
	if (vaultData.length < 165) {
		throw new Error("Invalid token account");
	}
	const splitConfigAddress = encodeAddress(
		vaultData.subarray(32, 64),
	) as Address;

	// Now fetch the actual splitConfig account
	const splitConfigInfo = await rpc
		.getAccountInfo(splitConfigAddress, {
			encoding: "base64",
		})
		.send();

	if (!splitConfigInfo.value) {
		throw new Error(`Split config not found: ${splitConfigAddress}`);
	}

	const data = Buffer.from(splitConfigInfo.value.data[0], "base64");
	return deserializeSplitConfig(data);
}

/**
 * Get current vault token balance
 */
export async function getVaultBalance(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
): Promise<bigint> {
	const accountInfo = await rpc
		.getAccountInfo(vault, {
			encoding: "base64",
		})
		.send();

	if (!accountInfo.value) {
		return 0n;
	}

	const data = Buffer.from(accountInfo.value.data[0], "base64");
	if (data.length < 72) {
		throw new Error("Invalid token account");
	}

	return data.readBigUInt64LE(64);
}

/**
 * Fetch and deserialize protocol configuration
 */
export async function getProtocolConfig(
	rpc: Rpc<SolanaRpcApi>,
): Promise<ProtocolConfig> {
	const { address: protocolConfigAddress } = deriveProtocolConfig();
	const accountInfo = await rpc
		.getAccountInfo(protocolConfigAddress as Address, {
			encoding: "base64",
		})
		.send();

	if (!accountInfo.value) {
		throw new Error("Protocol config not found");
	}

	const data = Buffer.from(accountInfo.value.data[0], "base64");
	return deserializeProtocolConfig(data);
}

/**
 * Preview distribution amounts for current vault balance
 */
export async function previewExecution(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
): Promise<DistributionPreview> {
	const split = await getSplit(rpc, vault);
	const balance = await getVaultBalance(rpc, vault);

	// Convert back to shares for preview
	const recipients = split.recipients.map((r) => ({
		address: r.address,
		share: basisPointsToShares(r.percentageBps),
	}));

	const preview = calculatePreview(balance, recipients);

	return {
		vault: split.vault,
		currentBalance: balance,
		distributions: preview.distributions,
		protocolFee: preview.protocolFee,
		ready: balance > 0n,
	};
}

// Re-export deserialization for convenience
export {
	deserializeSplitConfig,
	deserializeProtocolConfig,
} from "../core/deserialization.js";
