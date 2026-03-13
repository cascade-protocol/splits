/**
 * OAuth Protected Resource Metadata (RFC 9728)
 *
 * This endpoint is discovered by MCP SDK when it receives a 401 response
 * with WWW-Authenticate header pointing here.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: () => {
        return Response.json({
          // The resource this metadata describes
          resource: "https://market.cascade.fyi",
          // Authorization servers that can issue tokens for this resource
          authorization_servers: ["https://market.cascade.fyi"],
          // Scopes supported by this resource
          scopes_supported: ["tabs:spend", "services:read"],
          // Human-readable resource name
          resource_name: "Cascade Market",
          // Documentation URL
          resource_documentation: "https://market.cascade.fyi/docs",
        });
      },
    },
  },
});
