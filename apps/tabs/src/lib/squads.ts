/**
 * Squads Smart Account integration for Cascade Tabs.
 *
 * Types, constants, PDA derivation, transaction builders, and API key encoding.
 * Uses Codama-generated client from @cascade-fyi/tabs-sdk.
 */

import {
	type Address,
	type Instruction,
	type TransactionSigner,
	getAddressEncoder,
	getProgramDerivedAddress,
	getUtf8Encoder,
	getU128Encoder,
	getU8Encoder,
} from "@solana/kit";
import {
	SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
	getCreateSmartAccountInstruction,
	getAddSpendingLimitAsAuthorityInstruction,
	getRemoveSpendingLimitAsAuthorityInstruction,
	getUseSpendingLimitInstruction,
	fetchProgramConfig,
	fetchMaybeSettings,
	fetchMaybeSpendingLimit,
	Period,
	type SmartAccountSigner,
} from "@cascade-fyi/tabs-sdk";

// === Constants ===

/** USDC mint on Solana mainnet */
export const USDC_MINT =
	"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;

/** USDC decimals */
export const USDC_DECIMALS = 6;

/** Executor pubkey - the Tabs facilitator that can execute spending limit txs */
export const EXECUTOR_PUBKEY = (import.meta.env.VITE_EXECUTOR_PUBKEY ??
	"") as Address;

/** Program ID */
export const PROGRAM_ID = SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS;

// === Types ===

export interface SmartAccountState {
	/** Smart account address (PDA) */
	address: Address;
	/** Vault token account address for USDC */
	vaultAddress: Address;
	/** USDC balance in base units (6 decimals) */
	balance: bigint;
	/** Current spending limit config, null if not set */
	spendingLimit: SpendingLimitConfig | null;
}

export interface SpendingLimitConfig {
	/** Spending limit PDA */
	pda: Address;
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

// === PDA Derivation ===

const SEED_PREFIX = getUtf8Encoder().encode("smart_account");
const SEED_PROGRAM_CONFIG = getUtf8Encoder().encode("program_config");
const SEED_SETTINGS = getUtf8Encoder().encode("settings");
const SEED_SMART_ACCOUNT = getUtf8Encoder().encode("smart_account");
const SEED_SPENDING_LIMIT = getUtf8Encoder().encode("spending_limit");

/** Derive ProgramConfig PDA */
export async function getProgramConfigPda(): Promise<Address> {
	const [pda] = await getProgramDerivedAddress({
		seeds: [SEED_PREFIX, SEED_PROGRAM_CONFIG],
		programAddress: PROGRAM_ID,
	});
	return pda;
}

/** Derive Settings PDA for a given account index */
export async function getSettingsPda(accountIndex: bigint): Promise<Address> {
	const [pda] = await getProgramDerivedAddress({
		seeds: [SEED_PREFIX, SEED_SETTINGS, getU128Encoder().encode(accountIndex)],
		programAddress: PROGRAM_ID,
	});
	return pda;
}

/** Derive Smart Account (vault) PDA */
export async function getSmartAccountPda(
	settingsPda: Address,
	vaultIndex: number = 0,
): Promise<Address> {
	const [pda] = await getProgramDerivedAddress({
		seeds: [
			SEED_PREFIX,
			getAddressEncoder().encode(settingsPda),
			SEED_SMART_ACCOUNT,
			getU8Encoder().encode(vaultIndex),
		],
		programAddress: PROGRAM_ID,
	});
	return pda;
}

/** Derive Spending Limit PDA */
export async function getSpendingLimitPda(
	settingsPda: Address,
	seed: Address,
): Promise<Address> {
	const [pda] = await getProgramDerivedAddress({
		seeds: [
			SEED_PREFIX,
			getAddressEncoder().encode(settingsPda),
			SEED_SPENDING_LIMIT,
			getAddressEncoder().encode(seed),
		],
		programAddress: PROGRAM_ID,
	});
	return pda;
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

// === Transaction Builders ===

/**
 * Get the next available account index from ProgramConfig.
 */
export async function getNextAccountIndex(
	rpc: Parameters<typeof fetchProgramConfig>[0],
): Promise<bigint> {
	const programConfigPda = await getProgramConfigPda();
	const programConfig = await fetchProgramConfig(rpc, programConfigPda);
	return programConfig.data.smartAccountIndex + 1n;
}

/**
 * Build instruction to create a new Smart Account.
 */
export async function buildCreateAccountInstruction(
	creator: TransactionSigner,
	accountIndex: bigint,
): Promise<{
	instruction: Instruction;
	settingsAddress: Address;
	vaultAddress: Address;
}> {
	const programConfigPda = await getProgramConfigPda();
	const settingsAddress = await getSettingsPda(accountIndex);
	const vaultAddress = await getSmartAccountPda(settingsAddress, 0);

	// Owner signer with all permissions (mask = 15 = 0b1111)
	const ownerSigner: SmartAccountSigner = {
		key: creator.address,
		permissions: { mask: 15 },
	};

	const instruction = getCreateSmartAccountInstruction({
		programConfig: programConfigPda,
		treasury: creator.address, // Creator pays creation fee
		creator,
		program: PROGRAM_ID,
		settingsAuthority: creator.address,
		threshold: 1,
		signers: [ownerSigner],
		timeLock: 0,
		rentCollector: creator.address,
		memo: null,
	});

	return { instruction, settingsAddress, vaultAddress };
}

/**
 * Build instruction to add a spending limit.
 */
export async function buildAddSpendingLimitInstruction(
	settingsAddress: Address,
	settingsAuthority: TransactionSigner,
	executorAddress: Address,
	amount: bigint,
	mint: Address,
): Promise<{ instruction: Instruction; spendingLimitAddress: Address }> {
	const spendingLimitAddress = await getSpendingLimitPda(
		settingsAddress,
		executorAddress,
	);

	const instruction = getAddSpendingLimitAsAuthorityInstruction({
		settings: settingsAddress,
		settingsAuthority,
		spendingLimit: spendingLimitAddress,
		rentPayer: settingsAuthority,
		program: PROGRAM_ID,
		seed: executorAddress,
		accountIndex: 0,
		mint,
		amount,
		period: Period.Day,
		signers: [executorAddress],
		destinations: [], // Empty = any destination
		expiration: BigInt("9223372036854775807"), // i64::MAX = non-expiring
		memo: null,
	});

	return { instruction, spendingLimitAddress };
}

/**
 * Build instruction to remove a spending limit.
 */
export function buildRemoveSpendingLimitInstruction(
	settingsAddress: Address,
	settingsAuthority: TransactionSigner,
	spendingLimitAddress: Address,
	rentCollector: Address,
): Instruction {
	return getRemoveSpendingLimitAsAuthorityInstruction({
		settings: settingsAddress,
		settingsAuthority,
		spendingLimit: spendingLimitAddress,
		rentCollector,
		program: PROGRAM_ID,
		memo: null,
	});
}

/**
 * Build instruction to use a spending limit (transfer from vault).
 */
export function buildUseSpendingLimitInstruction(
	settingsAddress: Address,
	signer: TransactionSigner,
	spendingLimitAddress: Address,
	smartAccountAddress: Address,
	mint: Address,
	smartAccountTokenAccount: Address,
	destination: Address,
	destinationTokenAccount: Address,
	amount: bigint,
	decimals: number = USDC_DECIMALS,
): Instruction {
	return getUseSpendingLimitInstruction({
		settings: settingsAddress,
		signer,
		spendingLimit: spendingLimitAddress,
		smartAccount: smartAccountAddress,
		destination,
		mint,
		smartAccountTokenAccount,
		destinationTokenAccount,
		tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address,
		program: PROGRAM_ID,
		amount,
		decimals,
		memo: null,
	});
}

// === Account Fetching ===

/**
 * Fetch smart account state for a given owner.
 * Returns null if no account exists.
 */
export async function fetchSmartAccountState(
	rpc: Parameters<typeof fetchMaybeSettings>[0],
	settingsAddress: Address,
): Promise<SmartAccountState | null> {
	const maybeSettings = await fetchMaybeSettings(rpc, settingsAddress);

	if (!maybeSettings.exists) {
		return null;
	}

	const vaultAddress = await getSmartAccountPda(settingsAddress, 0);

	// Fetch spending limit for executor if configured
	let spendingLimit: SpendingLimitConfig | null = null;
	if (EXECUTOR_PUBKEY) {
		const spendingLimitPda = await getSpendingLimitPda(
			settingsAddress,
			EXECUTOR_PUBKEY,
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

	// TODO: Fetch vault USDC balance via token account
	const balance = 0n;

	return {
		address: settingsAddress,
		vaultAddress,
		balance,
		spendingLimit,
	};
}

// === Hook-Compatible Wrappers (Phase 4 stubs) ===

/**
 * Stub for fetchSmartAccountState that takes only owner address.
 * Phase 4: Will need to discover settings address from owner and use RPC.
 */
export async function fetchSmartAccountStateByOwner(
	_ownerAddress: Address,
): Promise<SmartAccountState | null> {
	// TODO Phase 4: Implement account discovery
	// 1. Get RPC client from connection context
	// 2. Use getProgramAccounts with memcmp filter on settingsAuthority
	// 3. Call fetchSmartAccountState with discovered settings address
	throw new Error("Not implemented - Phase 4: Account discovery");
}

/**
 * Build a transaction to create a new smart account.
 * Phase 4: Returns full transaction ready to sign.
 */
export async function buildCreateAccountTx(
	_ownerAddress: Address,
): Promise<{ tx: unknown; accountAddress: Address }> {
	// TODO Phase 4: Build full transaction
	// 1. Get next account index from ProgramConfig
	// 2. Build create instruction
	// 3. Build and return transaction
	throw new Error("Not implemented - Phase 4: Transaction building");
}

/**
 * Build a transaction to deposit USDC into the vault.
 * Phase 4: Standard SPL token transfer.
 */
export async function buildDepositTx(
	_ownerAddress: Address,
	_vaultAddress: Address,
	_amount: bigint,
): Promise<unknown> {
	// TODO Phase 4: Build SPL transfer from owner's ATA to vault ATA
	throw new Error("Not implemented - Phase 4: Deposit transaction");
}

/**
 * Build a transaction to withdraw USDC from the vault.
 * Phase 4: Requires owner signature via Squads proposal.
 */
export async function buildWithdrawTx(
	_ownerAddress: Address,
	_vaultAddress: Address,
	_amount: bigint,
): Promise<unknown> {
	// TODO Phase 4: Build Squads proposal for withdrawal
	throw new Error("Not implemented - Phase 4: Withdraw transaction");
}

/**
 * Build a transaction to set or update spending limit.
 * Phase 4: Uses buildAddSpendingLimitInstruction.
 */
export async function buildSetSpendingLimitTx(
	_settingsAddress: Address,
	_dailyLimit: bigint,
	_perTxLimit: bigint,
): Promise<unknown> {
	// TODO Phase 4: Build spending limit transaction
	// Note: Squads uses single amount for both daily and per-tx limit
	throw new Error("Not implemented - Phase 4: Spending limit transaction");
}

/**
 * Build a transaction to revoke a spending limit.
 * Phase 4: Uses buildRemoveSpendingLimitInstruction.
 */
export async function buildRevokeSpendingLimitTx(
	_settingsAddress: Address,
	_spendingLimitPda: Address,
): Promise<unknown> {
	// TODO Phase 4: Build revoke spending limit transaction
	throw new Error("Not implemented - Phase 4: Revoke spending limit");
}
