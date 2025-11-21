/**
 * Tests for instruction serialization
 * Validates that SDK generates correct instruction bytes matching the protocol
 */

import { describe, it, expect } from "vitest";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
	buildCreateSplitConfigInstruction,
	buildExecuteSplitInstruction,
	buildUpdateSplitConfigInstruction,
	buildCloseSplitConfigInstruction,
} from "../src/web3/instructions.js";
import {
	PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	SYSTEM_PROGRAM_ID,
} from "../src/core/constants.js";
import { DISCRIMINATORS } from "../src/discriminators.js";
import { deriveSplitConfig, deriveVault, deriveAta, deriveProtocolConfig } from "../src/pda.js";

describe("Instruction Serialization", () => {
	const programId = new PublicKey(PROGRAM_ID);
	const ataProgramId = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
	const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
	const systemProgram = new PublicKey(SYSTEM_PROGRAM_ID);

	describe("createSplitConfig", () => {
		it("serializes instruction data correctly", () => {
			const authority = Keypair.generate().publicKey;
			const mint = Keypair.generate().publicKey;
			const uniqueId = Keypair.generate().publicKey;
			const payer = authority;

			const recipients = [
				{
					address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
					percentageBps: 5940, // 60%
				},
				{
					address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
					percentageBps: 3960, // 40%
				},
			];

			const ix = buildCreateSplitConfigInstruction(
				programId,
				ataProgramId,
				authority,
				mint,
				uniqueId,
				recipients,
				tokenProgram,
				payer,
			);

			// Verify discriminator (first 8 bytes)
			expect(ix.data.subarray(0, 8)).toEqual(
				Buffer.from(DISCRIMINATORS.createSplitConfig),
			);

			// Verify mint (next 32 bytes)
			expect(ix.data.subarray(8, 40)).toEqual(mint.toBuffer());

			// Verify recipient count (u32 LE)
			const recipientCount = ix.data.readUInt32LE(40);
			expect(recipientCount).toBe(2);

			// Verify first recipient
			const recipient1Address = new PublicKey(ix.data.subarray(44, 76));
			expect(recipient1Address.toBase58()).toBe(recipients[0]?.address);
			const recipient1Bps = ix.data.readUInt16LE(76);
			expect(recipient1Bps).toBe(5940);

			// Verify second recipient
			const recipient2Address = new PublicKey(ix.data.subarray(78, 110));
			expect(recipient2Address.toBase58()).toBe(recipients[1]?.address);
			const recipient2Bps = ix.data.readUInt16LE(110);
			expect(recipient2Bps).toBe(3960);
		});

		it("includes correct accounts in correct order", () => {
			const authority = Keypair.generate().publicKey;
			const mint = Keypair.generate().publicKey;
			const uniqueId = Keypair.generate().publicKey;
			const payer = authority;

			const recipients = [
				{
					address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
					percentageBps: 5940,
				},
			];

			const ix = buildCreateSplitConfigInstruction(
				programId,
				ataProgramId,
				authority,
				mint,
				uniqueId,
				recipients,
				tokenProgram,
				payer,
			);

			// Derive expected addresses
			const { address: splitConfig } = deriveSplitConfig(
				authority.toBase58(),
				mint.toBase58(),
				uniqueId.toBase58(),
			);
			const vault = deriveVault(splitConfig, mint.toBase58(), tokenProgram.toBase58());
			const recipientAta = deriveAta(recipients[0]!.address, mint.toBase58(), tokenProgram.toBase58());

			// Verify account order
			expect(ix.keys.length).toBe(10); // 9 base + 1 recipient ATA
			expect(ix.keys[0]?.pubkey.toBase58()).toBe(splitConfig);
			expect(ix.keys[1]?.pubkey.toBase58()).toBe(uniqueId.toBase58());
			expect(ix.keys[2]?.pubkey.toBase58()).toBe(authority.toBase58());
			expect(ix.keys[3]?.pubkey.toBase58()).toBe(payer.toBase58());
			expect(ix.keys[4]?.pubkey.toBase58()).toBe(mint.toBase58());
			expect(ix.keys[5]?.pubkey.toBase58()).toBe(vault);
			expect(ix.keys[6]?.pubkey.toBase58()).toBe(tokenProgram.toBase58());
			expect(ix.keys[7]?.pubkey.toBase58()).toBe(ataProgramId.toBase58());
			expect(ix.keys[8]?.pubkey.toBase58()).toBe(systemProgram.toBase58());
			expect(ix.keys[9]?.pubkey.toBase58()).toBe(recipientAta);
		});
	});

	describe("executeSplit", () => {
		it("serializes instruction data correctly", () => {
			const splitConfig = Keypair.generate().publicKey;
			const vault = Keypair.generate().publicKey;
			const mint = Keypair.generate().publicKey;
			const executor = Keypair.generate().publicKey;
			const recipientAta1 = Keypair.generate().publicKey;
			const recipientAta2 = Keypair.generate().publicKey;
			const protocolAta = Keypair.generate().publicKey;

			const ix = buildExecuteSplitInstruction(
				programId,
				splitConfig,
				vault,
				mint,
				executor,
				[recipientAta1, recipientAta2],
				protocolAta,
				tokenProgram,
			);

			// Execute split has only discriminator (no additional data)
			expect(ix.data.length).toBe(8);
			expect(ix.data).toEqual(Buffer.from(DISCRIMINATORS.executeSplit));
		});

		it("includes correct accounts in correct order", () => {
			const splitConfig = Keypair.generate().publicKey;
			const vault = Keypair.generate().publicKey;
			const mint = Keypair.generate().publicKey;
			const executor = Keypair.generate().publicKey;
			const recipientAta1 = Keypair.generate().publicKey;
			const recipientAta2 = Keypair.generate().publicKey;
			const protocolAta = Keypair.generate().publicKey;

			const ix = buildExecuteSplitInstruction(
				programId,
				splitConfig,
				vault,
				mint,
				executor,
				[recipientAta1, recipientAta2],
				protocolAta,
				tokenProgram,
			);

			const { address: protocolConfigAddr } = deriveProtocolConfig();

			// Verify account order: splitConfig, vault, mint, protocolConfig, executor, tokenProgram, recipientAtas[], protocolAta
			expect(ix.keys.length).toBe(9); // 6 base + 2 recipient ATAs + 1 protocol ATA
			expect(ix.keys[0]?.pubkey.toBase58()).toBe(splitConfig.toBase58());
			expect(ix.keys[1]?.pubkey.toBase58()).toBe(vault.toBase58());
			expect(ix.keys[2]?.pubkey.toBase58()).toBe(mint.toBase58());
			expect(ix.keys[3]?.pubkey.toBase58()).toBe(protocolConfigAddr);
			expect(ix.keys[4]?.pubkey.toBase58()).toBe(executor.toBase58());
			expect(ix.keys[5]?.pubkey.toBase58()).toBe(tokenProgram.toBase58());
			expect(ix.keys[6]?.pubkey.toBase58()).toBe(recipientAta1.toBase58());
			expect(ix.keys[7]?.pubkey.toBase58()).toBe(recipientAta2.toBase58());
			expect(ix.keys[8]?.pubkey.toBase58()).toBe(protocolAta.toBase58()); // MUST be last
		});
	});

	describe("updateSplitConfig", () => {
		it("serializes instruction data correctly", () => {
			const splitConfig = Keypair.generate().publicKey;
			const vault = Keypair.generate().publicKey;
			const mint = Keypair.generate().publicKey;
			const authority = Keypair.generate().publicKey;

			const newRecipients = [
				{
					address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
					percentageBps: 6930, // 70%
				},
				{
					address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
					percentageBps: 2970, // 30%
				},
			];

			const ix = buildUpdateSplitConfigInstruction(
				programId,
				splitConfig,
				vault,
				mint,
				authority,
				newRecipients,
				tokenProgram,
			);

			// Verify discriminator (first 8 bytes)
			expect(ix.data.subarray(0, 8)).toEqual(
				Buffer.from(DISCRIMINATORS.updateSplitConfig),
			);

			// Verify recipient count (u32 LE)
			const recipientCount = ix.data.readUInt32LE(8);
			expect(recipientCount).toBe(2);

			// Verify recipients
			const recipient1Address = new PublicKey(ix.data.subarray(12, 44));
			expect(recipient1Address.toBase58()).toBe(newRecipients[0]?.address);
			const recipient1Bps = ix.data.readUInt16LE(44);
			expect(recipient1Bps).toBe(6930);

			const recipient2Address = new PublicKey(ix.data.subarray(46, 78));
			expect(recipient2Address.toBase58()).toBe(newRecipients[1]?.address);
			const recipient2Bps = ix.data.readUInt16LE(78);
			expect(recipient2Bps).toBe(2970);
		});

		it("includes correct accounts in correct order", () => {
			const splitConfig = Keypair.generate().publicKey;
			const vault = Keypair.generate().publicKey;
			const mint = Keypair.generate().publicKey;
			const authority = Keypair.generate().publicKey;

			const newRecipients = [
				{
					address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
					percentageBps: 6930,
				},
			];

			const ix = buildUpdateSplitConfigInstruction(
				programId,
				splitConfig,
				vault,
				mint,
				authority,
				newRecipients,
				tokenProgram,
			);

			const recipientAta = deriveAta(newRecipients[0]!.address, mint.toBase58(), tokenProgram.toBase58());

			// Verify account order
			expect(ix.keys.length).toBe(6); // 5 base + 1 recipient ATA
			expect(ix.keys[0]?.pubkey.toBase58()).toBe(splitConfig.toBase58());
			expect(ix.keys[1]?.pubkey.toBase58()).toBe(vault.toBase58());
			expect(ix.keys[2]?.pubkey.toBase58()).toBe(mint.toBase58());
			expect(ix.keys[3]?.pubkey.toBase58()).toBe(authority.toBase58());
			expect(ix.keys[4]?.pubkey.toBase58()).toBe(tokenProgram.toBase58());
			expect(ix.keys[5]?.pubkey.toBase58()).toBe(recipientAta);
		});
	});

	describe("closeSplitConfig", () => {
		it("serializes instruction data correctly", () => {
			const splitConfig = Keypair.generate().publicKey;
			const vault = Keypair.generate().publicKey;
			const authority = Keypair.generate().publicKey;
			const rentReceiver = Keypair.generate().publicKey;

			const ix = buildCloseSplitConfigInstruction(
				programId,
				splitConfig,
				vault,
				authority,
				rentReceiver,
				tokenProgram,
			);

			// Close split has only discriminator (no additional data)
			expect(ix.data.length).toBe(8);
			expect(ix.data).toEqual(Buffer.from(DISCRIMINATORS.closeSplitConfig));
		});

		it("includes correct accounts in correct order", () => {
			const splitConfig = Keypair.generate().publicKey;
			const vault = Keypair.generate().publicKey;
			const authority = Keypair.generate().publicKey;
			const rentReceiver = Keypair.generate().publicKey;

			const ix = buildCloseSplitConfigInstruction(
				programId,
				splitConfig,
				vault,
				authority,
				rentReceiver,
				tokenProgram,
			);

			// Verify account order
			expect(ix.keys.length).toBe(5);
			expect(ix.keys[0]?.pubkey.toBase58()).toBe(splitConfig.toBase58());
			expect(ix.keys[1]?.pubkey.toBase58()).toBe(vault.toBase58());
			expect(ix.keys[2]?.pubkey.toBase58()).toBe(authority.toBase58());
			expect(ix.keys[3]?.pubkey.toBase58()).toBe(rentReceiver.toBase58());
			expect(ix.keys[4]?.pubkey.toBase58()).toBe(tokenProgram.toBase58());
		});
	});
});
