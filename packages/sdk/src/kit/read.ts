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
import {
	VaultNotFoundError,
	SplitNotFoundError,
	ProtocolNotInitializedError,
	InvalidTokenAccountError,
} from "../errors.js";

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
		throw new VaultNotFoundError(vault);
	}

	const vaultData = Buffer.from(vaultInfo.value.data[0], "base64");

	// Parse owner from token account (offset 32)
	if (vaultData.length < 165) {
		throw new InvalidTokenAccountError(vault);
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
		throw new SplitNotFoundError(splitConfigAddress);
	}

	const data = Buffer.from(splitConfigInfo.value.data[0], "base64");
	const raw = deserializeSplitConfig(data);

	// Transform to user-facing format with shares (1-100)
	return {
		...raw,
		recipients: raw.recipients.map((r) => ({
			address: r.address,
			share: basisPointsToShares(r.percentageBps),
		})),
	};
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
		throw new InvalidTokenAccountError(vault);
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
		throw new ProtocolNotInitializedError();
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

	// getSplit() returns shares, use directly
	const preview = calculatePreview(balance, split.recipients);

	return {
		vault: split.vault,
		currentBalance: balance,
		distributions: preview.distributions,
		protocolFee: preview.protocolFee,
		ready: balance > 0n,
	};
}

// Re-export protocol config deserialization (split config uses getSplit() for abstraction)
export { deserializeProtocolConfig } from "../core/deserialization.js";
