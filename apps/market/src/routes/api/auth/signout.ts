/**
 * POST /api/auth/signout
 *
 * Sign out - clears the session cookie.
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { deleteCookie } from "@tanstack/react-start/server";

export const Route = createFileRoute("/api/auth/signout")({
  server: {
    handlers: {
      POST: async () => {
        deleteCookie("session", { path: "/" });
        return json({ success: true });
      },
    },
  },
});
