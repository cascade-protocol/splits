/**
 * Helper utilities for Cascade Splits
 */

import {
	type Address,
	type Rpc,
	type SolanaRpcApi,
	getProgramDerivedAddress,
	getAddressEncoder,
	getAddressDecoder,
} from "@solana/kit";
import {
	PROGRAM_ID,
	PROTOCOL_CONFIG_SEED,
	SPLIT_CONFIG_SEED,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	bpsToShares,
} from "../index.js";
import {
	VaultNotFoundError,
	InvalidTokenAccountError,
	SplitConfigNotFoundError,
	ProtocolNotInitializedError,
} from "../errors.js";
import { fetchMaybeSplitConfig } from "./generated/accounts/splitConfig.js";
import { fetchProtocolConfig } from "./generated/accounts/protocolConfig.js";

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

// =============================================================================
// Types
// =============================================================================

/**
 * Recipient with both percentageBps (on-chain) and share (convenience)
 */
export interface SplitRecipient {
	address: Address;
	percentageBps: number;
	share: number;
}

/**
 * Unclaimed amount for a recipient
 */
export interface UnclaimedAmount {
	recipient: Address;
	amount: bigint;
	timestamp: bigint;
}

/**
 * Split configuration returned by getSplitConfigFromVault
 */
export interface SplitConfig {
	/** The splitConfig PDA address */
	address: Address;
	/** Schema version */
	version: number;
	/** Authority that can update/close */
	authority: Address;
	/** Token mint */
	mint: Address;
	/** Vault address (where payments are sent) */
	vault: Address;
	/** Unique identifier */
	uniqueId: Address;
	/** PDA bump */
	bump: number;
	/** Active recipients with both percentageBps and share */
	recipients: SplitRecipient[];
	/** Non-zero unclaimed amounts */
	unclaimedAmounts: UnclaimedAmount[];
	/** Protocol fees awaiting claim */
	protocolUnclaimed: bigint;
	/** Last execution timestamp */
	lastActivity: bigint;
	/** Account that paid rent */
	rentPayer: Address;
}

/**
 * Protocol configuration
 */
export interface ProtocolConfig {
	address: Address;
	authority: Address;
	pendingAuthority: Address;
	feeWallet: Address;
	bump: number;
}

// =============================================================================
// Address Encoding
// =============================================================================

/**
 * Decode raw bytes to Address
 */
export function decodeAddress(bytes: Uint8Array): Address {
	return addressDecoder.decode(bytes);
}

// =============================================================================
// PDA Derivation
// =============================================================================

/**
 * Derive the protocol config PDA
 */
export async function deriveProtocolConfig(): Promise<Address> {
	const [address] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [PROTOCOL_CONFIG_SEED],
	});
	return address;
}

/**
 * Derive a split config PDA
 */
export async function deriveSplitConfig(
	authority: Address,
	mint: Address,
	uniqueId: Address,
): Promise<Address> {
	const [address] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [
			SPLIT_CONFIG_SEED,
			addressEncoder.encode(authority),
			addressEncoder.encode(mint),
			addressEncoder.encode(uniqueId),
		],
	});
	return address;
}

/**
 * Derive an Associated Token Account address
 */
export async function deriveAta(
	owner: Address,
	mint: Address,
	tokenProgram: Address = TOKEN_PROGRAM_ID,
): Promise<Address> {
	const [address] = await getProgramDerivedAddress({
		programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
		seeds: [
			addressEncoder.encode(owner),
			addressEncoder.encode(tokenProgram),
			addressEncoder.encode(mint),
		],
	});
	return address;
}

/**
 * Derive the vault address (ATA owned by splitConfig PDA)
 */
export async function deriveVault(
	splitConfig: Address,
	mint: Address,
	tokenProgram: Address = TOKEN_PROGRAM_ID,
): Promise<Address> {
	return deriveAta(splitConfig, mint, tokenProgram);
}

// =============================================================================
// Read Functions
// =============================================================================

/**
 * Get split configuration from vault address.
 *
 * This is the primary read function - takes the vault (where users deposit)
 * and returns the full split configuration with recipients.
 */
export async function getSplitConfigFromVault(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
): Promise<SplitConfig> {
	// 1. Fetch vault to get splitConfig address from owner field
	const vaultInfo = await rpc
		.getAccountInfo(vault, { encoding: "base64" })
		.send();

	if (!vaultInfo.value) {
		throw new VaultNotFoundError(vault);
	}

	const vaultData = Buffer.from(vaultInfo.value.data[0], "base64");

	// Token account: mint (32) + owner (32) + amount (8) + ...
	if (vaultData.length < 72) {
		throw new InvalidTokenAccountError(vault);
	}

	const splitConfigAddress = decodeAddress(vaultData.subarray(32, 64));

	// 2. Fetch splitConfig using generated decoder
	const maybeAccount = await fetchMaybeSplitConfig(rpc, splitConfigAddress);

	if (!maybeAccount.exists) {
		throw new SplitConfigNotFoundError(splitConfigAddress);
	}

	const data = maybeAccount.data;

	// 3. Transform to clean output with both percentageBps and share
	return {
		address: splitConfigAddress,
		version: data.version,
		authority: data.authority,
		mint: data.mint,
		vault: data.vault,
		uniqueId: data.uniqueId,
		bump: data.bump,
		recipients: data.recipients.slice(0, data.recipientCount).map((r) => ({
			address: r.address,
			percentageBps: r.percentageBps,
			share: bpsToShares(r.percentageBps),
		})),
		unclaimedAmounts: data.unclaimedAmounts
			.filter((u) => u.amount > 0n)
			.map((u) => ({
				recipient: u.recipient,
				amount: u.amount,
				timestamp: u.timestamp,
			})),
		protocolUnclaimed: data.protocolUnclaimed,
		lastActivity: data.lastActivity,
		rentPayer: data.rentPayer,
	};
}

/**
 * Get protocol configuration
 */
export async function getProtocolConfig(
	rpc: Rpc<SolanaRpcApi>,
): Promise<ProtocolConfig> {
	const address = await deriveProtocolConfig();

	try {
		const account = await fetchProtocolConfig(rpc, address);
		return {
			address,
			authority: account.data.authority,
			pendingAuthority: account.data.pendingAuthority,
			feeWallet: account.data.feeWallet,
			bump: account.data.bump,
		};
	} catch {
		throw new ProtocolNotInitializedError();
	}
}

/**
 * Get vault token balance
 */
export async function getVaultBalance(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
): Promise<bigint> {
	const accountInfo = await rpc
		.getAccountInfo(vault, { encoding: "base64" })
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
 * Check if an address is a Cascade Split vault
 */
export async function isCascadeSplit(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
): Promise<boolean> {
	try {
		await getSplitConfigFromVault(rpc, vault);
		return true;
	} catch {
		return false;
	}
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a random unique ID for split creation
 */
export function generateUniqueId(): Address {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return decodeAddress(bytes);
}
