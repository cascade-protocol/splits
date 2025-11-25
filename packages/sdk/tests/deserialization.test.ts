/**
 * Tests for account deserialization
 * Validates byte parsing of on-chain #[repr(C)] structs with padding
 */

import { describe, it, expect } from "vitest";
import {
	deserializeSplitConfig,
	deserializeProtocolConfig,
	PROTOCOL_CONFIG_SIZE,
	SPLIT_CONFIG_SIZE,
} from "../src/core/deserialization.js";
import {
	createMockProtocolConfigBuffer,
	createMockSplitConfigBuffer,
	TEST_PUBKEYS,
	randomPubkey,
} from "./fixtures.js";

describe("deserializeProtocolConfig", () => {
	it("deserializes valid buffer correctly", () => {
		const buffer = createMockProtocolConfigBuffer({
			authority: TEST_PUBKEYS.authority,
			pendingAuthority: TEST_PUBKEYS.pendingAuthority,
			feeWallet: TEST_PUBKEYS.feeWallet,
			bump: 255,
		});

		const result = deserializeProtocolConfig(buffer);

		expect(result.authority).toBe(TEST_PUBKEYS.authority);
		expect(result.pendingAuthority).toBe(TEST_PUBKEYS.pendingAuthority);
		expect(result.feeWallet).toBe(TEST_PUBKEYS.feeWallet);
		expect(result.bump).toBe(255);
	});

	it("throws on wrong buffer size", () => {
		const tooSmall = Buffer.alloc(100);
		const tooLarge = Buffer.alloc(110);

		expect(() => deserializeProtocolConfig(tooSmall)).toThrow(
			`Invalid ProtocolConfig size: expected ${PROTOCOL_CONFIG_SIZE}`,
		);
		expect(() => deserializeProtocolConfig(tooLarge)).toThrow(
			`Invalid ProtocolConfig size: expected ${PROTOCOL_CONFIG_SIZE}`,
		);
	});
});

describe("deserializeSplitConfig", () => {
	it("deserializes valid buffer with 2 recipients correctly", () => {
		const buffer = createMockSplitConfigBuffer({
			version: 1,
			authority: TEST_PUBKEYS.authority,
			mint: TEST_PUBKEYS.mint,
			vault: TEST_PUBKEYS.vault,
			uniqueId: TEST_PUBKEYS.uniqueId,
			bump: 254,
			recipients: [
				{ address: TEST_PUBKEYS.recipient1, percentageBps: 5940 },
				{ address: TEST_PUBKEYS.recipient2, percentageBps: 3960 },
			],
			protocolUnclaimed: 0n,
			lastActivity: 1700000000n,
			rentPayer: TEST_PUBKEYS.rentPayer,
		});

		const result = deserializeSplitConfig(buffer);

		expect(result.version).toBe(1);
		expect(result.authority).toBe(TEST_PUBKEYS.authority);
		expect(result.mint).toBe(TEST_PUBKEYS.mint);
		expect(result.vault).toBe(TEST_PUBKEYS.vault);
		expect(result.uniqueId).toBe(TEST_PUBKEYS.uniqueId);
		expect(result.bump).toBe(254);
		expect(result.recipientCount).toBe(2);
		expect(result.recipients).toHaveLength(2);
		expect(result.recipients[0]?.address).toBe(TEST_PUBKEYS.recipient1);
		expect(result.recipients[0]?.percentageBps).toBe(5940);
		expect(result.recipients[1]?.address).toBe(TEST_PUBKEYS.recipient2);
		expect(result.recipients[1]?.percentageBps).toBe(3960);
		expect(result.protocolUnclaimed).toBe(0n);
		expect(result.lastActivity).toBe(1700000000n);
		expect(result.rentPayer).toBe(TEST_PUBKEYS.rentPayer);
	});

	it("deserializes single recipient (100% share)", () => {
		const buffer = createMockSplitConfigBuffer({
			recipients: [{ address: TEST_PUBKEYS.recipient1, percentageBps: 9900 }],
		});

		const result = deserializeSplitConfig(buffer);

		expect(result.recipientCount).toBe(1);
		expect(result.recipients).toHaveLength(1);
		expect(result.recipients[0]?.percentageBps).toBe(9900);
	});

	it("filters zero unclaimed amounts", () => {
		const buffer = createMockSplitConfigBuffer({
			recipients: [
				{ address: TEST_PUBKEYS.recipient1, percentageBps: 5940 },
				{ address: TEST_PUBKEYS.recipient2, percentageBps: 3960 },
			],
			// No unclaimed amounts - all zeros in array
			unclaimedAmounts: [],
		});

		const result = deserializeSplitConfig(buffer);

		// Should filter out zero amounts
		expect(result.unclaimedAmounts).toHaveLength(0);
	});

	it("includes non-zero unclaimed amounts", () => {
		const timestamp = 1700000000n;
		const buffer = createMockSplitConfigBuffer({
			recipients: [
				{ address: TEST_PUBKEYS.recipient1, percentageBps: 5940 },
				{ address: TEST_PUBKEYS.recipient2, percentageBps: 3960 },
			],
			unclaimedAmounts: [
				{ recipient: TEST_PUBKEYS.recipient1, amount: 1000000n, timestamp },
			],
		});

		const result = deserializeSplitConfig(buffer);

		expect(result.unclaimedAmounts).toHaveLength(1);
		expect(result.unclaimedAmounts[0]?.recipient).toBe(TEST_PUBKEYS.recipient1);
		expect(result.unclaimedAmounts[0]?.amount).toBe(1000000n);
		expect(result.unclaimedAmounts[0]?.timestamp).toBe(timestamp);
	});

	it("deserializes protocol unclaimed correctly", () => {
		const buffer = createMockSplitConfigBuffer({
			protocolUnclaimed: 50000n,
		});

		const result = deserializeSplitConfig(buffer);

		expect(result.protocolUnclaimed).toBe(50000n);
	});

	it("throws on wrong buffer size", () => {
		const tooSmall = Buffer.alloc(1800);
		const tooLarge = Buffer.alloc(2000);

		expect(() => deserializeSplitConfig(tooSmall)).toThrow(
			`Invalid SplitConfig size: expected ${SPLIT_CONFIG_SIZE}`,
		);
		expect(() => deserializeSplitConfig(tooLarge)).toThrow(
			`Invalid SplitConfig size: expected ${SPLIT_CONFIG_SIZE}`,
		);
	});

	it("handles maximum recipients (20)", () => {
		// Generate 20 valid random pubkeys
		const recipients = Array.from({ length: 20 }, (_, i) => ({
			address: randomPubkey(),
			// First recipient gets 81%, rest get 1% each (81 + 19*1 = 100 shares = 9900 bps)
			percentageBps: i === 0 ? 8019 : 99,
		}));

		const buffer = createMockSplitConfigBuffer({ recipients });

		const result = deserializeSplitConfig(buffer);

		expect(result.recipientCount).toBe(20);
		expect(result.recipients).toHaveLength(20);
	});

	it("correctly handles padding bytes (regression test)", () => {
		// This test verifies the padding is handled correctly
		// by checking fields that come AFTER padding bytes
		const buffer = createMockSplitConfigBuffer({
			recipients: [{ address: TEST_PUBKEYS.recipient1, percentageBps: 9900 }],
			unclaimedAmounts: [
				{
					recipient: TEST_PUBKEYS.recipient2,
					amount: 123456789n,
					timestamp: 1700000000n,
				},
			],
			protocolUnclaimed: 987654321n,
			lastActivity: 1699999999n,
		});

		const result = deserializeSplitConfig(buffer);

		// These fields come after padding bytes - if padding is wrong, these will be corrupted
		expect(result.unclaimedAmounts[0]?.amount).toBe(123456789n);
		expect(result.protocolUnclaimed).toBe(987654321n);
		expect(result.lastActivity).toBe(1699999999n);
	});
});
