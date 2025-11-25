/**
 * Read functions for @solana/web3.js
 * Fetches and deserializes on-chain accounts
 */

import { type Connection, PublicKey } from "@solana/web3.js";
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
	connection: Connection,
	vault: PublicKey,
): Promise<SplitConfig> {
	// First, fetch the vault (ATA) to get its owner (splitConfig PDA)
	const vaultInfo = await connection.getAccountInfo(vault);

	if (!vaultInfo) {
		throw new VaultNotFoundError(vault.toBase58());
	}

	// Parse owner from token account (offset 32)
	if (vaultInfo.data.length < 165) {
		throw new InvalidTokenAccountError(vault.toBase58());
	}
	const splitConfigPubkey = new PublicKey(vaultInfo.data.subarray(32, 64));

	// Now fetch the actual splitConfig account
	const splitConfigInfo = await connection.getAccountInfo(splitConfigPubkey);

	if (!splitConfigInfo) {
		throw new SplitNotFoundError(splitConfigPubkey.toBase58());
	}

	const raw = deserializeSplitConfig(splitConfigInfo.data);

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
	connection: Connection,
	vault: PublicKey,
): Promise<bigint> {
	const accountInfo = await connection.getAccountInfo(vault);

	if (!accountInfo) {
		return 0n;
	}

	if (accountInfo.data.length < 72) {
		throw new InvalidTokenAccountError(vault.toBase58());
	}

	return accountInfo.data.readBigUInt64LE(64);
}

/**
 * Fetch and deserialize protocol configuration
 */
export async function getProtocolConfig(
	connection: Connection,
): Promise<ProtocolConfig> {
	const { address: protocolConfigAddress } = deriveProtocolConfig();
	const accountInfo = await connection.getAccountInfo(
		new PublicKey(protocolConfigAddress),
	);

	if (!accountInfo) {
		throw new ProtocolNotInitializedError();
	}

	return deserializeProtocolConfig(accountInfo.data);
}

/**
 * Preview distribution amounts for current vault balance
 */
export async function previewExecution(
	connection: Connection,
	vault: PublicKey,
): Promise<DistributionPreview> {
	const split = await getSplit(connection, vault);
	const balance = await getVaultBalance(connection, vault);

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
