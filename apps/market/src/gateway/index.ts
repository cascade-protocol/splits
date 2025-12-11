/**
 * Cascade Market Gateway
 *
 * Hono app for *.mcps.cascade.fyi
 * Handles x402 payments and forwards to tunnels
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

// USDC mint on Solana mainnet
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type Bindings = {
  DB: D1Database;
  TUNNEL_RELAY: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS for all routes
app.use("/*", cors());

// Health check
app.get("/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

// Service lookup by subdomain
async function getServiceBySubdomain(subdomain: string, db: D1Database) {
  return db
    .prepare(
      "SELECT id, name, split_vault, price, status FROM services WHERE name = ?",
    )
    .bind(subdomain)
    .first<{
      id: string;
      name: string;
      split_vault: string;
      price: string;
      status: string;
    }>();
}

// x402 payment-required endpoint for MCP calls
app.all("/mcp/*", async (c) => {
  const host = c.req.header("host");
  if (!host) {
    return c.json({ error: "Missing host header" }, 400);
  }

  const subdomain = host.split(".")[0];
  const service = await getServiceBySubdomain(subdomain, c.env.DB);

  if (!service) {
    return c.json({ error: "Service not found" }, 404);
  }

  if (service.status !== "online") {
    return c.json({ error: "Service offline" }, 503);
  }

  // Check for payment header
  const paymentHeader = c.req.header("X-PAYMENT");

  if (!paymentHeader) {
    // Return 402 with payment requirements (x402 spec)
    return c.json(
      {
        x402Version: 1,
        error: "Payment required",
        accepts: [
          {
            scheme: "exact",
            network: "solana",
            maxAmountRequired: service.price,
            resource: `https://${subdomain}.mcps.cascade.fyi/mcp`,
            payTo: service.split_vault, // Split vault receives payment
            asset: USDC_MINT,
            maxTimeoutSeconds: 60,
            extra: {
              facilitator: "https://tabs.cascade.fyi/api",
            },
          },
        ],
      },
      402,
    );
  }

  // TODO: Verify payment via Tabs facilitator
  // For MVP, we'll trust the payment header and verify later
  const verified = await verifyPayment(paymentHeader, service.price);
  if (!verified.valid) {
    return c.json({ error: verified.error }, 400);
  }

  // Record payment for later split execution
  await c.env.DB.prepare(
    "UPDATE services SET pending_balance = pending_balance + ?, total_calls = total_calls + 1 WHERE name = ?",
  )
    .bind(service.price, subdomain)
    .run();

  // Forward to tunnel
  const tunnelId = c.env.TUNNEL_RELAY.idFromName(subdomain);
  const tunnel = c.env.TUNNEL_RELAY.get(tunnelId);
  return tunnel.fetch(c.req.raw);
});

// Tunnel connection endpoint (for CLI)
app.get("/tunnel/connect", async (c) => {
  const host = c.req.header("host");
  if (!host) {
    return c.json({ error: "Missing host header" }, 400);
  }

  const subdomain = host.split(".")[0];
  const tunnelId = c.env.TUNNEL_RELAY.idFromName(subdomain);
  const tunnel = c.env.TUNNEL_RELAY.get(tunnelId);
  return tunnel.fetch(c.req.raw);
});

// Payment verification (simplified for MVP)
async function verifyPayment(
  paymentHeader: string,
  expectedAmount: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const decoded = JSON.parse(atob(paymentHeader));

    if (decoded.x402Version !== 1) {
      return { valid: false, error: "Unsupported x402 version" };
    }

    // Verify the payment amount matches expected
    if (decoded.payload?.amount) {
      const paymentAmount = BigInt(decoded.payload.amount);
      const expected = BigInt(expectedAmount);
      if (paymentAmount < expected) {
        return {
          valid: false,
          error: `Insufficient payment: expected ${expectedAmount}, got ${decoded.payload.amount}`,
        };
      }
    }

    // TODO: Actually verify the transaction on-chain via Tabs facilitator
    // For MVP, we'll accept the payment header as-is after basic validation
    // Real implementation would:
    // 1. Parse the transaction from decoded.payload.transaction
    // 2. Verify it pays the correct amount to the split vault
    // 3. Submit it to the network if not already confirmed
    // 4. Wait for confirmation

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid payment header" };
  }
}

export { app as gatewayApp };
