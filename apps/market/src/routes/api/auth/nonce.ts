/**
 * GET /api/auth/nonce
 *
 * Generate a cryptographically secure nonce for SIWS authentication.
 * Stores nonce in KV with 5-minute TTL.
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { nanoid } from "nanoid";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/api/auth/nonce")({
  server: {
    handlers: {
      GET: async () => {
        const nonce = nanoid(32);
        await env.KV.put(`nonce:${nonce}`, "1", { expirationTtl: 300 });
        return json({ nonce });
      },
    },
  },
});
