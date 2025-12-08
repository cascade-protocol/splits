/**
 * Instruction builders for Cascade Splits
 *
 * Thin wrappers over generated code that add:
 * - Share (1-100) to percentageBps conversion
 * - Vault-centric API (user provides vault, we look up splitConfig)
 * - Convenience return values (addresses on create)
 */

import type { Address, Instruction, Rpc, SolanaRpcApi } from "@solana/kit";
import {
	type Recipient,
	PROGRAM_ID,
	SYSTEM_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	USDC_MINT,
	toPercentageBps,
} from "../index.js";
import { VaultNotFoundError } from "../errors.js";
import {
	getCreateSplitConfigInstructionDataEncoder,
	getExecuteSplitInstructionDataEncoder,
	getUpdateSplitConfigInstructionDataEncoder,
	getCloseSplitConfigInstructionDataEncoder,
} from "./generated/instructions/index.js";
import {
	getSplitConfigFromVault,
	getProtocolConfig,
	deriveSplitConfig,
	deriveAta,
	deriveVault,
	generateUniqueId,
	type SplitConfig,
} from "./helpers.js";

// =============================================================================
// Account Roles (for manual instruction building)
// =============================================================================

const WRITABLE_SIGNER = 3;
const SIGNER = 2;
const WRITABLE = 1;
const READONLY = 0;

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of createSplitConfig
 */
export interface CreateSplitConfigResult {
	/** The instruction to send */
	instruction: Instruction;
	/**
	 * The split configuration PDA address.
	 *
	 * **For x402 integration:** Use this as your `payTo` address.
	 * Facilitators automatically derive the vault ATA from this.
	 */
	splitConfig: Address;
	/**
	 * The vault ATA address where funds are held.
	 *
	 * **⚠️ WARNING:** Do NOT use this as x402 `payTo`.
	 * Using vault as payTo creates a nested ATA (funds unrecoverable).
	 * This is for direct transfers and internal use only.
	 */
	vault: Address;
}

/**
 * Result of executeSplit - discriminated union for type-safe handling
 */
export type ExecuteSplitResult =
	| { ok: true; instruction: Instruction }
	| { ok: false; reason: "not_found" | "not_a_split" };

// =============================================================================
// Create Split Config
// =============================================================================

/**
 * Build instruction to create a new split configuration.
 *
 * @example
 * ```typescript
 * const { instruction, splitConfig } = await createSplitConfig({
 *   authority: myWallet,
 *   recipients: [
 *     { address: alice, share: 60 },
 *     { address: bob, share: 40 },
 *   ],
 * });
 * // Use splitConfig as your x402 payTo address
 * ```
 */
export async function createSplitConfig(params: {
	/** Authority that will control this split */
	authority: Address;
	/** Recipients with share (1-100) or percentageBps (1-9900) */
	recipients: Recipient[];
	/** Token mint (defaults to USDC) */
	mint?: Address;
	/** Unique ID (auto-generated if not provided) */
	uniqueId?: Address;
	/** Token program (defaults to SPL Token) */
	tokenProgram?: Address;
	/** Payer for rent (defaults to authority) */
	payer?: Address;
}): Promise<CreateSplitConfigResult> {
	const {
		authority,
		recipients,
		mint = USDC_MINT,
		uniqueId = generateUniqueId(),
		tokenProgram = TOKEN_PROGRAM_ID,
		payer = authority,
	} = params;

	// Convert recipients to on-chain format
	const onChainRecipients = recipients.map((r) => ({
		address: r.address as Address,
		percentageBps: toPercentageBps(r),
	}));

	// Derive addresses
	const splitConfig = await deriveSplitConfig(authority, mint, uniqueId);
	const vault = await deriveVault(splitConfig, mint, tokenProgram);

	// Derive recipient ATAs (required for validation in remaining accounts)
	const recipientAtas = await Promise.all(
		onChainRecipients.map((r) => deriveAta(r.address, mint, tokenProgram)),
	);

	// Encode instruction data
	const data = getCreateSplitConfigInstructionDataEncoder().encode({
		mint,
		recipients: onChainRecipients,
	});

	const instruction: Instruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{ address: splitConfig, role: WRITABLE },
			{ address: uniqueId, role: READONLY },
			{ address: authority, role: SIGNER },
			{ address: payer, role: WRITABLE_SIGNER },
			{ address: mint, role: READONLY },
			{ address: vault, role: WRITABLE },
			{ address: tokenProgram, role: READONLY },
			{ address: ASSOCIATED_TOKEN_PROGRAM_ID, role: READONLY },
			{ address: SYSTEM_PROGRAM_ID, role: READONLY },
			// Remaining accounts: recipient ATAs for validation
			...recipientAtas.map((ata) => ({ address: ata, role: READONLY })),
		],
		data,
	};

	return { instruction, splitConfig, vault };
}

// =============================================================================
// Execute Split
// =============================================================================

/**
 * Build instruction to execute a split (distribute vault balance).
 *
 * @example
 * ```typescript
 * const result = await executeSplit(rpc, vault, executor);
 * if (result.ok) {
 *   await sendTransaction(result.instruction);
 * }
 * ```
 */
export async function executeSplit(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
	executor: Address,
	tokenProgram: Address = TOKEN_PROGRAM_ID,
): Promise<ExecuteSplitResult> {
	// Fetch split config from vault
	let splitConfig: SplitConfig;
	try {
		splitConfig = await getSplitConfigFromVault(rpc, vault);
	} catch (e) {
		if (e instanceof VaultNotFoundError) {
			return { ok: false, reason: "not_found" };
		}
		return { ok: false, reason: "not_a_split" };
	}

	// Fetch protocol config for fee wallet
	const protocolConfig = await getProtocolConfig(rpc);

	// Derive all ATAs: recipients + protocol (protocol MUST be last)
	const recipientAtas = await Promise.all(
		splitConfig.recipients.map((r) =>
			deriveAta(r.address, splitConfig.mint, tokenProgram),
		),
	);
	const protocolAta = await deriveAta(
		protocolConfig.feeWallet,
		splitConfig.mint,
		tokenProgram,
	);

	// Encode instruction data
	const data = getExecuteSplitInstructionDataEncoder().encode({});

	const instruction: Instruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{ address: splitConfig.address, role: WRITABLE },
			{ address: vault, role: WRITABLE },
			{ address: splitConfig.mint, role: READONLY },
			{ address: protocolConfig.address, role: READONLY },
			{ address: executor, role: READONLY },
			{ address: tokenProgram, role: READONLY },
			// Remaining accounts: recipient ATAs + protocol ATA (last)
			...recipientAtas.map((ata) => ({ address: ata, role: WRITABLE })),
			{ address: protocolAta, role: WRITABLE },
		],
		data,
	};

	return { ok: true, instruction };
}

// =============================================================================
// Update Split Config
// =============================================================================

/**
 * Build instruction to update split recipients.
 *
 * @example
 * ```typescript
 * const instruction = await updateSplitConfig(rpc, {
 *   vault,
 *   authority: myWallet,
 *   recipients: [{ address: newRecipient, share: 100 }],
 * });
 * ```
 */
export async function updateSplitConfig(
	rpc: Rpc<SolanaRpcApi>,
	params: {
		/** Vault address */
		vault: Address;
		/** Authority (must be signer) */
		authority: Address;
		/** New recipients with share (1-100) or percentageBps (1-9900) */
		recipients: Recipient[];
		/** Token program (defaults to SPL Token) */
		tokenProgram?: Address;
	},
): Promise<Instruction> {
	const {
		vault,
		authority,
		recipients,
		tokenProgram = TOKEN_PROGRAM_ID,
	} = params;

	// Fetch existing config
	const splitConfig = await getSplitConfigFromVault(rpc, vault);

	// Convert recipients to on-chain format
	const onChainRecipients = recipients.map((r) => ({
		address: r.address as Address,
		percentageBps: toPercentageBps(r),
	}));

	// Derive ATAs for new recipients (for validation)
	const recipientAtas = await Promise.all(
		onChainRecipients.map((r) =>
			deriveAta(r.address, splitConfig.mint, tokenProgram),
		),
	);

	// Encode instruction data
	const data = getUpdateSplitConfigInstructionDataEncoder().encode({
		newRecipients: onChainRecipients,
	});

	return {
		programAddress: PROGRAM_ID,
		accounts: [
			{ address: splitConfig.address, role: WRITABLE },
			{ address: vault, role: READONLY },
			{ address: splitConfig.mint, role: READONLY },
			{ address: authority, role: SIGNER },
			{ address: tokenProgram, role: READONLY },
			// Remaining accounts: recipient ATAs for validation
			...recipientAtas.map((ata) => ({ address: ata, role: READONLY })),
		],
		data,
	};
}

// =============================================================================
// Close Split Config
// =============================================================================

/**
 * Build instruction to close a split and recover rent.
 *
 * @example
 * ```typescript
 * const instruction = await closeSplitConfig(rpc, {
 *   vault,
 *   authority: myWallet,
 * });
 * ```
 */
export async function closeSplitConfig(
	rpc: Rpc<SolanaRpcApi>,
	params: {
		/** Vault address */
		vault: Address;
		/** Authority (must be signer) */
		authority: Address;
		/** Rent receiver (defaults to authority) */
		rentReceiver?: Address;
		/** Token program (defaults to SPL Token) */
		tokenProgram?: Address;
	},
): Promise<Instruction> {
	const {
		vault,
		authority,
		rentReceiver = authority,
		tokenProgram = TOKEN_PROGRAM_ID,
	} = params;

	// Fetch existing config
	const splitConfig = await getSplitConfigFromVault(rpc, vault);

	// Encode instruction data
	const data = getCloseSplitConfigInstructionDataEncoder().encode({});

	return {
		programAddress: PROGRAM_ID,
		accounts: [
			{ address: splitConfig.address, role: WRITABLE },
			{ address: vault, role: WRITABLE },
			{ address: authority, role: SIGNER },
			{ address: rentReceiver, role: WRITABLE },
			{ address: tokenProgram, role: READONLY },
		],
		data,
	};
}
