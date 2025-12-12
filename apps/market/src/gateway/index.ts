/**
 * Cascade Market Gateway
 *
 * Hono app for *.mcps.cascade.fyi
 * Handles OAuth authentication and x402 payments, forwards to tunnels
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type {
  PaymentPayload,
  PaymentRequirements,
  Network,
} from "@x402/core/types";
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

  // Check for payment header (x402 spec: X-PAYMENT or Payment-Signature)
  const paymentHeader =
    c.req.header("X-PAYMENT") || c.req.header("Payment-Signature");

  // Get facilitator info for fee payer
  let facilitatorInfo: { feePayer: string; network: Network };
  try {
    facilitatorInfo = await getFacilitatorInfo();
  } catch {
    return c.json({ error: "Facilitator unavailable" }, 503);
  }

  // Construct payment requirements
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: facilitatorInfo.network,
    amount: service.price,
    asset: USDC_MINT,
    payTo: service.split_vault,
    maxTimeoutSeconds: 60,
    extra: {
      feePayer: facilitatorInfo.feePayer,
      facilitator: FACILITATOR_URL,
    },
  };

  if (!paymentHeader) {
    // Return 402 with payment requirements (x402 v2 spec)
    return c.json(
      {
        x402Version: 2,
        error: "Payment required",
        accepts: [
          {
            ...requirements,
            maxAmountRequired: requirements.amount,
            resource: `https://${subdomain}.mcps.market.cascade.fyi/mcp`,
          },
        ],
      },
      402,
    );
  }

  // Step 1: Verify payment with facilitator
  const verified = await verifyPayment(paymentHeader, requirements);
  if (!verified.valid || !verified.payload) {
    return c.json({ error: verified.error }, 400);
  }

  // Step 2: Settle payment (signs and broadcasts transaction)
  const settled = await settlePayment(verified.payload, requirements);
  if (!settled.success) {
    return c.json({ error: settled.error || "Settlement failed" }, 402);
  }

  // Record payment for later split execution
  // Store tx signature and last payment time for audit
  await c.env.DB.prepare(
    `UPDATE services
     SET pending_balance = pending_balance + ?,
         total_calls = total_calls + 1,
         total_revenue = total_revenue + ?,
         last_payment_tx = ?,
         last_payment_at = datetime('now')
     WHERE name = ?`,
  )
    .bind(service.price, service.price, settled.txSignature ?? null, subdomain)
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

// Cascade facilitator URL (x402 v2)
const FACILITATOR_URL = "https://facilitator.cascade.fyi";

// Cached facilitator info
let cachedFacilitatorInfo: { feePayer: string; network: Network } | null = null;

/**
 * Get facilitator capabilities (cached)
 */
async function getFacilitatorInfo(): Promise<{
  feePayer: string;
  network: Network;
}> {
  if (cachedFacilitatorInfo) {
    return cachedFacilitatorInfo;
  }

  const response = await fetch(`${FACILITATOR_URL}/supported`);
  const data = (await response.json()) as {
    kinds: Array<{
      network: Network;
      extra?: { feePayer?: string };
    }>;
  };

  const kind = data.kinds[0];
  if (!kind?.extra?.feePayer) {
    throw new Error("Facilitator missing fee payer");
  }

  cachedFacilitatorInfo = {
    feePayer: kind.extra.feePayer,
    network: kind.network,
  };

  return cachedFacilitatorInfo;
}

/**
 * Verify payment with Cascade facilitator (x402 v2)
 *
 * Validates:
 * 1. x402 version compatibility
 * 2. Payment payload has required fields
 * 3. Facilitator verifies transaction (amount, recipient, signatures)
 */
async function verifyPayment(
  paymentHeader: string,
  requirements: PaymentRequirements,
): Promise<{
  valid: boolean;
  error?: string;
  payload?: PaymentPayload;
  payer?: string;
}> {
  try {
    const decoded = JSON.parse(atob(paymentHeader)) as PaymentPayload;

    // 1. Check x402 version
    if (decoded.x402Version !== 2) {
      return { valid: false, error: "Unsupported x402 version" };
    }

    // 2. Check payload has transaction
    if (!decoded.payload?.transaction) {
      return { valid: false, error: "Missing transaction in payment payload" };
    }

    // 3. Check scheme/network match
    if (
      decoded.accepted.scheme !== requirements.scheme ||
      decoded.accepted.network !== requirements.network
    ) {
      return { valid: false, error: "Scheme or network mismatch" };
    }

    // 4. Verify with facilitator
    const verifyResponse = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: decoded,
        paymentRequirements: requirements,
      }),
    });

    const verification = (await verifyResponse.json()) as {
      isValid: boolean;
      invalidReason?: string;
      payer?: string;
    };

    if (!verification.isValid) {
      return {
        valid: false,
        error: verification.invalidReason || "Verification failed",
      };
    }

    return { valid: true, payload: decoded, payer: verification.payer };
  } catch {
    return { valid: false, error: "Invalid payment header format" };
  }
}

/**
 * Settle payment with Cascade facilitator (x402 v2)
 *
 * Signs and broadcasts the transaction to Solana.
 * Returns the transaction signature on success.
 */
async function settlePayment(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<{ success: boolean; txSignature?: string; error?: string }> {
  try {
    const settleResponse = await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
    });

    const result = (await settleResponse.json()) as {
      success: boolean;
      transaction?: string;
      errorReason?: string;
    };

    if (!result.success) {
      return {
        success: false,
        error: result.errorReason || "Settlement failed",
      };
    }

    return { success: true, txSignature: result.transaction };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Settlement error",
    };
  }
}

export { app as gatewayApp };
