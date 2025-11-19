/**
 * Instruction builders for @solana/web3.js / @coral-xyz/anchor
 */

import {
	PublicKey,
	TransactionInstruction,
	SystemProgram,
} from "@solana/web3.js";
import {
	PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
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

const programId = new PublicKey(PROGRAM_ID);
const ataProgramId = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);

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
	authority: PublicKey,
	feeWallet: PublicKey,
): TransactionInstruction {
	const { address: protocolConfig } = deriveProtocolConfig();
	const { address: programData } = deriveProgramData();

	const data = Buffer.alloc(DISCRIMINATOR_SIZE + ADDRESS_SIZE);
	data.set(DISCRIMINATORS.initializeProtocol, 0);
	feeWallet.toBuffer().copy(data, DISCRIMINATOR_SIZE);

	return new TransactionInstruction({
		programId,
		keys: [
			{
				pubkey: new PublicKey(protocolConfig),
				isSigner: false,
				isWritable: true,
			},
			{ pubkey: authority, isSigner: true, isWritable: true },
			{
				pubkey: new PublicKey(programData),
				isSigner: false,
				isWritable: false,
			},
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data,
	});
}

export function buildUpdateProtocolConfigInstruction(
	authority: PublicKey,
	newFeeWallet: PublicKey,
): TransactionInstruction {
	const { address: protocolConfig } = deriveProtocolConfig();

	const data = Buffer.alloc(DISCRIMINATOR_SIZE + ADDRESS_SIZE);
	data.set(DISCRIMINATORS.updateProtocolConfig, 0);
	newFeeWallet.toBuffer().copy(data, DISCRIMINATOR_SIZE);

	return new TransactionInstruction({
		programId,
		keys: [
			{
				pubkey: new PublicKey(protocolConfig),
				isSigner: false,
				isWritable: true,
			},
			{ pubkey: authority, isSigner: true, isWritable: false },
		],
		data,
	});
}

export function buildTransferProtocolAuthorityInstruction(
	authority: PublicKey,
	newAuthority: PublicKey,
): TransactionInstruction {
	const { address: protocolConfig } = deriveProtocolConfig();

	const data = Buffer.alloc(DISCRIMINATOR_SIZE + ADDRESS_SIZE);
	data.set(DISCRIMINATORS.transferProtocolAuthority, 0);
	newAuthority.toBuffer().copy(data, DISCRIMINATOR_SIZE);

	return new TransactionInstruction({
		programId,
		keys: [
			{
				pubkey: new PublicKey(protocolConfig),
				isSigner: false,
				isWritable: true,
			},
			{ pubkey: authority, isSigner: true, isWritable: false },
		],
		data,
	});
}

export function buildAcceptProtocolAuthorityInstruction(
	newAuthority: PublicKey,
): TransactionInstruction {
	const { address: protocolConfig } = deriveProtocolConfig();

	return new TransactionInstruction({
		programId,
		keys: [
			{
				pubkey: new PublicKey(protocolConfig),
				isSigner: false,
				isWritable: true,
			},
			{ pubkey: newAuthority, isSigner: true, isWritable: false },
		],
		data: Buffer.from(DISCRIMINATORS.acceptProtocolAuthority),
	});
}

export function buildCreateSplitConfigInstruction(
	authority: PublicKey,
	mint: PublicKey,
	uniqueId: PublicKey,
	recipients: RecipientInput[],
	tokenProgram: PublicKey = new PublicKey(TOKEN_PROGRAM_ID),
): TransactionInstruction {
	validateRecipients(recipients);

	const { address: splitConfig } = deriveSplitConfig(
		authority.toBase58(),
		mint.toBase58(),
		uniqueId.toBase58(),
	);
	const vault = deriveVault(
		splitConfig,
		mint.toBase58(),
		tokenProgram.toBase58(),
	);

	const dataSize =
		DISCRIMINATOR_SIZE +
		ADDRESS_SIZE +
		U32_SIZE +
		recipients.length * RECIPIENT_SIZE;
	const data = Buffer.alloc(dataSize);
	let offset = 0;

	data.set(DISCRIMINATORS.createSplitConfig, offset);
	offset += DISCRIMINATOR_SIZE;

	mint.toBuffer().copy(data, offset);
	offset += ADDRESS_SIZE;

	data.writeUInt32LE(recipients.length, offset);
	offset += U32_SIZE;

	for (const recipient of recipients) {
		new PublicKey(recipient.address).toBuffer().copy(data, offset);
		offset += ADDRESS_SIZE;
		data.writeUInt16LE(recipient.percentageBps, offset);
		offset += U16_SIZE;
	}

	const keys = [
		{ pubkey: new PublicKey(splitConfig), isSigner: false, isWritable: true },
		{ pubkey: uniqueId, isSigner: false, isWritable: false },
		{ pubkey: authority, isSigner: true, isWritable: true },
		{ pubkey: mint, isSigner: false, isWritable: false },
		{ pubkey: new PublicKey(vault), isSigner: false, isWritable: true },
		{ pubkey: tokenProgram, isSigner: false, isWritable: false },
		{ pubkey: ataProgramId, isSigner: false, isWritable: false },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		...recipients.map((r) => ({
			pubkey: new PublicKey(
				deriveAta(r.address, mint.toBase58(), tokenProgram.toBase58()),
			),
			isSigner: false,
			isWritable: false,
		})),
	];

	return new TransactionInstruction({ programId, keys, data });
}

export function buildExecuteSplitInstruction(
	splitConfig: PublicKey,
	vault: PublicKey,
	mint: PublicKey,
	executor: PublicKey,
	recipientAtas: PublicKey[],
	protocolAta: PublicKey,
	tokenProgram: PublicKey = new PublicKey(TOKEN_PROGRAM_ID),
): TransactionInstruction {
	const { address: protocolConfig } = deriveProtocolConfig();

	const keys = [
		{ pubkey: splitConfig, isSigner: false, isWritable: true },
		{ pubkey: vault, isSigner: false, isWritable: true },
		{ pubkey: mint, isSigner: false, isWritable: false },
		{
			pubkey: new PublicKey(protocolConfig),
			isSigner: false,
			isWritable: false,
		},
		{ pubkey: executor, isSigner: false, isWritable: false },
		{ pubkey: tokenProgram, isSigner: false, isWritable: false },
		...recipientAtas.map((ata) => ({
			pubkey: ata,
			isSigner: false,
			isWritable: true,
		})),
		{ pubkey: protocolAta, isSigner: false, isWritable: true },
	];

	return new TransactionInstruction({
		programId,
		keys,
		data: Buffer.from(DISCRIMINATORS.executeSplit),
	});
}

export function buildUpdateSplitConfigInstruction(
	splitConfig: PublicKey,
	vault: PublicKey,
	mint: PublicKey,
	authority: PublicKey,
	newRecipients: RecipientInput[],
	tokenProgram: PublicKey = new PublicKey(TOKEN_PROGRAM_ID),
): TransactionInstruction {
	validateRecipients(newRecipients);

	const dataSize =
		DISCRIMINATOR_SIZE + U32_SIZE + newRecipients.length * RECIPIENT_SIZE;
	const data = Buffer.alloc(dataSize);
	let offset = 0;

	data.set(DISCRIMINATORS.updateSplitConfig, offset);
	offset += DISCRIMINATOR_SIZE;

	data.writeUInt32LE(newRecipients.length, offset);
	offset += U32_SIZE;

	for (const recipient of newRecipients) {
		new PublicKey(recipient.address).toBuffer().copy(data, offset);
		offset += ADDRESS_SIZE;
		data.writeUInt16LE(recipient.percentageBps, offset);
		offset += U16_SIZE;
	}

	const keys = [
		{ pubkey: splitConfig, isSigner: false, isWritable: true },
		{ pubkey: vault, isSigner: false, isWritable: false },
		{ pubkey: mint, isSigner: false, isWritable: false },
		{ pubkey: authority, isSigner: true, isWritable: false },
		{ pubkey: tokenProgram, isSigner: false, isWritable: false },
		...newRecipients.map((r) => ({
			pubkey: new PublicKey(
				deriveAta(r.address, mint.toBase58(), tokenProgram.toBase58()),
			),
			isSigner: false,
			isWritable: false,
		})),
	];

	return new TransactionInstruction({ programId, keys, data });
}

export function buildCloseSplitConfigInstruction(
	splitConfig: PublicKey,
	vault: PublicKey,
	authority: PublicKey,
	tokenProgram: PublicKey = new PublicKey(TOKEN_PROGRAM_ID),
): TransactionInstruction {
	return new TransactionInstruction({
		programId,
		keys: [
			{ pubkey: splitConfig, isSigner: false, isWritable: true },
			{ pubkey: vault, isSigner: false, isWritable: true },
			{ pubkey: authority, isSigner: true, isWritable: true },
			{ pubkey: tokenProgram, isSigner: false, isWritable: false },
		],
		data: Buffer.from(DISCRIMINATORS.closeSplitConfig),
	});
}
