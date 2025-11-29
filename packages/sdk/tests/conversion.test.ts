import { describe, it, expect } from "vitest";
import { sharesToBps, bpsToShares, toPercentageBps } from "../src/index.js";

describe("sharesToBps", () => {
	it("converts shares to bps correctly", () => {
		expect(sharesToBps(1)).toBe(99);
		expect(sharesToBps(50)).toBe(4950);
		expect(sharesToBps(100)).toBe(9900);
	});

	it("throws on invalid input", () => {
		expect(() => sharesToBps(0)).toThrow();
		expect(() => sharesToBps(101)).toThrow();
		expect(() => sharesToBps(1.5)).toThrow();
	});
});

describe("bpsToShares", () => {
	it("converts bps to shares correctly", () => {
		expect(bpsToShares(99)).toBe(1);
		expect(bpsToShares(4950)).toBe(50);
		expect(bpsToShares(9900)).toBe(100);
	});
});

describe("toPercentageBps", () => {
	it("handles share input", () => {
		expect(toPercentageBps({ address: "x", share: 60 })).toBe(5940);
	});

	it("handles percentageBps input", () => {
		expect(toPercentageBps({ address: "x", percentageBps: 5940 })).toBe(5940);
	});

	it("throws when neither provided", () => {
		expect(() => toPercentageBps({ address: "x" })).toThrow();
	});

	it("throws on invalid percentageBps", () => {
		expect(() => toPercentageBps({ address: "x", percentageBps: 0 })).toThrow();
		expect(() =>
			toPercentageBps({ address: "x", percentageBps: 10000 }),
		).toThrow();
	});
});
