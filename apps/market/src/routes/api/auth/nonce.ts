/**
 * GET /api/auth/nonce
 *
 * Generate SIWS (Sign In With Solana) input for authentication.
 * Stores full SolanaSignInInput in KV with 5-minute TTL.
 *
 * @see https://github.com/anza-xyz/wallet-standard
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { nanoid } from "nanoid";
import { env } from "cloudflare:workers";
import type { SolanaSignInInput } from "@solana/wallet-standard-features";

export const Route = createFileRoute("/api/auth/nonce")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const nonce = nanoid(32);

        const input: SolanaSignInInput = {
          domain: url.host,
          statement: "Sign in to Cascade Market",
          uri: url.origin,
          version: "1",
          chainId: "solana:mainnet",
          nonce,
          issuedAt: new Date().toISOString(),
          resources: [`https://${url.host}`],
        };

        // Store full input for verification (5 min TTL)
        await env.KV.put(`siws:${nonce}`, JSON.stringify(input), {
          expirationTtl: 300,
        });

        return json(input);
      },
    },
  },
});
