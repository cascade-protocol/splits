/**
 * OAuth Authorization Server Metadata (RFC 8414)
 *
 * Describes the OAuth endpoints and capabilities of this authorization server.
 * MCP SDK fetches this after discovering the auth server from oauth-protected-resource.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")(
  {
    server: {
      handlers: {
        GET: () => {
          return Response.json({
            // Issuer identifier
            issuer: "https://market.cascade.fyi",
            // Authorization endpoint (user consent screen)
            authorization_endpoint:
              "https://market.cascade.fyi/oauth/authorize",
            // Token endpoint (code exchange)
            token_endpoint: "https://market.cascade.fyi/oauth/token",
            // Supported scopes
            scopes_supported: ["tabs:spend", "services:read"],
            // Supported response types
            response_types_supported: ["code"],
            // Supported grant types
            grant_types_supported: ["authorization_code", "refresh_token"],
            // PKCE code challenge methods (S256 is required)
            code_challenge_methods_supported: ["S256"],
            // Token endpoint auth methods
            token_endpoint_auth_methods_supported: [
              "client_secret_post",
              "none",
            ],
            // URL-based client IDs supported (SEP-991)
            // Simpler than dynamic client registration
            client_id_metadata_document_supported: true,
          });
        },
      },
    },
  },
);
