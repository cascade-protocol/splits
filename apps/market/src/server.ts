/**
 * Cascade Market - Custom Server Entry
 *
 * Routes requests by hostname:
 * - cascade.fyi → TanStack Start (dashboard, server functions)
 * - *.mcps.cascade.fyi → Hono (gateway, x402 payments, tunnels)
 */

import handler from "@tanstack/react-start/server-entry";
import { gatewayApp } from "./gateway";

// Export Durable Object class for wrangler
export { TunnelRelay } from "./gateway/tunnel";

// Cloudflare env type
interface Env {
  DB: D1Database;
  TUNNEL_RELAY: DurableObjectNamespace;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Gateway: *.mcps.cascade.fyi → Hono (x402, tunnels)
    if (url.hostname.endsWith(".mcps.cascade.fyi")) {
      return gatewayApp.fetch(request, env, ctx);
    }

    // Market: cascade.fyi (or localhost) → TanStack Start
    return handler.fetch(request);
  },
};
