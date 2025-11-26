/**
 * Instruction builders for @solana/kit v5
 * These work with protocol format (basis points, not shares)
 */

import type { Address } from "@solana/kit";
import {
	validateAndTransformCreate,
	validateAndTransformUpdate,
} from "../core/business-logic.js";
import type { CreateSplitInput, UpdateSplitInput } from "../core/schemas.js";
import {
	deriveSplitConfig,
	deriveVault,
	deriveAta,
	deriveProtocolConfig,
} from "../pda.js";
import { DISCRIMINATORS } from "../discriminators.js";
import {
	SYSTEM_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	PROGRAM_ID,
} from "../core/constants.js";
import { decodeAddress, encodeAddress } from "../core/encoding.js";
import { getSplit, getProtocolConfig } from "./read.js";
import type { Rpc, SolanaRpcApi } from "@solana/kit";

// Account role constants for Kit v5
const WRITABLE_SIGNER = 3;
const WRITABLE = 1;
const READONLY = 0;

// Instruction data format constants
const DISCRIMINATOR_SIZE = 8;
const ADDRESS_SIZE = 32;
const U16_SIZE = 2;
const U32_SIZE = 4;

/**
 * Kit v5 instruction format
 */
export interface KitInstruction {
	programAddress: Address;
	accounts: ReadonlyArray<{
		address: Address;
		role: number;
	}>;
	data: Uint8Array;
}

/**
 * Build instruction to create a new split configuration
 * High-level function using 100-share model
 */
export function buildCreateSplitInstruction(
	params: CreateSplitInput,
	authority: Address,
	payer?: Address,
	uniqueId?: Address,
	programId?: Address,
): KitInstruction {
	const processed = validateAndTransformCreate(params);

	const mint = processed.token as Address;
	const tokenProgram = TOKEN_PROGRAM_ID as Address;
	const actualPayer = payer ?? authority;
	const actualProgramId = (programId ?? PROGRAM_ID) as Address;
	const actualUniqueId = uniqueId ?? generateRandomAddress();

	return buildCreateSplitConfigRaw(
		actualProgramId,
		ASSOCIATED_TOKEN_PROGRAM_ID as Address,
		authority,
		mint,
		actualUniqueId,
		processed.recipients,
		tokenProgram,
		actualPayer,
	);
}

/**
 * Build instruction to execute a split (distribute vault balance)
 * High-level async function that fetches split config
 */
export async function buildExecuteSplitInstruction(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
	executor: Address,
	programId?: Address,
): Promise<KitInstruction> {
	const split = await getSplit(rpc, vault);
	const actualProgramId = (programId ?? PROGRAM_ID) as Address;

	// Derive all recipient ATAs
	const recipientAtas: Address[] = [];
	for (const recipient of split.recipients) {
		const ata = deriveAta(recipient.address, split.mint, TOKEN_PROGRAM_ID);
		recipientAtas.push(ata as Address);
	}

	// Derive protocol ATA using actual fee_wallet
	const protocolConfigData = await getProtocolConfig(rpc);
	const protocolAta = deriveAta(
		protocolConfigData.feeWallet,
		split.mint,
		TOKEN_PROGRAM_ID,
	) as Address;

	// Derive splitConfig and protocolConfig addresses
	const { address: splitConfigAddress } = deriveSplitConfig(
		split.authority,
		split.mint,
		split.uniqueId,
	);
	const { address: protocolConfigAddress } = deriveProtocolConfig();

	return buildExecuteSplitConfigRaw(
		actualProgramId,
		splitConfigAddress as Address,
		split.vault as Address,
		split.mint as Address,
		protocolConfigAddress as Address,
		recipientAtas,
		protocolAta,
		executor,
		TOKEN_PROGRAM_ID as Address,
	);
}

/**
 * Build instruction to update split recipients
 * High-level async function that fetches split config
 */
export async function buildUpdateSplitInstruction(
	rpc: Rpc<SolanaRpcApi>,
	params: UpdateSplitInput,
	authority: Address,
	programId?: Address,
): Promise<KitInstruction> {
	const processed = validateAndTransformUpdate(params);
	const split = await getSplit(rpc, params.vault as Address);
	const actualProgramId = (programId ?? PROGRAM_ID) as Address;

	// Derive splitConfig address
	const { address: splitConfigAddress } = deriveSplitConfig(
		split.authority,
		split.mint,
		split.uniqueId,
	);

	return buildUpdateSplitConfigRaw(
		actualProgramId,
		splitConfigAddress as Address,
		split.vault as Address,
		split.mint as Address,
		authority,
		processed.recipients,
		TOKEN_PROGRAM_ID as Address,
	);
}

/**
 * Build instruction to close a split and recover rent
 * High-level async function that fetches split config
 */
export async function buildCloseSplitInstruction(
	rpc: Rpc<SolanaRpcApi>,
	vault: Address,
	authority: Address,
	rentReceiver?: Address,
	programId?: Address,
): Promise<KitInstruction> {
	const split = await getSplit(rpc, vault);
	const actualProgramId = (programId ?? PROGRAM_ID) as Address;
	const actualRentReceiver = rentReceiver ?? authority;

	// Derive splitConfig address
	const { address: splitConfigAddress } = deriveSplitConfig(
		split.authority,
		split.mint,
		split.uniqueId,
	);

	return buildCloseSplitConfigRaw(
		actualProgramId,
		splitConfigAddress as Address,
		split.vault as Address,
		authority,
		actualRentReceiver,
		TOKEN_PROGRAM_ID as Address,
	);
}

// ============================================================================
// Raw instruction builders (low-level, protocol format)
// ============================================================================

function buildCreateSplitConfigRaw(
	programId: Address,
	ataProgramId: Address,
	authority: Address,
	mint: Address,
	uniqueId: Address,
	recipients: Array<{ address: string; percentageBps: number }>,
	tokenProgram: Address,
	payer: Address,
): KitInstruction {
	const { address: splitConfig } = deriveSplitConfig(authority, mint, uniqueId);
	const vault = deriveVault(splitConfig, mint, tokenProgram);

	// Serialize instruction data
	const dataSize =
		DISCRIMINATOR_SIZE +
		ADDRESS_SIZE +
		U32_SIZE +
		recipients.length * (ADDRESS_SIZE + U16_SIZE);

	const data = new Uint8Array(dataSize);
	let offset = 0;

	data.set(DISCRIMINATORS.createSplitConfig, offset);
	offset += DISCRIMINATOR_SIZE;

	data.set(decodeAddress(mint as string), offset);
	offset += ADDRESS_SIZE;

	new DataView(data.buffer).setUint32(offset, recipients.length, true);
	offset += U32_SIZE;

	for (const recipient of recipients) {
		data.set(decodeAddress(recipient.address), offset);
		offset += ADDRESS_SIZE;
		new DataView(data.buffer).setUint16(offset, recipient.percentageBps, true);
		offset += U16_SIZE;
	}

	const accounts = [
		{ address: splitConfig as Address, role: WRITABLE },
		{ address: authority, role: READONLY },
		{ address: vault as Address, role: WRITABLE },
		{ address: mint, role: READONLY },
		{ address: uniqueId, role: READONLY },
		{ address: tokenProgram, role: READONLY },
		{ address: ataProgramId, role: READONLY },
		{ address: SYSTEM_PROGRAM_ID as Address, role: READONLY },
		{ address: payer, role: WRITABLE_SIGNER },
	];

	return { programAddress: programId, accounts, data };
}

function buildExecuteSplitConfigRaw(
	programId: Address,
	splitConfig: Address,
	vault: Address,
	mint: Address,
	protocolConfig: Address,
	recipientAtas: Address[],
	protocolAta: Address,
	executor: Address,
	tokenProgram: Address,
): KitInstruction {
	const data = new Uint8Array(DISCRIMINATOR_SIZE);
	data.set(DISCRIMINATORS.executeSplit, 0);

	// Remaining accounts: recipient ATAs + protocol ATA (MUST be last)
	const remainingAccounts = [
		...recipientAtas.map((ata) => ({ address: ata, role: WRITABLE })),
		{ address: protocolAta, role: WRITABLE },
	];

	const accounts = [
		{ address: splitConfig, role: WRITABLE },
		{ address: vault, role: WRITABLE },
		{ address: mint, role: READONLY },
		{ address: protocolConfig, role: READONLY },
		{ address: executor, role: READONLY },
		{ address: tokenProgram, role: READONLY },
		...remainingAccounts,
	];

	return { programAddress: programId, accounts, data };
}

function buildUpdateSplitConfigRaw(
	programId: Address,
	splitConfig: Address,
	vault: Address,
	mint: Address,
	authority: Address,
	recipients: Array<{ address: string; percentageBps: number }>,
	tokenProgram: Address,
): KitInstruction {
	const dataSize =
		DISCRIMINATOR_SIZE +
		U32_SIZE +
		recipients.length * (ADDRESS_SIZE + U16_SIZE);

	const data = new Uint8Array(dataSize);
	let offset = 0;

	data.set(DISCRIMINATORS.updateSplitConfig, offset);
	offset += DISCRIMINATOR_SIZE;

	new DataView(data.buffer).setUint32(offset, recipients.length, true);
	offset += U32_SIZE;

	for (const recipient of recipients) {
		data.set(decodeAddress(recipient.address), offset);
		offset += ADDRESS_SIZE;
		new DataView(data.buffer).setUint16(offset, recipient.percentageBps, true);
		offset += U16_SIZE;
	}

	const accounts = [
		{ address: splitConfig, role: WRITABLE },
		{ address: vault, role: READONLY },
		{ address: mint, role: READONLY },
		{ address: authority, role: WRITABLE_SIGNER },
		{ address: tokenProgram, role: READONLY },
		...recipients.map((r) => ({
			address: deriveAta(
				r.address,
				mint as string,
				tokenProgram as string,
			) as Address,
			role: READONLY,
		})),
	];

	return { programAddress: programId, accounts, data };
}

function buildCloseSplitConfigRaw(
	programId: Address,
	splitConfig: Address,
	vault: Address,
	authority: Address,
	rentReceiver: Address,
	tokenProgram: Address,
): KitInstruction {
	const data = new Uint8Array(DISCRIMINATOR_SIZE);
	data.set(DISCRIMINATORS.closeSplitConfig, 0);

	const accounts = [
		{ address: splitConfig, role: WRITABLE },
		{ address: vault, role: WRITABLE },
		{ address: authority, role: WRITABLE_SIGNER },
		{ address: rentReceiver, role: WRITABLE },
		{ address: tokenProgram, role: READONLY },
	];

	return { programAddress: programId, accounts, data };
}

// ============================================================================
// Utilities
// ============================================================================

function generateRandomAddress(): Address {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return encodeAddress(bytes) as Address;
}
