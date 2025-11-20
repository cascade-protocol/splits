/**
 * Instruction builders for @solana/kit
 */

import {
	type Address,
	type Instruction,
	type AccountMeta,
	address,
	AccountRole,
	getAddressEncoder,
} from "@solana/kit";
import {
	PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	SYSTEM_PROGRAM_ID,
	MAX_RECIPIENTS,
	DISCRIMINATOR_SIZE,
	ADDRESS_SIZE,
	U16_SIZE,
	U32_SIZE,
	RECIPIENT_SIZE,
	type RecipientInput,
} from "./types";
import { DISCRIMINATORS } from "./discriminators";
import {
	deriveProtocolConfig,
	deriveProgramData,
	deriveSplitConfig,
	deriveVault,
	deriveAta,
} from "./pda";

const programAddress = address(PROGRAM_ID);
const ataProgramAddress = address(ASSOCIATED_TOKEN_PROGRAM_ID);
const systemProgramAddress = address(SYSTEM_PROGRAM_ID);
const addressEncoder = getAddressEncoder();

function encodeAddress(addr: Address): Uint8Array {
	return new Uint8Array(addressEncoder.encode(addr));
}

function validateRecipients(recipients: RecipientInput[]): void {
	if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
		throw new Error(`Recipient count must be between 1 and ${MAX_RECIPIENTS}`);
	}
	for (const r of recipients) {
		if (r.percentageBps <= 0) {
			throw new Error("Recipient percentage must be greater than 0");
		}
	}
}

export function buildInitializeProtocolInstruction(
	authority: Address,
	feeWallet: Address,
): Instruction {
	const { address: protocolConfig } = deriveProtocolConfig();
	const { address: programData } = deriveProgramData();

	const data = new Uint8Array(DISCRIMINATOR_SIZE + ADDRESS_SIZE);
	data.set(DISCRIMINATORS.initializeProtocol, 0);
	data.set(encodeAddress(feeWallet), DISCRIMINATOR_SIZE);

	return {
		programAddress,
		accounts: [
			{ address: address(protocolConfig), role: AccountRole.WRITABLE },
			{ address: authority, role: AccountRole.WRITABLE_SIGNER },
			{ address: address(programData), role: AccountRole.READONLY },
			{ address: systemProgramAddress, role: AccountRole.READONLY },
		],
		data,
	};
}

export function buildUpdateProtocolConfigInstruction(
	authority: Address,
	newFeeWallet: Address,
): Instruction {
	const { address: protocolConfig } = deriveProtocolConfig();

	const data = new Uint8Array(DISCRIMINATOR_SIZE + ADDRESS_SIZE);
	data.set(DISCRIMINATORS.updateProtocolConfig, 0);
	data.set(encodeAddress(newFeeWallet), DISCRIMINATOR_SIZE);

	return {
		programAddress,
		accounts: [
			{ address: address(protocolConfig), role: AccountRole.WRITABLE },
			{ address: authority, role: AccountRole.READONLY_SIGNER },
		],
		data,
	};
}

export function buildTransferProtocolAuthorityInstruction(
	authority: Address,
	newAuthority: Address,
): Instruction {
	const { address: protocolConfig } = deriveProtocolConfig();

	const data = new Uint8Array(DISCRIMINATOR_SIZE + ADDRESS_SIZE);
	data.set(DISCRIMINATORS.transferProtocolAuthority, 0);
	data.set(encodeAddress(newAuthority), DISCRIMINATOR_SIZE);

	return {
		programAddress,
		accounts: [
			{ address: address(protocolConfig), role: AccountRole.WRITABLE },
			{ address: authority, role: AccountRole.READONLY_SIGNER },
		],
		data,
	};
}

export function buildAcceptProtocolAuthorityInstruction(
	newAuthority: Address,
): Instruction {
	const { address: protocolConfig } = deriveProtocolConfig();

	return {
		programAddress,
		accounts: [
			{ address: address(protocolConfig), role: AccountRole.WRITABLE },
			{ address: newAuthority, role: AccountRole.READONLY_SIGNER },
		],
		data: DISCRIMINATORS.acceptProtocolAuthority,
	};
}

export function buildCreateSplitConfigInstruction(
	authority: Address,
	mint: Address,
	uniqueId: Address,
	recipients: RecipientInput[],
	tokenProgram: Address = address(TOKEN_PROGRAM_ID),
	payer?: Address,
): Instruction {
	validateRecipients(recipients);

	// If no payer provided, default to authority
	const actualPayer = payer ?? authority;

	const authorityStr = authority as string;
	const mintStr = mint as string;
	const uniqueIdStr = uniqueId as string;
	const tokenProgramStr = tokenProgram as string;

	const { address: splitConfig } = deriveSplitConfig(
		authorityStr,
		mintStr,
		uniqueIdStr,
	);
	const vault = deriveVault(splitConfig, mintStr, tokenProgramStr);

	const dataSize =
		DISCRIMINATOR_SIZE +
		ADDRESS_SIZE +
		U32_SIZE +
		recipients.length * RECIPIENT_SIZE;
	const data = new Uint8Array(dataSize);
	const view = new DataView(data.buffer);
	let offset = 0;

	data.set(DISCRIMINATORS.createSplitConfig, offset);
	offset += DISCRIMINATOR_SIZE;

	data.set(encodeAddress(mint), offset);
	offset += ADDRESS_SIZE;

	view.setUint32(offset, recipients.length, true);
	offset += U32_SIZE;

	for (const recipient of recipients) {
		data.set(encodeAddress(address(recipient.address)), offset);
		offset += ADDRESS_SIZE;
		view.setUint16(offset, recipient.percentageBps, true);
		offset += U16_SIZE;
	}

	const accounts: AccountMeta[] = [
		{ address: address(splitConfig), role: AccountRole.WRITABLE },
		{ address: uniqueId, role: AccountRole.READONLY },
		{ address: authority, role: AccountRole.READONLY_SIGNER },
		{ address: actualPayer, role: AccountRole.WRITABLE_SIGNER },
		{ address: mint, role: AccountRole.READONLY },
		{ address: address(vault), role: AccountRole.WRITABLE },
		{ address: tokenProgram, role: AccountRole.READONLY },
		{ address: ataProgramAddress, role: AccountRole.READONLY },
		{ address: systemProgramAddress, role: AccountRole.READONLY },
		...recipients.map((r) => ({
			address: address(deriveAta(r.address, mintStr, tokenProgramStr)),
			role: AccountRole.READONLY,
		})),
	];

	return { programAddress, accounts, data };
}

export function buildExecuteSplitInstruction(
	splitConfig: Address,
	vault: Address,
	mint: Address,
	executor: Address,
	recipientAtas: Address[],
	protocolAta: Address,
	tokenProgram: Address = address(TOKEN_PROGRAM_ID),
): Instruction {
	const { address: protocolConfig } = deriveProtocolConfig();

	const accounts: AccountMeta[] = [
		{ address: splitConfig, role: AccountRole.WRITABLE },
		{ address: vault, role: AccountRole.WRITABLE },
		{ address: mint, role: AccountRole.READONLY },
		{ address: address(protocolConfig), role: AccountRole.READONLY },
		{ address: executor, role: AccountRole.READONLY },
		{ address: tokenProgram, role: AccountRole.READONLY },
		...recipientAtas.map((ata) => ({
			address: ata,
			role: AccountRole.WRITABLE,
		})),
		{ address: protocolAta, role: AccountRole.WRITABLE },
	];

	return {
		programAddress,
		accounts,
		data: DISCRIMINATORS.executeSplit,
	};
}

export function buildUpdateSplitConfigInstruction(
	splitConfig: Address,
	vault: Address,
	mint: Address,
	authority: Address,
	newRecipients: RecipientInput[],
	tokenProgram: Address = address(TOKEN_PROGRAM_ID),
): Instruction {
	validateRecipients(newRecipients);

	const mintStr = mint as string;
	const tokenProgramStr = tokenProgram as string;

	const dataSize =
		DISCRIMINATOR_SIZE + U32_SIZE + newRecipients.length * RECIPIENT_SIZE;
	const data = new Uint8Array(dataSize);
	const view = new DataView(data.buffer);
	let offset = 0;

	data.set(DISCRIMINATORS.updateSplitConfig, offset);
	offset += DISCRIMINATOR_SIZE;

	view.setUint32(offset, newRecipients.length, true);
	offset += U32_SIZE;

	for (const recipient of newRecipients) {
		data.set(encodeAddress(address(recipient.address)), offset);
		offset += ADDRESS_SIZE;
		view.setUint16(offset, recipient.percentageBps, true);
		offset += U16_SIZE;
	}

	const accounts: AccountMeta[] = [
		{ address: splitConfig, role: AccountRole.WRITABLE },
		{ address: vault, role: AccountRole.READONLY },
		{ address: mint, role: AccountRole.READONLY },
		{ address: authority, role: AccountRole.READONLY_SIGNER },
		{ address: tokenProgram, role: AccountRole.READONLY },
		...newRecipients.map((r) => ({
			address: address(deriveAta(r.address, mintStr, tokenProgramStr)),
			role: AccountRole.READONLY,
		})),
	];

	return { programAddress, accounts, data };
}

export function buildCloseSplitConfigInstruction(
	splitConfig: Address,
	vault: Address,
	authority: Address,
	rentDestination: Address,
): Instruction {
	return {
		programAddress,
		accounts: [
			{ address: splitConfig, role: AccountRole.WRITABLE },
			{ address: vault, role: AccountRole.READONLY },
			{ address: authority, role: AccountRole.READONLY_SIGNER },
			{ address: rentDestination, role: AccountRole.WRITABLE },
		],
		data: DISCRIMINATORS.closeSplitConfig,
	};
}
