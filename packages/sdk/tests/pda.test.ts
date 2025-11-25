/**
 * Tests for PDA derivation utilities
 */

import { describe, it, expect } from "vitest";
import {
	deriveProtocolConfig,
	deriveSplitConfig,
	deriveVault,
	deriveAta,
	deriveProgramData,
	deriveCreateSplitConfigAddresses,
} from "../src/pda.js";
import {
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
} from "../src/core/constants.js";
import { TEST_PUBKEYS } from "./fixtures.js";

describe("deriveProtocolConfig", () => {
	it("returns consistent address", () => {
		const result1 = deriveProtocolConfig();
		const result2 = deriveProtocolConfig();

		expect(result1.address).toBe(result2.address);
		expect(result1.bump).toBe(result2.bump);
	});

	it("returns valid base58 address", () => {
		const result = deriveProtocolConfig();

		// Valid base58 Solana address is 32-44 characters
		expect(result.address.length).toBeGreaterThanOrEqual(32);
		expect(result.address.length).toBeLessThanOrEqual(44);
	});

	it("returns valid bump (0-255)", () => {
		const result = deriveProtocolConfig();

		expect(result.bump).toBeGreaterThanOrEqual(0);
		expect(result.bump).toBeLessThanOrEqual(255);
	});
});

describe("deriveSplitConfig", () => {
	it("returns consistent address for same inputs", () => {
		const authority = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;
		const uniqueId = TEST_PUBKEYS.uniqueId;

		const result1 = deriveSplitConfig(authority, mint, uniqueId);
		const result2 = deriveSplitConfig(authority, mint, uniqueId);

		expect(result1.address).toBe(result2.address);
		expect(result1.bump).toBe(result2.bump);
	});

	it("returns different address for different authority", () => {
		const mint = TEST_PUBKEYS.mint;
		const uniqueId = TEST_PUBKEYS.uniqueId;

		const result1 = deriveSplitConfig(TEST_PUBKEYS.authority, mint, uniqueId);
		const result2 = deriveSplitConfig(TEST_PUBKEYS.feeWallet, mint, uniqueId);

		expect(result1.address).not.toBe(result2.address);
	});

	it("returns different address for different mint", () => {
		const authority = TEST_PUBKEYS.authority;
		const uniqueId = TEST_PUBKEYS.uniqueId;

		const result1 = deriveSplitConfig(authority, TEST_PUBKEYS.mint, uniqueId);
		const result2 = deriveSplitConfig(authority, TEST_PUBKEYS.vault, uniqueId);

		expect(result1.address).not.toBe(result2.address);
	});

	it("returns different address for different uniqueId", () => {
		const authority = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;

		const result1 = deriveSplitConfig(authority, mint, TEST_PUBKEYS.uniqueId);
		const result2 = deriveSplitConfig(authority, mint, TEST_PUBKEYS.rentPayer);

		expect(result1.address).not.toBe(result2.address);
	});

	it("returns valid base58 address", () => {
		const result = deriveSplitConfig(
			TEST_PUBKEYS.authority,
			TEST_PUBKEYS.mint,
			TEST_PUBKEYS.uniqueId,
		);

		expect(result.address.length).toBeGreaterThanOrEqual(32);
		expect(result.address.length).toBeLessThanOrEqual(44);
	});
});

describe("deriveVault", () => {
	it("returns consistent address for same inputs", () => {
		const splitConfig = TEST_PUBKEYS.authority; // Using as mock split config
		const mint = TEST_PUBKEYS.mint;

		const result1 = deriveVault(splitConfig, mint);
		const result2 = deriveVault(splitConfig, mint);

		expect(result1).toBe(result2);
	});

	it("returns different address for different splitConfig", () => {
		const mint = TEST_PUBKEYS.mint;

		const result1 = deriveVault(TEST_PUBKEYS.authority, mint);
		const result2 = deriveVault(TEST_PUBKEYS.feeWallet, mint);

		expect(result1).not.toBe(result2);
	});

	it("returns different address for different mint", () => {
		const splitConfig = TEST_PUBKEYS.authority;

		const result1 = deriveVault(splitConfig, TEST_PUBKEYS.mint);
		const result2 = deriveVault(splitConfig, TEST_PUBKEYS.vault);

		expect(result1).not.toBe(result2);
	});

	it("returns different address for different token program", () => {
		const splitConfig = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;

		const result1 = deriveVault(splitConfig, mint, TOKEN_PROGRAM_ID);
		const result2 = deriveVault(splitConfig, mint, TOKEN_2022_PROGRAM_ID);

		expect(result1).not.toBe(result2);
	});

	it("defaults to TOKEN_PROGRAM_ID", () => {
		const splitConfig = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;

		const resultDefault = deriveVault(splitConfig, mint);
		const resultExplicit = deriveVault(splitConfig, mint, TOKEN_PROGRAM_ID);

		expect(resultDefault).toBe(resultExplicit);
	});
});

describe("deriveAta", () => {
	it("returns consistent address for same inputs", () => {
		const owner = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;

		const result1 = deriveAta(owner, mint);
		const result2 = deriveAta(owner, mint);

		expect(result1).toBe(result2);
	});

	it("returns different address for different owner", () => {
		const mint = TEST_PUBKEYS.mint;

		const result1 = deriveAta(TEST_PUBKEYS.authority, mint);
		const result2 = deriveAta(TEST_PUBKEYS.feeWallet, mint);

		expect(result1).not.toBe(result2);
	});

	it("returns different address for different mint", () => {
		const owner = TEST_PUBKEYS.authority;

		const result1 = deriveAta(owner, TEST_PUBKEYS.mint);
		const result2 = deriveAta(owner, TEST_PUBKEYS.vault);

		expect(result1).not.toBe(result2);
	});

	it("supports Token-2022 program", () => {
		const owner = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;

		const result1 = deriveAta(owner, mint, TOKEN_PROGRAM_ID);
		const result2 = deriveAta(owner, mint, TOKEN_2022_PROGRAM_ID);

		expect(result1).not.toBe(result2);
	});
});

describe("deriveProgramData", () => {
	it("returns consistent address", () => {
		const result1 = deriveProgramData();
		const result2 = deriveProgramData();

		expect(result1.address).toBe(result2.address);
		expect(result1.bump).toBe(result2.bump);
	});

	it("returns valid base58 address", () => {
		const result = deriveProgramData();

		expect(result.address.length).toBeGreaterThanOrEqual(32);
		expect(result.address.length).toBeLessThanOrEqual(44);
	});
});

describe("deriveCreateSplitConfigAddresses", () => {
	it("returns both splitConfig and vault", () => {
		const result = deriveCreateSplitConfigAddresses(
			TEST_PUBKEYS.authority,
			TEST_PUBKEYS.mint,
			TEST_PUBKEYS.uniqueId,
		);

		expect(result.splitConfig).toBeDefined();
		expect(result.vault).toBeDefined();
		expect(result.splitConfig).not.toBe(result.vault);
	});

	it("vault matches deriveVault(splitConfig)", () => {
		const authority = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;
		const uniqueId = TEST_PUBKEYS.uniqueId;

		const result = deriveCreateSplitConfigAddresses(authority, mint, uniqueId);
		const expectedVault = deriveVault(
			result.splitConfig,
			mint,
			TOKEN_PROGRAM_ID,
		);

		expect(result.vault).toBe(expectedVault);
	});

	it("splitConfig matches deriveSplitConfig", () => {
		const authority = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;
		const uniqueId = TEST_PUBKEYS.uniqueId;

		const result = deriveCreateSplitConfigAddresses(authority, mint, uniqueId);
		const { address: expectedSplitConfig } = deriveSplitConfig(
			authority,
			mint,
			uniqueId,
		);

		expect(result.splitConfig).toBe(expectedSplitConfig);
	});

	it("returns consistent addresses for same inputs", () => {
		const authority = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;
		const uniqueId = TEST_PUBKEYS.uniqueId;

		const result1 = deriveCreateSplitConfigAddresses(authority, mint, uniqueId);
		const result2 = deriveCreateSplitConfigAddresses(authority, mint, uniqueId);

		expect(result1.splitConfig).toBe(result2.splitConfig);
		expect(result1.vault).toBe(result2.vault);
	});

	it("supports custom token program", () => {
		const authority = TEST_PUBKEYS.authority;
		const mint = TEST_PUBKEYS.mint;
		const uniqueId = TEST_PUBKEYS.uniqueId;

		const result1 = deriveCreateSplitConfigAddresses(
			authority,
			mint,
			uniqueId,
			TOKEN_PROGRAM_ID,
		);
		const result2 = deriveCreateSplitConfigAddresses(
			authority,
			mint,
			uniqueId,
			TOKEN_2022_PROGRAM_ID,
		);

		// Split config should be the same (doesn't depend on token program)
		expect(result1.splitConfig).toBe(result2.splitConfig);
		// Vault should be different (ATA depends on token program)
		expect(result1.vault).not.toBe(result2.vault);
	});
});
