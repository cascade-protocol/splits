/**
 * Cascade Market Gateway
 *
 * Hono app for *.mcps.cascade.fyi
 * Handles OAuth authentication and x402 payments, forwards to tunnels
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyAccessToken, type AuthInfo } from "../server/oauth";

// USDC mint on Solana mainnet
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Base URL for OAuth metadata
const BASE_URL = "https://market.cascade.fyi";

// Rate limit config: requests per window
const RATE_LIMIT = {
  mcp: { limit: 60, windowSec: 60 }, // 60 req/min per IP for MCP
};

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  TUNNEL_RELAY: DurableObjectNamespace;
  JWT_SECRET: string;
};

type Variables = {
  authInfo?: AuthInfo;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS for all routes
app.use("/*", cors());

// Health check
app.get("/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

/**
 * Check rate limit using KV with sliding window
 * Returns true if request is allowed, false if rate limited
 */
async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `ratelimit:${key}:${Math.floor(now / windowSec)}`;

  const current = Number.parseInt((await kv.get(windowKey)) || "0", 10);
  if (current >= limit) {
    return false;
  }

  // Increment counter with TTL of 2x window (cleanup buffer)
  await kv.put(windowKey, String(current + 1), {
    expirationTtl: windowSec * 2,
  });
  return true;
}

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

  // Rate limiting by client IP
  const clientIP = c.req.header("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `mcp:${subdomain}:${clientIP}`;
  const { limit, windowSec } = RATE_LIMIT.mcp;

  const allowed = await checkRateLimit(
    c.env.KV,
    rateLimitKey,
    limit,
    windowSec,
  );
  if (!allowed) {
    return c.json(
      { error: "rate_limit_exceeded", retry_after: windowSec },
      {
        status: 429,
        headers: {
          "Retry-After": String(windowSec),
        },
      },
    );
  }

  const service = await getServiceBySubdomain(subdomain, c.env.DB);

  if (!service) {
    return c.json({ error: "Service not found" }, 404);
  }

  if (service.status !== "online") {
    return c.json({ error: "Service offline" }, 503);
  }

  // OAuth Authentication (MCP SDK discovers via WWW-Authenticate header)
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    // No auth → 401 with WWW-Authenticate pointing to OAuth metadata
    // This is how MCP SDK discovers OAuth endpoints (RFC 9728)
    return c.json(
      { error: "unauthorized", error_description: "Authentication required" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }

  // Verify Bearer token
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    try {
      const authInfo = await verifyAccessToken(token);
      // Store auth info for payment handling (wallet address used by Tabs)
      c.set("authInfo", authInfo);

      // Enforce required scope for MCP endpoints
      // All MCP calls require tabs:spend (they involve payments)
      const requiredScope = "tabs:spend";
      if (!authInfo.scopes.includes(requiredScope)) {
        return c.json(
          {
            error: "insufficient_scope",
            error_description: `This resource requires the '${requiredScope}' scope`,
            scope: requiredScope,
          },
          {
            status: 403,
            headers: {
              "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${requiredScope}", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
            },
          },
        );
      }
    } catch {
      return c.json(
        {
          error: "invalid_token",
          error_description: "Invalid or expired access token",
        },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
          },
        },
      );
    }
  } else {
    return c.json(
      {
        error: "invalid_request",
        error_description: "Only Bearer authentication supported",
      },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
        },
      },
    );
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

  // Verify payment (amount, recipient, transaction data)
  const verified = await verifyPayment(
    paymentHeader,
    service.price,
    service.split_vault,
  );
  if (!verified.valid) {
    return c.json({ error: verified.error }, 400);
  }

  // Record payment for later split execution
  // Store tx signature and last payment time for audit
  await c.env.DB.prepare(
    `UPDATE services
     SET pending_balance = pending_balance + ?,
         total_calls = total_calls + 1,
         last_payment_tx = ?,
         last_payment_at = datetime('now')
     WHERE name = ?`,
  )
    .bind(service.price, verified.txSignature ?? null, subdomain)
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

/**
 * Payment verification for x402
 *
 * Validates:
 * 1. x402 version compatibility
 * 2. Payment amount >= expected
 * 3. Recipient matches split vault
 * 4. Transaction data exists
 * 5. Transaction confirmed on-chain via Tabs facilitator
 */
async function verifyPayment(
  paymentHeader: string,
  expectedAmount: string,
  recipientVault: string,
): Promise<{ valid: boolean; error?: string; txSignature?: string }> {
  try {
    const decoded = JSON.parse(atob(paymentHeader));

    // 1. Check x402 version
    if (decoded.x402Version !== 1) {
      return { valid: false, error: "Unsupported x402 version" };
    }

    const payload = decoded.payload;
    if (!payload) {
      return { valid: false, error: "Missing payment payload" };
    }

    // 2. Verify the payment amount meets minimum
    if (!payload.amount) {
      return { valid: false, error: "Missing payment amount" };
    }

    const paymentAmount = BigInt(payload.amount);
    const expected = BigInt(expectedAmount);
    if (paymentAmount < expected) {
      return {
        valid: false,
        error: `Insufficient payment: expected ${expectedAmount}, got ${payload.amount}`,
      };
    }

    // 3. Verify recipient matches the split vault
    if (payload.recipient && payload.recipient !== recipientVault) {
      return {
        valid: false,
        error: "Payment recipient does not match service vault",
      };
    }

    // 4. Verify transaction data exists
    if (!payload.transaction) {
      return { valid: false, error: "Missing transaction data" };
    }

    // 5. Verify on-chain via Tabs facilitator
    const verifyResponse = await fetch(
      "https://tabs.cascade.fyi/api/x402/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentHeader,
          expectedAmount,
          expectedRecipient: recipientVault,
        }),
      },
    );

    if (!verifyResponse.ok) {
      const errorText = await verifyResponse.text();
      return {
        valid: false,
        error: `Facilitator verification failed: ${errorText}`,
      };
    }

    const verification = (await verifyResponse.json()) as {
      confirmed: boolean;
      txSignature?: string;
      error?: string;
    };

    if (!verification.confirmed) {
      return {
        valid: false,
        error: verification.error || "Transaction not confirmed on-chain",
      };
    }

    return { valid: true, txSignature: verification.txSignature };
  } catch {
    return { valid: false, error: "Invalid payment header format" };
  }
}

export { app as gatewayApp };
