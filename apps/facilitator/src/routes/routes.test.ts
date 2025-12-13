/**
 * Integration tests for HTTP routes
 *
 * Tests the Hono app handlers with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../types.js";
import type {
  SupportedResponse,
  VerifyResponse,
  SettleResponse,
} from "@x402/core/types";

// Mock the signer module
vi.mock("../lib/signer.js", () => ({
  createFacilitatorSigner: vi.fn().mockResolvedValue({
    getAddresses: () => ["F2vVvFwrbGHtsBEqFkSkLvsM6SJmDMm7KqhiW2P64WxY"],
    signTransaction: vi.fn().mockResolvedValue("signed-tx-base64"),
    simulateTransaction: vi.fn().mockResolvedValue({
      success: true,
      logs: [],
      innerInstructions: [],
    }),
    sendTransaction: vi.fn().mockResolvedValue("tx-signature-123"),
    confirmTransaction: vi.fn().mockResolvedValue(undefined),
  }),
  decodeTransaction: vi.fn().mockReturnValue({
    messageBytes: new Uint8Array(100),
    signatures: {},
  }),
}));

// Import handlers after mocking
import { supportedHandler } from "./supported.js";
import { verifyHandler } from "./verify.js";
import { settleHandler } from "./settle.js";

// Create test app
function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/supported", supportedHandler);
  app.post("/verify", verifyHandler);
  app.post("/settle", settleHandler);

  return app;
}

const TEST_ENV: Env = {
  FEE_PAYER_KEY: "test-key-base58",
  HELIUS_RPC_URL: "https://test-rpc.example.com",
};

describe("GET /supported", () => {
  it("returns supported schemes and extensions", async () => {
    const app = createTestApp();
    const res = await app.request("/supported", {}, TEST_ENV);

    expect(res.status).toBe(200);

    const body = (await res.json()) as SupportedResponse;
    expect(body.kinds).toHaveLength(1);
    expect(body.kinds[0]).toMatchObject({
      x402Version: 2,
      scheme: "exact",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    });
    expect(body.kinds[0].extra?.feePayer).toBe(
      "F2vVvFwrbGHtsBEqFkSkLvsM6SJmDMm7KqhiW2P64WxY",
    );
    expect(body.extensions).toContain("cpi-verification");
    expect(body.extensions).toContain("deadline-validator");
    expect(body.extensions).toContain("durable-nonce");
    expect(body.signers["solana:*"]).toContain(
      "F2vVvFwrbGHtsBEqFkSkLvsM6SJmDMm7KqhiW2P64WxY",
    );
  });

  it("returns 500 when misconfigured", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/supported",
      {},
      { FEE_PAYER_KEY: "", HELIUS_RPC_URL: "" },
    );

    expect(res.status).toBe(500);
  });
});

describe("POST /verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid request body", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
      TEST_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as VerifyResponse;
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe("invalid_request_body");
  });

  it("rejects unsupported scheme", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload: {
            x402Version: 2,
            accepted: { scheme: "other", network: "solana:mainnet" },
            payload: {},
          },
          paymentRequirements: {
            scheme: "exact",
            network: "solana:mainnet",
            amount: "1000000",
            asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            payTo: "recipient",
            maxTimeoutSeconds: 90,
            extra: {},
          },
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as VerifyResponse;
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe("unsupported_scheme");
  });

  it("rejects network mismatch", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload: {
            x402Version: 2,
            accepted: { scheme: "exact", network: "solana:devnet" },
            payload: {},
          },
          paymentRequirements: {
            scheme: "exact",
            network: "solana:mainnet",
            amount: "1000000",
            asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            payTo: "recipient",
            maxTimeoutSeconds: 90,
            extra: {},
          },
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as VerifyResponse;
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe("network_mismatch");
  });

  it("rejects missing transaction", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload: {
            x402Version: 2,
            accepted: {
              scheme: "exact",
              network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            },
            payload: {},
          },
          paymentRequirements: {
            scheme: "exact",
            network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            amount: "1000000",
            asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            payTo: "recipient",
            maxTimeoutSeconds: 90,
            extra: { feePayer: "F2vVvFwrbGHtsBEqFkSkLvsM6SJmDMm7KqhiW2P64WxY" },
          },
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as VerifyResponse;
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe("missing_transaction");
  });

  it("rejects unmanaged fee payer", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload: {
            x402Version: 2,
            accepted: {
              scheme: "exact",
              network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            },
            payload: { transaction: "base64tx" },
          },
          paymentRequirements: {
            scheme: "exact",
            network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            amount: "1000000",
            asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            payTo: "recipient",
            maxTimeoutSeconds: 90,
            extra: { feePayer: "SomeOtherAddress" },
          },
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as VerifyResponse;
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe("fee_payer_not_managed_by_facilitator");
  });
});

describe("POST /settle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid request body", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/settle",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
      TEST_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as SettleResponse;
    expect(body.success).toBe(false);
    expect(body.errorReason).toBe("invalid_request_body");
  });

  it("rejects unsupported scheme", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/settle",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload: {
            x402Version: 2,
            accepted: { scheme: "other", network: "solana:mainnet" },
            payload: {},
          },
          paymentRequirements: {
            scheme: "exact",
            network: "solana:mainnet",
            amount: "1000000",
            asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            payTo: "recipient",
            maxTimeoutSeconds: 90,
            extra: {},
          },
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as SettleResponse;
    expect(body.success).toBe(false);
    expect(body.errorReason).toBe("unsupported_scheme");
  });
});
