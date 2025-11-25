/**
 * Test fixtures for SDK tests
 * Provides mock buffer builders that match Rust #[repr(C)] struct layouts
 */

import { Keypair } from "@solana/web3.js";
import { ACCOUNT_DISCRIMINATORS } from "../src/discriminators.js";

// Constants matching Rust layout
const MAX_RECIPIENTS = 20;
const PROTOCOL_CONFIG_SIZE = 105;
const SPLIT_CONFIG_SIZE = 1832;

// Struct component sizes
const DISCRIMINATOR_SIZE = 8;
const PUBKEY_SIZE = 32;
const U8_SIZE = 1;
const U16_SIZE = 2;
const U64_SIZE = 8;
const I64_SIZE = 8;

// Recipient: address(32) + percentage_bps(2) = 34 bytes
const RECIPIENT_SIZE = PUBKEY_SIZE + U16_SIZE;

// UnclaimedAmount: recipient(32) + amount(8) + timestamp(8) = 48 bytes
const UNCLAIMED_AMOUNT_SIZE = PUBKEY_SIZE + U64_SIZE + I64_SIZE;

/**
 * Well-known test pubkeys (deterministic for reproducible tests)
 */
export const TEST_PUBKEYS = {
	authority: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
	pendingAuthority: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
	feeWallet: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
	mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
	vault: "4rZoSK8u7XR6NGMvKdSdtR9JZFQ8KfGqGfBYVg6tVCYr",
	uniqueId: "3XXuUFfweXBwFgFfYaejLvZE4cGZiHgKiGfMtdxNzYmv",
	rentPayer: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
	recipient1: "Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD",
	recipient2: "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgscAFW9kKG2",
} as const;

/**
 * Decode a base58 pubkey string to bytes
 */
function pubkeyToBytes(pubkey: string): Uint8Array {
	// Use @solana/web3.js for proper base58 decoding
	const pk = new (require("@solana/web3.js").PublicKey)(pubkey);
	return pk.toBytes();
}

/**
 * Options for creating a mock ProtocolConfig buffer
 */
export interface MockProtocolConfigOptions {
	authority?: string;
	pendingAuthority?: string;
	feeWallet?: string;
	bump?: number;
}

/**
 * Create a mock ProtocolConfig buffer (105 bytes)
 *
 * Layout:
 * - discriminator: 8 bytes
 * - authority: 32 bytes (Pubkey)
 * - pending_authority: 32 bytes (Pubkey)
 * - fee_wallet: 32 bytes (Pubkey)
 * - bump: 1 byte (u8)
 */
export function createMockProtocolConfigBuffer(
	options: MockProtocolConfigOptions = {},
): Buffer {
	const {
		authority = TEST_PUBKEYS.authority,
		pendingAuthority = TEST_PUBKEYS.pendingAuthority,
		feeWallet = TEST_PUBKEYS.feeWallet,
		bump = 255,
	} = options;

	const buffer = Buffer.alloc(PROTOCOL_CONFIG_SIZE);
	let offset = 0;

	// Discriminator (8 bytes)
	buffer.set(ACCOUNT_DISCRIMINATORS.protocolConfig, offset);
	offset += DISCRIMINATOR_SIZE;

	// Authority (32 bytes)
	buffer.set(pubkeyToBytes(authority), offset);
	offset += PUBKEY_SIZE;

	// Pending authority (32 bytes)
	buffer.set(pubkeyToBytes(pendingAuthority), offset);
	offset += PUBKEY_SIZE;

	// Fee wallet (32 bytes)
	buffer.set(pubkeyToBytes(feeWallet), offset);
	offset += PUBKEY_SIZE;

	// Bump (1 byte)
	buffer.writeUInt8(bump, offset);

	return buffer;
}

/**
 * Options for creating a mock SplitConfig buffer
 */
export interface MockSplitConfigOptions {
	version?: number;
	authority?: string;
	mint?: string;
	vault?: string;
	uniqueId?: string;
	bump?: number;
	recipients?: Array<{ address: string; percentageBps: number }>;
	unclaimedAmounts?: Array<{
		recipient: string;
		amount: bigint;
		timestamp: bigint;
	}>;
	protocolUnclaimed?: bigint;
	lastActivity?: bigint;
	rentPayer?: string;
}

/**
 * Create a mock SplitConfig buffer (1832 bytes)
 *
 * Layout (with #[repr(C)] padding):
 * - discriminator: 8 bytes
 * - version: 1 byte (u8)
 * - authority: 32 bytes (Pubkey)
 * - mint: 32 bytes (Pubkey)
 * - vault: 32 bytes (Pubkey)
 * - unique_id: 32 bytes (Pubkey)
 * - bump: 1 byte (u8)
 * - recipient_count: 1 byte (u8)
 * - PADDING: 1 byte (for 2-byte alignment)
 * - recipients: [Recipient; 20] = 680 bytes (each: address(32) + percentage_bps(2) = 34)
 * - PADDING: 4 bytes (for 8-byte alignment)
 * - unclaimed_amounts: [UnclaimedAmount; 20] = 960 bytes (each: recipient(32) + amount(8) + timestamp(8) = 48)
 * - protocol_unclaimed: 8 bytes (u64)
 * - last_activity: 8 bytes (i64)
 * - rent_payer: 32 bytes (Pubkey)
 */
export function createMockSplitConfigBuffer(
	options: MockSplitConfigOptions = {},
): Buffer {
	const {
		version = 1,
		authority = TEST_PUBKEYS.authority,
		mint = TEST_PUBKEYS.mint,
		vault = TEST_PUBKEYS.vault,
		uniqueId = TEST_PUBKEYS.uniqueId,
		bump = 254,
		recipients = [
			{ address: TEST_PUBKEYS.recipient1, percentageBps: 5940 },
			{ address: TEST_PUBKEYS.recipient2, percentageBps: 3960 },
		],
		unclaimedAmounts = [],
		protocolUnclaimed = 0n,
		lastActivity = BigInt(Date.now()),
		rentPayer = TEST_PUBKEYS.rentPayer,
	} = options;

	if (recipients.length > MAX_RECIPIENTS) {
		throw new Error(
			`Too many recipients: ${recipients.length} > ${MAX_RECIPIENTS}`,
		);
	}

	const buffer = Buffer.alloc(SPLIT_CONFIG_SIZE);
	let offset = 0;

	// Discriminator (8 bytes)
	buffer.set(ACCOUNT_DISCRIMINATORS.splitConfig, offset);
	offset += DISCRIMINATOR_SIZE;

	// Version (1 byte)
	buffer.writeUInt8(version, offset);
	offset += U8_SIZE;

	// Authority (32 bytes)
	buffer.set(pubkeyToBytes(authority), offset);
	offset += PUBKEY_SIZE;

	// Mint (32 bytes)
	buffer.set(pubkeyToBytes(mint), offset);
	offset += PUBKEY_SIZE;

	// Vault (32 bytes)
	buffer.set(pubkeyToBytes(vault), offset);
	offset += PUBKEY_SIZE;

	// Unique ID (32 bytes)
	buffer.set(pubkeyToBytes(uniqueId), offset);
	offset += PUBKEY_SIZE;

	// Bump (1 byte)
	buffer.writeUInt8(bump, offset);
	offset += U8_SIZE;

	// Recipient count (1 byte)
	buffer.writeUInt8(recipients.length, offset);
	offset += U8_SIZE;

	// PADDING: 1 byte for 2-byte alignment
	offset += 1;

	// Recipients array [Recipient; 20] = 680 bytes
	for (let i = 0; i < MAX_RECIPIENTS; i++) {
		const r = recipients[i];
		if (r) {
			buffer.set(pubkeyToBytes(r.address), offset);
			offset += PUBKEY_SIZE;
			buffer.writeUInt16LE(r.percentageBps, offset);
			offset += U16_SIZE;
		} else {
			// Zero-fill unused slots
			offset += RECIPIENT_SIZE;
		}
	}

	// PADDING: 4 bytes for 8-byte alignment
	offset += 4;

	// Unclaimed amounts array [UnclaimedAmount; 20] = 960 bytes
	for (let i = 0; i < MAX_RECIPIENTS; i++) {
		const u = unclaimedAmounts[i];
		if (u) {
			buffer.set(pubkeyToBytes(u.recipient), offset);
			offset += PUBKEY_SIZE;
			buffer.writeBigUInt64LE(u.amount, offset);
			offset += U64_SIZE;
			buffer.writeBigInt64LE(u.timestamp, offset);
			offset += I64_SIZE;
		} else {
			// Zero-fill unused slots
			offset += UNCLAIMED_AMOUNT_SIZE;
		}
	}

	// Protocol unclaimed (8 bytes)
	buffer.writeBigUInt64LE(protocolUnclaimed, offset);
	offset += U64_SIZE;

	// Last activity (8 bytes)
	buffer.writeBigInt64LE(lastActivity, offset);
	offset += I64_SIZE;

	// Rent payer (32 bytes)
	buffer.set(pubkeyToBytes(rentPayer), offset);

	return buffer;
}

/**
 * Generate a random pubkey string for testing
 */
export function randomPubkey(): string {
	return Keypair.generate().publicKey.toBase58();
}
