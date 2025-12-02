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
// Browser-compatible utilities (no Node.js Buffer dependency)
// =============================================================================

/** Decode base64 string to Uint8Array (browser-native) */
function decodeBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Read little-endian u64 from Uint8Array at offset */
function readBigUInt64LE(data: Uint8Array, offset: number): bigint {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return view.getBigUint64(offset, true); // true = little-endian
}

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

/**
 * Vault balance and token program info
 * @internal Used by executeAndConfirmSplit for Token-2022 auto-detection
 */
export interface VaultInfo {
	balance: bigint;
	tokenProgram: Address;
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
// Caches
// =============================================================================

/**
 * Cache for isCascadeSplit results.
 *
 * Caching behavior:
 * - Positive results (is a split): cached indefinitely
 * - Negative results (existing account, not a split): cached indefinitely
 * - Non-existent accounts: NOT cached (could be created as split later)
 * - RPC errors: NOT cached (transient failures)
 *
 * In Node.js: persists for process lifetime (full benefit)
 * In Browser: persists for page session (limited benefit)
 */
const splitCache = new Map<string, boolean>();

/**
 * Cached protocol config (rarely changes).
 * Auto-invalidated on InvalidProtocolFeeRecipient error.
 */
let cachedProtocolConfig: ProtocolConfig | null = null;

/**
 * Invalidate cache entry for a specific vault.
 * Call after closeSplitConfig if immediate re-detection is needed.
 */
export function invalidateSplitCache(vault: Address): void {
	splitCache.delete(vault as string);
}

/**
 * Clear entire split detection cache.
 */
export function clearSplitCache(): void {
	splitCache.clear();
}

/**
 * Invalidate protocol config cache.
 * Called automatically on InvalidProtocolFeeRecipient error during execution.
 */
export function invalidateProtocolConfigCache(): void {
	cachedProtocolConfig = null;
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

	const vaultData = decodeBase64(vaultInfo.value.data[0]);

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
 * Get protocol configuration.
 *
 * Results are cached for efficiency (protocol config rarely changes).
 * Cache is auto-invalidated on InvalidProtocolFeeRecipient error.
 */
export async function getProtocolConfig(
	rpc: Rpc<SolanaRpcApi>,
): Promise<ProtocolConfig> {
	if (cachedProtocolConfig) {
		return cachedProtocolConfig;
	}

	const address = await deriveProtocolConfig();

	try {
		const account = await fetchProtocolConfig(rpc, address);
		cachedProtocolConfig = {
			address,
			authority: account.data.authority,
			pendingAuthority: account.data.pendingAuthority,
			feeWallet: account.data.feeWallet,
			bump: account.data.bump,
		};
		return cachedProtocolConfig;
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

	const data = decodeBase64(accountInfo.value.data[0]);
	if (data.length < 72) {
		throw new InvalidTokenAccountError(vault);
	}

	return readBigUInt64LE(data, 64);
}

/**
 * Get vault balance and token program in a single RPC call.
 * Returns null if vault doesn't exist.
 * @internal Used by executeAndConfirmSplit for Token-2022 auto-detection
 */
export async function getVaultBalanceAndOwner(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
): Promise<VaultInfo | null> {
	const accountInfo = await rpc
		.getAccountInfo(vault, { encoding: "base64" })
		.send();

	if (!accountInfo.value) {
		return null;
	}

	const data = decodeBase64(accountInfo.value.data[0]);
	if (data.length < 72) {
		return null; // Invalid token account
	}

	const balance = readBigUInt64LE(data, 64);
	const tokenProgram = accountInfo.value.owner as Address;

	return { balance, tokenProgram };
}

/**
 * Check if an address is a Cascade Split vault.
 *
 * Results are cached for efficiency:
 * - Positive results (is a split): cached indefinitely
 * - Negative results (existing account, not a split): cached indefinitely
 * - Non-existent accounts: NOT cached (could be created later)
 * - RPC errors: NOT cached (transient failures)
 */
export async function isCascadeSplit(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
): Promise<boolean> {
	const key = vault as string;
	const cached = splitCache.get(key);

	if (cached !== undefined) {
		return cached;
	}

	try {
		await getSplitConfigFromVault(rpc, vault);
		splitCache.set(key, true);
		return true;
	} catch (e) {
		if (e instanceof VaultNotFoundError) {
			// Account doesn't exist - might be created as split later
			return false; // DON'T CACHE
		}
		if (
			e instanceof InvalidTokenAccountError ||
			e instanceof SplitConfigNotFoundError
		) {
			// Account exists but definitively not a split - safe to cache
			splitCache.set(key, false);
			return false;
		}
		// Unknown error (RPC failure, etc.) - don't cache, propagate
		throw e;
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
