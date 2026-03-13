/**
 * GET /api/auth/session
 *
 * Get current session from JWT cookie.
 * Returns authenticated state and address if valid.
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { jwtVerify } from "jose";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/api/auth/session")({
  server: {
    handlers: {
      GET: async () => {
        const token = getCookie("session");

        if (!token) {
          return json({ authenticated: false, address: null });
        }

        try {
          const secret = new TextEncoder().encode(env.JWT_SECRET);
          const { payload } = await jwtVerify(token, secret);
          return json({ authenticated: true, address: payload.sub as string });
        } catch {
          return json({ authenticated: false, address: null });
        }
      },
    },
  },
});
