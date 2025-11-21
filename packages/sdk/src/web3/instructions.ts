/**
 * Low-level instruction builders for @solana/web3.js
 * These work with protocol format (basis points)
 */

import {
	PublicKey,
	type TransactionInstruction,
	TransactionInstruction as TxInstruction,
	SystemProgram,
} from "@solana/web3.js";
import {
	DISCRIMINATOR_SIZE,
	ADDRESS_SIZE,
	U16_SIZE,
	U32_SIZE,
	RECIPIENT_SIZE,
} from "../core/constants.js";
import { DISCRIMINATORS } from "../discriminators.js";
import type { ProtocolRecipient } from "../core/business-logic.js";
import {
	deriveProtocolConfig,
	deriveSplitConfig,
	deriveVault,
	deriveAta,
} from "../pda.js";

/**
 * Build create split config instruction (internal - uses basis points)
 */
export function buildCreateSplitConfigInstruction(
	programId: PublicKey,
	ataProgramId: PublicKey,
	authority: PublicKey,
	mint: PublicKey,
	uniqueId: PublicKey,
	recipients: ProtocolRecipient[],
	tokenProgram: PublicKey,
	payer: PublicKey,
): TransactionInstruction {
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

	// Serialize instruction data
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

	// Build account keys
	const keys = [
		{
			pubkey: new PublicKey(splitConfig),
			isSigner: false,
			isWritable: true,
		},
		{ pubkey: uniqueId, isSigner: false, isWritable: false },
		{ pubkey: authority, isSigner: true, isWritable: false },
		{ pubkey: payer, isSigner: true, isWritable: true },
		{ pubkey: mint, isSigner: false, isWritable: false },
		{
			pubkey: new PublicKey(vault),
			isSigner: false,
			isWritable: true,
		},
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

	return new TxInstruction({ programId, keys, data });
}

/**
 * Build execute split instruction (internal)
 */
export function buildExecuteSplitInstruction(
	programId: PublicKey,
	splitConfig: PublicKey,
	vault: PublicKey,
	mint: PublicKey,
	executor: PublicKey,
	recipientAtas: PublicKey[],
	protocolAta: PublicKey,
	tokenProgram: PublicKey,
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

	return new TxInstruction({
		programId,
		keys,
		data: Buffer.from(DISCRIMINATORS.executeSplit),
	});
}

/**
 * Build update split config instruction (internal - uses basis points)
 */
export function buildUpdateSplitConfigInstruction(
	programId: PublicKey,
	splitConfig: PublicKey,
	vault: PublicKey,
	mint: PublicKey,
	authority: PublicKey,
	newRecipients: ProtocolRecipient[],
	tokenProgram: PublicKey,
): TransactionInstruction {
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

	return new TxInstruction({ programId, keys, data });
}

/**
 * Build close split config instruction (internal)
 */
export function buildCloseSplitConfigInstruction(
	programId: PublicKey,
	splitConfig: PublicKey,
	vault: PublicKey,
	authority: PublicKey,
	rentReceiver: PublicKey,
	tokenProgram: PublicKey,
): TransactionInstruction {
	const keys = [
		{ pubkey: splitConfig, isSigner: false, isWritable: true },
		{ pubkey: vault, isSigner: false, isWritable: true },
		{ pubkey: authority, isSigner: true, isWritable: false },
		{ pubkey: rentReceiver, isSigner: false, isWritable: true },
		{ pubkey: tokenProgram, isSigner: false, isWritable: false },
	];

	return new TxInstruction({
		programId,
		keys,
		data: Buffer.from(DISCRIMINATORS.closeSplitConfig),
	});
}
