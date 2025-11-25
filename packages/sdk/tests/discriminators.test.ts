/**
 * Tests for discriminator utilities
 */

import { describe, it, expect } from "vitest";
import {
	DISCRIMINATORS,
	ACCOUNT_DISCRIMINATORS,
	matchesDiscriminator,
} from "../src/discriminators.js";

describe("matchesDiscriminator", () => {
	it("returns true for matching instruction discriminator", () => {
		// Create data that starts with executeSplit discriminator
		const data = new Uint8Array([
			...DISCRIMINATORS.executeSplit,
			0,
			1,
			2,
			3, // extra bytes
		]);

		expect(matchesDiscriminator(data, DISCRIMINATORS.executeSplit)).toBe(true);
	});

	it("returns true for matching account discriminator", () => {
		const data = new Uint8Array([
			...ACCOUNT_DISCRIMINATORS.splitConfig,
			...new Array(100).fill(0), // account data
		]);

		expect(matchesDiscriminator(data, ACCOUNT_DISCRIMINATORS.splitConfig)).toBe(
			true,
		);
	});

	it("returns false for non-matching discriminator", () => {
		const data = new Uint8Array([...DISCRIMINATORS.executeSplit, 0, 1, 2, 3]);

		expect(matchesDiscriminator(data, DISCRIMINATORS.createSplitConfig)).toBe(
			false,
		);
	});

	it("returns false for data shorter than 8 bytes", () => {
		const shortData = new Uint8Array([1, 2, 3, 4, 5, 6, 7]); // 7 bytes

		expect(matchesDiscriminator(shortData, DISCRIMINATORS.executeSplit)).toBe(
			false,
		);
	});

	it("returns false for empty data", () => {
		const emptyData = new Uint8Array([]);

		expect(matchesDiscriminator(emptyData, DISCRIMINATORS.executeSplit)).toBe(
			false,
		);
	});

	it("works with Buffer (Node.js)", () => {
		const bufferData = Buffer.from([
			...DISCRIMINATORS.createSplitConfig,
			0,
			0,
			0,
		]);

		expect(
			matchesDiscriminator(bufferData, DISCRIMINATORS.createSplitConfig),
		).toBe(true);
	});

	it("returns true for exactly 8 bytes matching", () => {
		const exactData = new Uint8Array(DISCRIMINATORS.closeSplitConfig);

		expect(
			matchesDiscriminator(exactData, DISCRIMINATORS.closeSplitConfig),
		).toBe(true);
	});

	it("distinguishes between all instruction discriminators", () => {
		const allDiscriminators = Object.values(DISCRIMINATORS);

		// Each discriminator should only match itself
		for (const disc of allDiscriminators) {
			const data = new Uint8Array([...disc, 0, 0, 0, 0]);

			for (const other of allDiscriminators) {
				const shouldMatch = disc === other;
				expect(matchesDiscriminator(data, other)).toBe(shouldMatch);
			}
		}
	});

	it("distinguishes between account discriminators", () => {
		const splitConfigData = new Uint8Array([
			...ACCOUNT_DISCRIMINATORS.splitConfig,
			...new Array(50).fill(0),
		]);

		const protocolConfigData = new Uint8Array([
			...ACCOUNT_DISCRIMINATORS.protocolConfig,
			...new Array(50).fill(0),
		]);

		expect(
			matchesDiscriminator(splitConfigData, ACCOUNT_DISCRIMINATORS.splitConfig),
		).toBe(true);
		expect(
			matchesDiscriminator(
				splitConfigData,
				ACCOUNT_DISCRIMINATORS.protocolConfig,
			),
		).toBe(false);

		expect(
			matchesDiscriminator(
				protocolConfigData,
				ACCOUNT_DISCRIMINATORS.protocolConfig,
			),
		).toBe(true);
		expect(
			matchesDiscriminator(
				protocolConfigData,
				ACCOUNT_DISCRIMINATORS.splitConfig,
			),
		).toBe(false);
	});
});

describe("DISCRIMINATORS", () => {
	it("has all expected instruction discriminators", () => {
		expect(DISCRIMINATORS.initializeProtocol).toBeInstanceOf(Uint8Array);
		expect(DISCRIMINATORS.updateProtocolConfig).toBeInstanceOf(Uint8Array);
		expect(DISCRIMINATORS.transferProtocolAuthority).toBeInstanceOf(Uint8Array);
		expect(DISCRIMINATORS.acceptProtocolAuthority).toBeInstanceOf(Uint8Array);
		expect(DISCRIMINATORS.createSplitConfig).toBeInstanceOf(Uint8Array);
		expect(DISCRIMINATORS.executeSplit).toBeInstanceOf(Uint8Array);
		expect(DISCRIMINATORS.updateSplitConfig).toBeInstanceOf(Uint8Array);
		expect(DISCRIMINATORS.closeSplitConfig).toBeInstanceOf(Uint8Array);
	});

	it("all discriminators are 8 bytes", () => {
		for (const [, disc] of Object.entries(DISCRIMINATORS)) {
			expect(disc.length).toBe(8);
		}
	});
});

describe("ACCOUNT_DISCRIMINATORS", () => {
	it("has all expected account discriminators", () => {
		expect(ACCOUNT_DISCRIMINATORS.protocolConfig).toBeInstanceOf(Uint8Array);
		expect(ACCOUNT_DISCRIMINATORS.splitConfig).toBeInstanceOf(Uint8Array);
	});

	it("all discriminators are 8 bytes", () => {
		for (const [, disc] of Object.entries(ACCOUNT_DISCRIMINATORS)) {
			expect(disc.length).toBe(8);
		}
	});
});
