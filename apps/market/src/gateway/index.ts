/**
 * Cascade Market Gateway
 *
 * Hono app for *.mcps.cascade.fyi
 * Handles OAuth authentication and x402 payments, forwards to tunnels
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Network } from "@x402/core/types";
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  x402HTTPResourceServer,
  type HTTPAdapter,
  type HTTPRequestContext,
  type HTTPProcessResult,
} from "@x402/core/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { verifyAccessToken, type AuthInfo } from "../server/oauth";

// USDC mint on Solana mainnet
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Base URL for OAuth metadata
const BASE_URL = "https://market.cascade.fyi";

// Rate limit config: requests per window
const RATE_LIMIT = {
  mcp: { limit: 60, windowSec: 60 }, // 60 req/min per IP for MCP
};

// Cascade facilitator URL (x402 v2)
const FACILITATOR_URL = "https://facilitator.cascade.fyi";

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  TUNNEL_RELAY: DurableObjectNamespace;
  JWT_SECRET: string;
};

type Variables = {
  authInfo?: AuthInfo;
  subdomain?: string;
  service?: ServiceRecord;
};

interface ServiceRecord {
  id: string;
  name: string;
  split_config: string; // SplitConfig PDA (used as payTo)
  split_vault: string; // Vault ATA (where funds land)
  price: string;
  status: string;
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS for all routes
app.use("/*", cors());

// Health check
app.get("/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

/**
 * Discovery endpoint - lists available MCP services
 * Returns service URLs and metadata for direct browsing (not via facilitator)
 */
app.get("/discovery/resources", async (c) => {
  const limit = Math.min(
    Number.parseInt(c.req.query("limit") || "50", 10),
    100,
  );
  const offset = Number.parseInt(c.req.query("offset") || "0", 10);

  const services = await c.env.DB.prepare(
    `SELECT name, price, split_config, status
     FROM services
     WHERE status = 'online'
     ORDER BY total_calls DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<{
      name: string;
      price: string;
      split_config: string;
      status: string;
    }>();

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM services WHERE status = 'online'",
  ).first<{ count: number }>();

  return c.json({
    resources: services.results.map((s) => ({
      url: `https://${s.name}.mcps.cascade.fyi/mcp`,
      type: "mcp",
      metadata: {
        name: s.name,
        price: s.price,
        payTo: s.split_config,
        network: "solana:mainnet",
        asset: USDC_MINT,
      },
    })),
    total: total?.count ?? 0,
    limit,
    offset,
  });
});

/**
 * Hono HTTP Adapter for x402HTTPResourceServer
 * Implements the HTTPAdapter interface for Hono context
 */
class HonoHTTPAdapter implements HTTPAdapter {
  constructor(private req: Request) {}

  getHeader(name: string): string | undefined {
    return this.req.headers.get(name) ?? undefined;
  }

  getMethod(): string {
    return this.req.method;
  }

  getPath(): string {
    const url = new URL(this.req.url);
    return url.pathname;
  }

  getUrl(): string {
    return this.req.url;
  }

  getAcceptHeader(): string {
    return this.req.headers.get("Accept") ?? "";
  }

  getUserAgent(): string {
    return this.req.headers.get("User-Agent") ?? "";
  }

  getQueryParams(): Record<string, string | string[]> {
    const url = new URL(this.req.url);
    const params: Record<string, string | string[]> = {};
    for (const [key, value] of url.searchParams.entries()) {
      const existing = params[key];
      if (existing) {
        params[key] = Array.isArray(existing)
          ? [...existing, value]
          : [existing, value];
      } else {
        params[key] = value;
      }
    }
    return params;
  }

  getQueryParam(name: string): string | string[] | undefined {
    const url = new URL(this.req.url);
    const values = url.searchParams.getAll(name);
    if (values.length === 0) return undefined;
    if (values.length === 1) return values[0];
    return values;
  }
}

// Initialize x402 HTTP server (cached per isolate)
let httpServer: x402HTTPResourceServer | null = null;
let serverNetwork: Network | null = null;

async function getX402Server(): Promise<{
  httpServer: x402HTTPResourceServer;
  network: Network;
}> {
  if (httpServer && serverNetwork) {
    return { httpServer, network: serverNetwork };
  }

  // Create facilitator client
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

  // Create resource server with Bazaar extension for discovery
  const resourceServer = new x402ResourceServer(facilitator);
  resourceServer.registerExtension(bazaarResourceServerExtension);

  // Create HTTP server with dynamic route
  // Note: payTo and price are resolved dynamically per-request via context
  httpServer = new x402HTTPResourceServer(resourceServer, {
    "POST /mcp/*": {
      accepts: {
        scheme: "exact",
        // Dynamic payTo - resolved from service.split_config
        payTo: (ctx: HTTPRequestContext) => {
          const service = (
            ctx as HTTPRequestContext & { service?: ServiceRecord }
          ).service;
          if (!service) throw new Error("Service not found in context");
          return service.split_config;
        },
        // Dynamic price - resolved from service.price
        price: (ctx: HTTPRequestContext) => {
          const service = (
            ctx as HTTPRequestContext & { service?: ServiceRecord }
          ).service;
          if (!service) throw new Error("Service not found in context");
          return { asset: USDC_MINT, amount: service.price };
        },
        network: "solana:mainnet" as Network,
        maxTimeoutSeconds: 60,
      },
      description: "MCP service endpoint",
      mimeType: "application/json",
      // Bazaar discovery extension - declares MCP JSON-RPC interface
      extensions: {
        bazaar: {
          info: {
            input: {
              type: "http" as const,
              method: "POST" as const,
              bodyType: "json" as const,
              body: {
                jsonrpc: "2.0",
                method: "string",
                params: {},
                id: "string|number",
              },
            },
            output: {
              type: "application/json",
              example: { jsonrpc: "2.0", result: {}, id: "1" },
            },
          },
        },
      },
    },
  });

  // Initialize (fetches facilitator support info)
  await httpServer.initialize();

  // Cache the network from facilitator
  const supported = await facilitator.getSupported();
  serverNetwork = supported.kinds[0]?.network ?? ("solana:mainnet" as Network);

  return { httpServer, network: serverNetwork };
}

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
      "SELECT id, name, split_config, split_vault, price, status FROM services WHERE name = ?",
    )
    .bind(subdomain)
    .first<ServiceRecord>();
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

  // Store for later use
  c.set("subdomain", subdomain);
  c.set("service", service);

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
      const authInfo = await verifyAccessToken(c.env.JWT_SECRET, token);
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

  // Initialize x402 server (cached)
  const { httpServer: x402Server } = await getX402Server();

  // Create HTTP context for x402
  const adapter = new HonoHTTPAdapter(c.req.raw);
  const paymentHeader =
    c.req.header("X-PAYMENT") || c.req.header("Payment-Signature");

  // Extend context with service for dynamic payTo/price resolution
  const httpContext: HTTPRequestContext & { service: ServiceRecord } = {
    adapter,
    path: adapter.getPath(),
    method: adapter.getMethod(),
    paymentHeader,
    service,
  };

  // Process payment request
  const result: HTTPProcessResult =
    await x402Server.processHTTPRequest(httpContext);

  switch (result.type) {
    case "no-payment-required":
      // Should not happen for our routes, but forward anyway
      break;

    case "payment-error":
      // Return 402 with payment requirements or error
      return new Response(
        result.response.isHtml
          ? (result.response.body as string)
          : JSON.stringify(result.response.body),
        {
          status: result.response.status,
          headers: result.response.headers,
        },
      );

    case "payment-verified": {
      // Forward to tunnel
      const tunnelId = c.env.TUNNEL_RELAY.idFromName(subdomain);
      const tunnel = c.env.TUNNEL_RELAY.get(tunnelId);
      const tunnelResponse = await tunnel.fetch(c.req.raw);

      // Settle payment after successful tunnel response
      if (tunnelResponse.ok) {
        const settleResult = await x402Server.processSettlement(
          result.paymentPayload,
          result.paymentRequirements,
        );

        if (settleResult.success) {
          // Record payment for later split execution
          await c.env.DB.prepare(
            `UPDATE services
             SET pending_balance = pending_balance + ?,
                 total_calls = total_calls + 1,
                 total_revenue = total_revenue + ?,
                 last_payment_tx = ?,
                 last_payment_at = datetime('now')
             WHERE name = ?`,
          )
            .bind(
              service.price,
              service.price,
              settleResult.transaction ?? null,
              subdomain,
            )
            .run();

          // Add settlement headers to response
          const responseHeaders = new Headers(tunnelResponse.headers);
          for (const [key, value] of Object.entries(settleResult.headers)) {
            responseHeaders.set(key, value);
          }

          return new Response(tunnelResponse.body, {
            status: tunnelResponse.status,
            headers: responseHeaders,
          });
        }
        // Settlement failed but tunnel succeeded - return tunnel response
        // (payment may have been partially processed)
        console.error("Settlement failed:", settleResult.errorReason);
      }

      return tunnelResponse;
    }
  }

  // Fallback: forward to tunnel without payment
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

export { app as gatewayApp };
