/**
 * Cascade Market - OAuth Provider Entry Point
 *
 * Uses @cloudflare/workers-oauth-provider to wrap the Worker (per ADR-0004 §4.5):
 * - /mcps/*, /sign → apiHandler (protected, requires Bearer token)
 * - /* → defaultHandler (TanStack Start + OAuth consent)
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import handler from "@tanstack/react-start/server-entry";
import { gatewayApp } from "./gateway";
import { consentApp } from "./gateway/consent";

// Export Durable Object class for wrangler
export { TunnelRelay } from "./gateway/tunnel";

/**
 * Auth props set during completeAuthorization, available as ctx.props
 */
export interface AuthProps {
  walletAddress: string;
}

/**
 * API Handler for protected routes (/mcps/*, /sign)
 * OAuthProvider validates Bearer token before calling this handler.
 * Props are available on ctx.props after validation.
 */
const apiHandler = {
  async fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContext & { props?: AuthProps },
  ) {
    // Pass props through env for Hono handlers
    const envWithAuth = { ...(env as object), AUTH_PROPS: ctx.props };
    return gatewayApp.fetch(request, envWithAuth, ctx);
  },
};

/**
 * Default Handler for non-API routes
 */
const defaultHandler = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // OAuth consent flow
    if (url.pathname === "/oauth/authorize") {
      // @ts-expect-error - env is unknown from OAuthProvider, consentApp expects AppEnv
      return consentApp.fetch(request, env, ctx);
    }

    // Everything else → TanStack Start
    return handler.fetch(request);
  },
};

export default new OAuthProvider({
  apiRoute: ["/mcps/", "/sign"],
  // @ts-expect-error - OAuthProvider injects props at runtime, types don't reflect this
  apiHandler,
  defaultHandler,

  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",

  scopesSupported: ["tabs:spend", "mcps:access"],
  accessTokenTTL: 3600,
  refreshTokenTTL: 30 * 24 * 60 * 60,
});
