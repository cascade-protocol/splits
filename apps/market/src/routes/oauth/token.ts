/**
 * POST /oauth/token
 *
 * OAuth Token Endpoint (RFC 6749)
 *
 * Handles token exchange (authorization_code) and refresh (refresh_token).
 * Used by MCP clients after user approves on /oauth/authorize.
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

import { exchangeCodeForTokens, refreshAccessToken } from "@/server/oauth";

interface CloudflareEnv {
  DB: D1Database;
  JWT_SECRET: string;
}

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Parse request body (OAuth spec requires application/x-www-form-urlencoded)
        const contentType = request.headers.get("content-type");
        let params: URLSearchParams;

        if (contentType?.includes("application/x-www-form-urlencoded")) {
          const body = await request.text();
          params = new URLSearchParams(body);
        } else if (contentType?.includes("application/json")) {
          // Also support JSON for convenience
          const body = (await request.json()) as Record<string, string>;
          params = new URLSearchParams(body);
        } else {
          return json(
            {
              error: "invalid_request",
              error_description:
                "Content-Type must be application/x-www-form-urlencoded or application/json",
            },
            { status: 400 },
          );
        }

        const grantType = params.get("grant_type");

        // Authorization code exchange
        if (grantType === "authorization_code") {
          const code = params.get("code");
          const codeVerifier = params.get("code_verifier");
          const clientId = params.get("client_id");
          const redirectUri = params.get("redirect_uri");

          if (!code || !codeVerifier || !clientId || !redirectUri) {
            return json(
              {
                error: "invalid_request",
                error_description:
                  "Missing required parameters: code, code_verifier, client_id, redirect_uri",
              },
              { status: 400 },
            );
          }

          const { DB, JWT_SECRET } = env as CloudflareEnv;
          const tokens = await exchangeCodeForTokens(DB, JWT_SECRET, {
            code,
            codeVerifier,
            clientId,
            redirectUri,
          });

          if (!tokens) {
            return json(
              {
                error: "invalid_grant",
                error_description: "Invalid or expired authorization code",
              },
              { status: 400 },
            );
          }

          return json({
            access_token: tokens.accessToken,
            token_type: "Bearer",
            expires_in: tokens.expiresIn,
            refresh_token: tokens.refreshToken,
            scope: tokens.scope,
          });
        }

        // Refresh token
        if (grantType === "refresh_token") {
          const refreshToken = params.get("refresh_token");
          const clientId = params.get("client_id");

          if (!refreshToken || !clientId) {
            return json(
              {
                error: "invalid_request",
                error_description:
                  "Missing required parameters: refresh_token, client_id",
              },
              { status: 400 },
            );
          }

          const { DB, JWT_SECRET } = env as CloudflareEnv;
          const tokens = await refreshAccessToken(DB, JWT_SECRET, {
            refreshToken,
            clientId,
          });

          if (!tokens) {
            return json(
              {
                error: "invalid_grant",
                error_description: "Invalid or expired refresh token",
              },
              { status: 400 },
            );
          }

          return json({
            access_token: tokens.accessToken,
            token_type: "Bearer",
            expires_in: tokens.expiresIn,
            scope: tokens.scope,
          });
        }

        return json(
          {
            error: "unsupported_grant_type",
            error_description:
              "Only authorization_code and refresh_token are supported",
          },
          { status: 400 },
        );
      },
    },
  },
});
