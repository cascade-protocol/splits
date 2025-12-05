/**
 * Account discovery and state fetching for Squads Smart Account SDK.
 *
 * Functions to find and load smart account state by owner or settings address.
 */

import {
	type Address,
	type Rpc,
	type SolanaRpcApi,
	type GetAccountInfoApi,
	type Base58EncodedBytes,
	getBase58Decoder,
	getAddressEncoder,
} from "@solana/kit";
import {
	SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
	SETTINGS_DISCRIMINATOR,
	fetchMaybeSpendingLimit,
} from "./generated/index.js";
import {
	deriveSmartAccount,
	deriveSpendingLimit,
	deriveAta,
	decodeBase64,
	readBigUInt64LE,
} from "./helpers.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Smart account state with balance and spending limit info.
 */
export interface SmartAccountState {
	/** Smart account settings address (PDA) */
	address: Address;
	/** Vault address - the Smart Account PDA that owns the token account */
	vaultAddress: Address;
	/** Vault ATA address - the actual token account holding USDC */
	vaultAtaAddress: Address;
	/** Token balance in base units */
	balance: bigint;
	/** Current spending limit config, null if not set */
	spendingLimit: SpendingLimitConfig | null;
}

/**
 * Spending limit configuration.
 */
export interface SpendingLimitConfig {
	/** Spending limit PDA */
	pda: Address;
	/** Daily limit in token base units */
	dailyLimit: bigint;
	/** Per-transaction limit in token base units */
	perTxLimit: bigint;
	/** Remaining allowance for current period */
	remainingToday: bigint;
	/** Last reset timestamp */
	lastResetAt: Date;
}

// =============================================================================
// Token Account Helpers (internal)
// =============================================================================

/**
 * Get token account balance from RPC.
 * Internal helper - use @solana-program/token for public API.
 */
async function getTokenBalance(
	rpc: Rpc<GetAccountInfoApi>,
	tokenAccount: Address,
): Promise<bigint> {
	const accountInfo = await rpc
		.getAccountInfo(tokenAccount, { encoding: "base64" })
		.send();

	if (!accountInfo.value) {
		return 0n; // Account doesn't exist
	}

	const data = decodeBase64(accountInfo.value.data[0]);
	if (data.length < 72) {
		return 0n; // Invalid token account
	}

	// Token account layout: mint (32) + owner (32) + amount (8)
	return readBigUInt64LE(data, 64);
}

// =============================================================================
// Account Discovery by Owner
// =============================================================================

// Settings account layout: discriminator (8) + seed (16) + settingsAuthority (32)
const SETTINGS_AUTHORITY_OFFSET = 8 + 16; // 24 bytes

// Stable decoder instance
const base58Decoder = getBase58Decoder();
const addressEncoder = getAddressEncoder();

/**
 * Discover and fetch smart account state by owner address.
 *
 * Uses getProgramAccounts with memcmp filter on settingsAuthority.
 * This is useful when you know the owner but not the settings PDA.
 *
 * @param rpc - RPC client
 * @param ownerAddress - Owner/authority address
 * @param executorPubkey - Optional executor pubkey for spending limit lookup
 * @param mint - Token mint address for balance lookup
 * @returns Smart account state or null if no account found
 *
 * @example
 * ```typescript
 * // Find smart account for connected wallet
 * const state = await fetchSmartAccountStateByOwner(
 *   rpc,
 *   walletAddress,
 *   EXECUTOR_PUBKEY,
 *   USDC_MINT
 * );
 *
 * if (state) {
 *   console.log(`Vault: ${state.vaultAddress}`);
 *   console.log(`Balance: ${state.balance}`);
 * }
 * ```
 */
export async function fetchSmartAccountStateByOwner(
	rpc: Rpc<SolanaRpcApi>,
	ownerAddress: Address,
	executorPubkey?: Address,
	mint?: Address,
): Promise<SmartAccountState | null> {
	// Build memcmp filters using base58 encoding
	const discriminatorBase58 = base58Decoder.decode(
		SETTINGS_DISCRIMINATOR,
	) as Base58EncodedBytes;
	const ownerBytes = addressEncoder.encode(ownerAddress);
	const ownerBase58 = base58Decoder.decode(ownerBytes) as Base58EncodedBytes;

	// Query for Settings accounts with matching settingsAuthority
	const accounts = await rpc
		.getProgramAccounts(SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS, {
			encoding: "base64",
			filters: [
				{
					memcmp: {
						offset: 0n,
						bytes: discriminatorBase58,
						encoding: "base58" as const,
					},
				},
				{
					memcmp: {
						offset: BigInt(SETTINGS_AUTHORITY_OFFSET),
						bytes: ownerBase58,
						encoding: "base58" as const,
					},
				},
			],
		})
		.send();

	const firstAccount = accounts[0];
	if (!firstAccount) {
		return null;
	}

	// Use the first matching account (user should only have one)
	const settingsAddress = firstAccount.pubkey;

	// Derive vault address
	const vaultAddress = await deriveSmartAccount(settingsAddress, 0);

	// Fetch spending limit for executor if configured
	let spendingLimit: SpendingLimitConfig | null = null;
	if (executorPubkey) {
		const spendingLimitPda = await deriveSpendingLimit(
			settingsAddress,
			executorPubkey,
		);
		const maybeSpendingLimit = await fetchMaybeSpendingLimit(
			rpc,
			spendingLimitPda,
		);

		if (maybeSpendingLimit.exists) {
			const sl = maybeSpendingLimit.data;
			spendingLimit = {
				pda: spendingLimitPda,
				dailyLimit: sl.amount,
				perTxLimit: sl.amount, // Squads uses same limit for both
				remainingToday: sl.remainingAmount,
				lastResetAt: new Date(Number(sl.lastReset) * 1000),
			};
		}
	}

	// Fetch vault balance if mint is provided
	let balance = 0n;
	let vaultAtaAddress = vaultAddress; // Default to vault PDA if no mint
	if (mint) {
		vaultAtaAddress = await deriveAta(vaultAddress, mint);
		balance = await getTokenBalance(rpc, vaultAtaAddress);
	}

	return {
		address: settingsAddress,
		vaultAddress,
		vaultAtaAddress,
		balance,
		spendingLimit,
	};
}

/**
 * Check if an address has a smart account.
 *
 * Lightweight check that doesn't fetch full state.
 *
 * @param rpc - RPC client
 * @param ownerAddress - Owner/authority address
 * @returns True if owner has a smart account
 */
export async function hasSmartAccount(
	rpc: Rpc<SolanaRpcApi>,
	ownerAddress: Address,
): Promise<boolean> {
	const discriminatorBase58 = base58Decoder.decode(
		SETTINGS_DISCRIMINATOR,
	) as Base58EncodedBytes;
	const ownerBytes = addressEncoder.encode(ownerAddress);
	const ownerBase58 = base58Decoder.decode(ownerBytes) as Base58EncodedBytes;

	const accounts = await rpc
		.getProgramAccounts(SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS, {
			encoding: "base64",
			dataSlice: { offset: 0, length: 0 }, // Don't fetch data, just check existence
			filters: [
				{
					memcmp: {
						offset: 0n,
						bytes: discriminatorBase58,
						encoding: "base58" as const,
					},
				},
				{
					memcmp: {
						offset: BigInt(SETTINGS_AUTHORITY_OFFSET),
						bytes: ownerBase58,
						encoding: "base58" as const,
					},
				},
			],
		})
		.send();

	return accounts.length > 0;
}
