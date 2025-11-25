/**
 * Account deserialization for Cascade Splits on-chain state
 * Handles zero-copy #[repr(C)] structs with proper padding
 */

import { encodeAddress } from "./encoding.js";
import type {
	RawSplitConfig,
	ProtocolConfig,
	UnclaimedAmount,
} from "./types.js";

// Account sizes (from Rust constants.rs)
export const PROTOCOL_CONFIG_SIZE = 105;
export const SPLIT_CONFIG_SIZE = 1832;
const DISCRIMINATOR_SIZE = 8;

/**
 * Deserialize ProtocolConfig account (105 bytes)
 *
 * Structure:
 * - discriminator: 8 bytes
 * - authority: 32 bytes (Pubkey)
 * - pending_authority: 32 bytes (Pubkey)
 * - fee_wallet: 32 bytes (Pubkey)
 * - bump: 1 byte (u8)
 */
export function deserializeProtocolConfig(data: Buffer): ProtocolConfig {
	if (data.length !== PROTOCOL_CONFIG_SIZE) {
		throw new Error(
			`Invalid ProtocolConfig size: expected ${PROTOCOL_CONFIG_SIZE}, got ${data.length}`,
		);
	}

	let offset = DISCRIMINATOR_SIZE;

	const authority = encodeAddress(data.subarray(offset, offset + 32));
	offset += 32;

	const pendingAuthority = encodeAddress(data.subarray(offset, offset + 32));
	offset += 32;

	const feeWallet = encodeAddress(data.subarray(offset, offset + 32));
	offset += 32;

	const bump = data.readUInt8(offset);

	return {
		authority,
		pendingAuthority,
		feeWallet,
		bump,
	};
}

/**
 * Deserialize SplitConfig account (1832 bytes)
 *
 * Structure (with #[repr(C)] padding):
 * - discriminator: 8 bytes
 * - version: 1 byte (u8)
 * - authority: 32 bytes (Pubkey)
 * - mint: 32 bytes (Pubkey)
 * - vault: 32 bytes (Pubkey)
 * - unique_id: 32 bytes (Pubkey)
 * - bump: 1 byte (u8)
 * - recipient_count: 1 byte (u8)
 * - **padding: 1 byte** (for 2-byte alignment)
 * - recipients: [Recipient; 20] = 680 bytes
 *   - each: address (32) + percentage_bps (2) = 34 bytes
 * - **padding: 4 bytes** (for 8-byte alignment)
 * - unclaimed_amounts: [UnclaimedAmount; 20] = 960 bytes
 *   - each: recipient (32) + amount (8) + timestamp (8) = 48 bytes
 * - protocol_unclaimed: 8 bytes (u64)
 * - last_activity: 8 bytes (i64)
 * - rent_payer: 32 bytes (Pubkey)
 */
export function deserializeSplitConfig(data: Buffer): RawSplitConfig {
	if (data.length !== SPLIT_CONFIG_SIZE) {
		throw new Error(
			`Invalid SplitConfig size: expected ${SPLIT_CONFIG_SIZE}, got ${data.length}`,
		);
	}

	let offset = DISCRIMINATOR_SIZE;

	// version (u8)
	const version = data.readUInt8(offset);
	offset += 1;

	// authority (Pubkey)
	const authority = encodeAddress(data.subarray(offset, offset + 32));
	offset += 32;

	// mint (Pubkey)
	const mint = encodeAddress(data.subarray(offset, offset + 32));
	offset += 32;

	// vault (Pubkey)
	const vault = encodeAddress(data.subarray(offset, offset + 32));
	offset += 32;

	// unique_id (Pubkey)
	const uniqueId = encodeAddress(data.subarray(offset, offset + 32));
	offset += 32;

	// bump (u8)
	const bump = data.readUInt8(offset);
	offset += 1;

	// recipient_count (u8)
	const recipientCount = data.readUInt8(offset);
	offset += 1;

	// PADDING: 1 byte for 2-byte alignment
	offset += 1;

	// recipients array [Recipient; 20]
	const recipients = [];
	for (let i = 0; i < recipientCount; i++) {
		const address = encodeAddress(data.subarray(offset, offset + 32));
		offset += 32;
		const percentageBps = data.readUInt16LE(offset);
		offset += 2;
		recipients.push({ address, percentageBps });
	}

	// Skip remaining unused recipients
	offset += (20 - recipientCount) * 34;

	// PADDING: 4 bytes for 8-byte alignment
	offset += 4;

	// unclaimed_amounts array [UnclaimedAmount; 20]
	const unclaimedAmounts: UnclaimedAmount[] = [];
	for (let i = 0; i < 20; i++) {
		const recipient = encodeAddress(data.subarray(offset, offset + 32));
		offset += 32;
		const amount = data.readBigUInt64LE(offset);
		offset += 8;
		const timestamp = data.readBigInt64LE(offset);
		offset += 8;

		// Only include non-zero amounts
		if (amount > 0n) {
			unclaimedAmounts.push({ recipient, amount, timestamp });
		}
	}

	// protocol_unclaimed (u64)
	const protocolUnclaimed = data.readBigUInt64LE(offset);
	offset += 8;

	// last_activity (i64)
	const lastActivity = data.readBigInt64LE(offset);
	offset += 8;

	// rent_payer (Pubkey)
	const rentPayer = encodeAddress(data.subarray(offset, offset + 32));

	return {
		version,
		authority,
		mint,
		vault,
		uniqueId,
		bump,
		recipientCount,
		recipients,
		unclaimedAmounts,
		protocolUnclaimed,
		lastActivity,
		rentPayer,
	};
}
