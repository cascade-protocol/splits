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

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Gateway: /mcps/* and /sign → Hono (x402, tunnels, signing)
    if (url.pathname.startsWith("/mcps/") || url.pathname === "/sign") {
      return gatewayApp.fetch(request, env, ctx);
    }

    // Market: everything else → TanStack Start
    return handler.fetch(request);
  },
};
