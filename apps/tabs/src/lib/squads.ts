/**
 * Squads Smart Account integration for Cascade Tabs.
 *
 * Types, constants, transaction builders, and API key encoding.
 * Uses @solana/web3-compat for Squads SDK compatibility (Phase 4).
 */

// === Constants ===

/** USDC mint on Solana mainnet */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** USDC decimals */
export const USDC_DECIMALS = 6;

/** Executor pubkey - the Tabs facilitator that can execute spending limit txs */
export const EXECUTOR_PUBKEY = import.meta.env.VITE_EXECUTOR_PUBKEY ?? "";

// === Types ===

export interface SmartAccountState {
	/** Smart account address (PDA) */
	address: string;
	/** Vault token account address for USDC */
	vaultAddress: string;
	/** USDC balance in base units (6 decimals) */
	balance: bigint;
	/** Current spending limit config, null if not set */
	spendingLimit: SpendingLimitConfig | null;
}

export interface SpendingLimitConfig {
	/** Spending limit PDA */
	pda: string;
	/** Daily limit in USDC base units */
	dailyLimit: bigint;
	/** Per-transaction limit in USDC base units */
	perTxLimit: bigint;
	/** Remaining allowance for today */
	remainingToday: bigint;
	/** Last reset timestamp */
	lastResetAt: Date;
}

export interface ApiKeyPayload {
	/** Smart account settings PDA */
	settingsPda: string;
	/** Spending limit PDA */
	spendingLimitPda: string;
	/** Per-transaction max in USDC base units */
	perTxMax: bigint;
	/** Version for future compatibility */
	version: number;
}

// === API Key Encoding ===

const API_KEY_PREFIX = "tabs_";
const API_KEY_VERSION = 1;

/**
 * Encode smart account info into an API key.
 * Format: tabs_<base64url(json)>
 */
export function encodeApiKey(payload: Omit<ApiKeyPayload, "version">): string {
	const fullPayload: ApiKeyPayload = {
		...payload,
		perTxMax: payload.perTxMax,
		version: API_KEY_VERSION,
	};

	// Convert bigint to string for JSON serialization
	const serializable = {
		...fullPayload,
		perTxMax: fullPayload.perTxMax.toString(),
	};

	const json = JSON.stringify(serializable);
	const base64 = btoa(json)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	return `${API_KEY_PREFIX}${base64}`;
}

/**
 * Decode an API key back to payload.
 * Returns null if invalid.
 */
export function decodeApiKey(key: string): ApiKeyPayload | null {
	if (!key.startsWith(API_KEY_PREFIX)) {
		return null;
	}

	try {
		const base64 = key
			.slice(API_KEY_PREFIX.length)
			.replace(/-/g, "+")
			.replace(/_/g, "/");

		const json = atob(base64);
		const parsed = JSON.parse(json);

		return {
			settingsPda: parsed.settingsPda,
			spendingLimitPda: parsed.spendingLimitPda,
			perTxMax: BigInt(parsed.perTxMax),
			version: parsed.version,
		};
	} catch {
		return null;
	}
}

// === Formatting Helpers ===

/**
 * Format USDC amount from base units to display string.
 */
export function formatUsdc(amount: bigint): string {
	const whole = amount / BigInt(10 ** USDC_DECIMALS);
	const fraction = amount % BigInt(10 ** USDC_DECIMALS);
	const fractionStr = fraction.toString().padStart(USDC_DECIMALS, "0");
	// Trim trailing zeros but keep at least 2 decimal places
	const trimmed = fractionStr.replace(/0+$/, "").padEnd(2, "0");
	return `${whole}.${trimmed}`;
}

/**
 * Parse USDC display string to base units.
 */
export function parseUsdc(display: string): bigint {
	const [whole, fraction = ""] = display.split(".");
	const paddedFraction = fraction
		.slice(0, USDC_DECIMALS)
		.padEnd(USDC_DECIMALS, "0");
	return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(paddedFraction);
}

// === Transaction Builders (Phase 4 - stubs) ===

/**
 * Build transaction to create a new Smart Account.
 * TODO: Implement with @sqds/multisig in Phase 4
 */
export async function buildCreateAccountTx(
	_ownerPubkey: string,
): Promise<{ tx: unknown; accountAddress: string }> {
	throw new Error("Not implemented - Phase 4");
}

/**
 * Build transaction to deposit USDC into the vault.
 * TODO: Implement with SPL token transfer in Phase 4
 */
export async function buildDepositTx(
	_ownerPubkey: string,
	_vaultAddress: string,
	_amount: bigint,
): Promise<unknown> {
	throw new Error("Not implemented - Phase 4");
}

/**
 * Build transaction to withdraw USDC from the vault.
 * TODO: Implement with Squads vault withdrawal in Phase 4
 */
export async function buildWithdrawTx(
	_ownerPubkey: string,
	_vaultAddress: string,
	_amount: bigint,
): Promise<unknown> {
	throw new Error("Not implemented - Phase 4");
}

/**
 * Build transaction to set/update spending limit.
 * TODO: Implement with Squads spending limit IX in Phase 4
 */
export async function buildSetSpendingLimitTx(
	_accountAddress: string,
	_dailyLimit: bigint,
	_perTxLimit: bigint,
): Promise<unknown> {
	throw new Error("Not implemented - Phase 4");
}

/**
 * Build transaction to revoke spending limit.
 * TODO: Implement with Squads spending limit IX in Phase 4
 */
export async function buildRevokeSpendingLimitTx(
	_accountAddress: string,
	_spendingLimitPda: string,
): Promise<unknown> {
	throw new Error("Not implemented - Phase 4");
}

// === Account Fetching (Phase 4 - stubs) ===

/**
 * Fetch smart account state for a given owner.
 * Returns null if no account exists.
 * TODO: Implement with RPC calls in Phase 4
 */
export async function fetchSmartAccountState(
	_ownerPubkey: string,
): Promise<SmartAccountState | null> {
	// Phase 4: Will query:
	// 1. Smart account PDA from owner
	// 2. Vault token account balance
	// 3. Spending limit account if exists
	return null;
}
