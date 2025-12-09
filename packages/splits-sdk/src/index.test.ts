import { describe, it, expect } from "vitest";
import {
  shareToPercentageBps,
  percentageBpsToShares,
  toPercentageBps,
} from "./index.js";

describe("shareToPercentageBps", () => {
  it("converts shares to bps correctly", () => {
    expect(shareToPercentageBps(1)).toBe(99);
    expect(shareToPercentageBps(50)).toBe(4950);
    expect(shareToPercentageBps(100)).toBe(9900);
  });

  it("throws on invalid input", () => {
    expect(() => shareToPercentageBps(0)).toThrow();
    expect(() => shareToPercentageBps(101)).toThrow();
    expect(() => shareToPercentageBps(1.5)).toThrow();
  });
});

describe("percentageBpsToShares", () => {
  it("converts bps to shares correctly", () => {
    expect(percentageBpsToShares(99)).toBe(1);
    expect(percentageBpsToShares(4950)).toBe(50);
    expect(percentageBpsToShares(9900)).toBe(100);
  });
});

describe("toPercentageBps", () => {
  it("handles share input", () => {
    expect(toPercentageBps({ address: "x", share: 60 })).toBe(5940);
  });

  it("handles percentageBps input", () => {
    expect(toPercentageBps({ address: "x", percentageBps: 5940 })).toBe(5940);
  });

  // "neither provided" case is now a compile-time error via Recipient type

  it("throws on invalid percentageBps", () => {
    expect(() => toPercentageBps({ address: "x", percentageBps: 0 })).toThrow();
    expect(() =>
      toPercentageBps({ address: "x", percentageBps: 10000 }),
    ).toThrow();
  });
});
