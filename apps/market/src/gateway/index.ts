/**
 * Cascade Market Gateway
 *
 * Hono app for path-based MCP routing (per ADR-0004 §4.1)
 * Routes: /mcps/@namespace/name/* for MCP calls
 *         /sign for Tabs transaction signing
 *
 * Service data from ServiceBridge DO (not D1) - per ADR-0004 §4.7
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
import { getBase58Encoder } from "@solana/kit";
import { verifyAccessToken, type AuthInfo } from "../server/oauth";
import { signHandler } from "./sign";

/**
 * JSON-RPC 2.0 request (per MCP transport spec)
 * Uses _meta for x402 payment extension
 */
interface JSONRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: {
    _meta?: Record<string, unknown>;
    [key: string]: unknown;
  };
  id?: string | number | null;
}

/**
 * JSON-RPC 2.0 response (per MCP transport spec)
 * result._meta used for x402 settlement receipt
 */
interface JSONRPCResponse {
  jsonrpc: "2.0";
  result?: {
    _meta?: Record<string, unknown>;
    [key: string]: unknown;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

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
  DB: D1Database; // Only for OAuth
  KV: KVNamespace;
  SERVICE_BRIDGE: DurableObjectNamespace;
  JWT_SECRET: string;
  EXECUTOR_KEY: string;
  HELIUS_RPC_URL: string;
};

type Variables = {
  authInfo?: AuthInfo;
  servicePath?: string;
  serviceConfig?: ServiceConfig;
};

/**
 * Service config from ServiceBridge DO (attached from service token)
 * Per ADR-0004 §4.7: "Service price: Token → ServiceBridge DO (while CLI connected)"
 */
export interface ServiceConfig {
  namespace: string;
  name: string;
  splitConfig: string; // SplitConfig PDA (payTo)
  splitVault: string; // Vault ATA
  price: string; // USDC base units
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS for all routes
app.use("/*", cors());

// Secret validation middleware - fail fast if misconfigured
// Health check is exempt so monitoring can detect configuration issues
app.use("/*", async (c, next) => {
  // Skip validation for health check
  if (c.req.path === "/health") {
    return next();
  }

  const errors: string[] = [];

  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) {
    errors.push("JWT_SECRET must be at least 32 characters");
  }

  if (!c.env.EXECUTOR_KEY) {
    errors.push("EXECUTOR_KEY must be configured");
  } else {
    // Validate EXECUTOR_KEY is valid base58
    try {
      const encoder = getBase58Encoder();
      encoder.encode(c.env.EXECUTOR_KEY);
    } catch {
      errors.push("EXECUTOR_KEY must be valid base58");
    }
  }

  if (!c.env.HELIUS_RPC_URL) {
    errors.push("HELIUS_RPC_URL must be configured");
  }

  if (errors.length > 0) {
    console.error("Gateway configuration errors:", errors);
    return c.json(
      { error: "server_configuration_error", message: "Server misconfigured" },
      500,
    );
  }

  return next();
});

// Health check
app.get("/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

// Tabs signing endpoint (per ADR-0004 §5.4)
app.post("/sign", signHandler);

/**
 * Hono HTTP Adapter for x402HTTPResourceServer
 *
 * Supports MCP x402 transport: payment embedded in JSON-RPC body
 * at params._meta["x402/payment"] per mcp.md spec.
 */
class HonoHTTPAdapter implements HTTPAdapter {
  private bodyCache: unknown | undefined;
  private bodyParsed = false;

  constructor(private req: Request) {}

  /**
   * Parse request body as JSON (must call before x402 processing)
   * Body streams can only be read once, so we cache the result.
   */
  async parseBody(): Promise<void> {
    if (this.bodyParsed) return;
    try {
      const cloned = this.req.clone();
      this.bodyCache = await cloned.json();
    } catch {
      this.bodyCache = undefined;
    }
    this.bodyParsed = true;
  }

  /**
   * Get parsed body for MCP transport payment extraction
   */
  getBody(): unknown {
    return this.bodyCache;
  }

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

  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitator);
  resourceServer.registerExtension(bazaarResourceServerExtension);

  // Dynamic route for path-based MCP endpoints
  httpServer = new x402HTTPResourceServer(resourceServer, {
    "POST /mcps/:namespace/:name/*": {
      accepts: {
        scheme: "exact",
        payTo: (ctx: HTTPRequestContext) => {
          const config = (
            ctx as HTTPRequestContext & { serviceConfig?: ServiceConfig }
          ).serviceConfig;
          if (!config) throw new Error("Service not found in context");
          return config.splitConfig;
        },
        price: (ctx: HTTPRequestContext) => {
          const config = (
            ctx as HTTPRequestContext & { serviceConfig?: ServiceConfig }
          ).serviceConfig;
          if (!config) throw new Error("Service not found in context");
          return { asset: USDC_MINT, amount: config.price };
        },
        network: "solana:mainnet" as Network,
        maxTimeoutSeconds: 60,
      },
      description: "MCP service endpoint",
      mimeType: "application/json",
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

  await httpServer.initialize();

  const supported = await facilitator.getSupported();
  serverNetwork = supported.kinds[0]?.network ?? ("solana:mainnet" as Network);

  return { httpServer, network: serverNetwork };
}

/**
 * Check rate limit using KV with sliding window
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

  await kv.put(windowKey, String(current + 1), {
    expirationTtl: windowSec * 2,
  });
  return true;
}

/**
 * MCP endpoint with path-based routing
 * Route: /mcps/:namespace/:name/*
 * Example: /mcps/cascade/twitter/mcp
 */
app.all("/mcps/:namespace/:name/*", async (c) => {
  const namespace = c.req.param("namespace");
  const name = c.req.param("name");
  const servicePath = `@${namespace}/${name}`;

  // Rate limiting by client IP + service
  const clientIP = c.req.header("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `mcp:${servicePath}:${clientIP}`;
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
        headers: { "Retry-After": String(windowSec) },
      },
    );
  }

  // Get service config from ServiceBridge DO
  // DO stores config when supplier CLI connects with service token
  const bridgeId = c.env.SERVICE_BRIDGE.idFromName(servicePath);
  const bridge = c.env.SERVICE_BRIDGE.get(bridgeId);

  // Check if service is online (CLI connected)
  const configResponse = await bridge.fetch(
    new Request("http://internal/config"),
  );

  if (!configResponse.ok) {
    return c.json({ error: "Service offline", service: servicePath }, 503);
  }

  const serviceConfig = (await configResponse.json()) as ServiceConfig;
  c.set("servicePath", servicePath);
  c.set("serviceConfig", serviceConfig);

  // OAuth Authentication
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
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

  if (!authHeader.startsWith("Bearer ")) {
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

  const token = authHeader.slice(7);

  try {
    const authInfo = await verifyAccessToken(c.env.JWT_SECRET, token);
    c.set("authInfo", authInfo);

    // Enforce tabs:spend scope
    if (!authInfo.scopes.includes("tabs:spend")) {
      return c.json(
        {
          error: "insufficient_scope",
          error_description: "This resource requires the 'tabs:spend' scope",
          scope: "tabs:spend",
        },
        {
          status: 403,
          headers: {
            "WWW-Authenticate": `Bearer error="insufficient_scope", scope="tabs:spend", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
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

  // x402 payment processing with MCP transport support
  // Per mcp.md spec: payment in params._meta["x402/payment"]
  const { httpServer: x402Server } = await getX402Server();

  // Clone request for x402 processing (tunnel will read original)
  // Cast to standard Request (Cloudflare extends it with Cf properties)
  const clonedReq = c.req.raw.clone() as unknown as Request;
  const adapter = new HonoHTTPAdapter(clonedReq);
  await adapter.parseBody();

  // MCP transport: extract payment from JSON-RPC body
  const body = adapter.getBody() as JSONRPCRequest | undefined;
  const mcpPayment = body?.params?._meta?.["x402/payment"];
  const paymentHeader = mcpPayment
    ? JSON.stringify(mcpPayment)
    : c.req.header("X-PAYMENT") || c.req.header("Payment-Signature");

  const httpContext: HTTPRequestContext & { serviceConfig: ServiceConfig } = {
    adapter,
    path: adapter.getPath(),
    method: adapter.getMethod(),
    paymentHeader,
    serviceConfig,
  };

  const result: HTTPProcessResult =
    await x402Server.processHTTPRequest(httpContext);

  switch (result.type) {
    case "no-payment-required":
      break;

    case "payment-error": {
      // MCP transport: 402 as JSON-RPC error (HTTP 200 per spec)
      const jsonRpcError = {
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: {
          code: 402,
          message: "Payment required",
          data: result.response.body,
        },
      };
      return c.json(jsonRpcError, { status: 200 });
    }

    case "payment-verified": {
      // Strip payment metadata before forwarding to supplier
      // Clone body to avoid mutating original, typed as mutable JSONRPCRequest
      const forwardBody: JSONRPCRequest | undefined = body
        ? JSON.parse(JSON.stringify(body))
        : undefined;
      if (forwardBody?.params?._meta) {
        // x402/payment is an extension field on _meta (passthrough schema)
        const meta = forwardBody.params._meta as Record<string, unknown>;
        if (meta["x402/payment"]) {
          delete meta["x402/payment"];
          // Clean up empty _meta
          if (Object.keys(meta).length === 0) {
            delete forwardBody.params._meta;
          }
        }
      }

      // Forward to tunnel with cleaned body
      const forwardReq = new Request(c.req.raw.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: forwardBody ? JSON.stringify(forwardBody) : undefined,
      });
      const bridgeResponse = await bridge.fetch(forwardReq);

      // Only settle if JSON-RPC succeeded (P1-6: validate before settlement)
      if (bridgeResponse.ok) {
        // JSON-RPC response can be success (with result) or error
        const responseBody = (await bridgeResponse
          .clone()
          .json()) as JSONRPCResponse;

        // Only settle if no JSON-RPC error
        if (!responseBody.error && responseBody.result !== undefined) {
          const settleResult = await x402Server.processSettlement(
            result.paymentPayload,
            result.paymentRequirements,
          );

          if (settleResult.success) {
            // MCP transport: embed settlement in response _meta
            // result._meta uses passthrough schema, allowing extension fields
            const resultMeta = (responseBody.result._meta ?? {}) as Record<
              string,
              unknown
            >;
            resultMeta["x402/payment-response"] = {
              success: true,
              transaction: settleResult.headers["X-Payment-Transaction"],
              network: settleResult.headers["X-Payment-Network"],
            };
            responseBody.result._meta = resultMeta;

            return c.json(responseBody);
          }
          console.error("Settlement failed:", settleResult.errorReason);
        }

        // Return original response if settlement skipped or failed
        return c.json(responseBody);
      }

      return bridgeResponse;
    }
  }

  // Fallback: forward to bridge without payment
  return bridge.fetch(c.req.raw);
});

/**
 * Tunnel connection endpoint for supplier CLI
 * Route: /mcps/:namespace/:name/tunnel/connect
 */
app.get("/mcps/:namespace/:name/tunnel/connect", async (c) => {
  const namespace = c.req.param("namespace");
  const name = c.req.param("name");
  const servicePath = `@${namespace}/${name}`;

  const bridgeId = c.env.SERVICE_BRIDGE.idFromName(servicePath);
  const bridge = c.env.SERVICE_BRIDGE.get(bridgeId);
  return bridge.fetch(c.req.raw);
});

export { app as gatewayApp };
