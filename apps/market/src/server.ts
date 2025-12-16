/**
 * Cascade Market - Custom Server Entry
 *
 * Routes requests by path (per ADR-0004 §4.1):
 * - /mcps/* → Hono Gateway (x402 payments, tunnels)
 * - /sign → Hono Gateway (Tabs co-signing)
 * - /* → TanStack Start (dashboard, server functions)
 */

import handler from "@tanstack/react-start/server-entry";
import { gatewayApp } from "./gateway";

// Export Durable Object class for wrangler
export { TunnelRelay } from "./gateway/tunnel";

// Cloudflare env type
interface Env {
  DB: D1Database;
  TUNNEL_RELAY: DurableObjectNamespace;
  JWT_SECRET: string;
  EXECUTOR_KEY: string;
  HELIUS_RPC_URL: string;
}

/**
 * RFC 8414 OAuth Authorization Server Metadata
 * https://datatracker.ietf.org/doc/html/rfc8414
 *
 * Enables MCP clients to discover OAuth endpoints automatically.
 */
const OAUTH_METADATA = {
  issuer: "https://market.cascade.fyi",
  authorization_endpoint: "https://market.cascade.fyi/oauth/authorize",
  token_endpoint: "https://market.cascade.fyi/oauth/token",
  scopes_supported: ["tabs:spend", "mcps:access"],
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
} as const;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // RFC 8414: OAuth metadata discovery
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return new Response(JSON.stringify(OAUTH_METADATA), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gateway: /mcps/* and /sign → Hono (x402, tunnels, signing)
    if (url.pathname.startsWith("/mcps/") || url.pathname === "/sign") {
      return gatewayApp.fetch(request, env, ctx);
    }

    // Market: everything else → TanStack Start
    return handler.fetch(request);
  },
};
