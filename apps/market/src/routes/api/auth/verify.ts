/**
 * POST /api/auth/verify
 *
 * Verify SIWS (Sign In With Solana) output and issue JWT session.
 *
 * 1. Retrieve stored SolanaSignInInput from KV
 * 2. Verify output using @solana/wallet-standard-util
 * 3. Issue JWT with 30-day expiration
 * 4. Set HTTP-only session cookie
 *
 * @see https://github.com/anza-xyz/wallet-standard
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { verifySignIn } from "@solana/wallet-standard-util";
import { SignJWT } from "jose";
import { env } from "cloudflare:workers";

/** Request body shape - arrays because JSON doesn't support Uint8Array */
interface VerifyRequestBody {
  nonce: string;
  output: {
    account: {
      address: string;
      publicKey: number[];
    };
    signedMessage: number[];
    signature: number[];
  };
}

export const Route = createFileRoute("/api/auth/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as VerifyRequestBody;

        // Validate request body
        if (
          !body.nonce ||
          !body.output?.account?.address ||
          !body.output?.account?.publicKey ||
          !body.output?.signedMessage ||
          !body.output?.signature
        ) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        // 1. Retrieve stored input (one-time use)
        const storedInput = await env.KV.get(`siws:${body.nonce}`);
        if (!storedInput) {
          return json({ error: "Invalid or expired nonce" }, { status: 400 });
        }
        await env.KV.delete(`siws:${body.nonce}`);

        const input: SolanaSignInInput = JSON.parse(storedInput);

        // 2. Reconstruct SolanaSignInOutput with Uint8Array types
        // (JSON serialization converts Uint8Array to number[])
        const output: SolanaSignInOutput = {
          account: {
            address: body.output.account.address,
            publicKey: new Uint8Array(body.output.account.publicKey),
            chains: ["solana:mainnet"],
            features: [],
          },
          signedMessage: new Uint8Array(body.output.signedMessage),
          signature: new Uint8Array(body.output.signature),
        };

        // 3. Verify with library (validates ALL fields + Ed25519 signature)
        const isValid = verifySignIn(input, output);
        if (!isValid) {
          return json(
            { error: "Invalid signature or message" },
            { status: 401 },
          );
        }

        // 4. Issue JWT (30 days)
        const secret = new TextEncoder().encode(env.JWT_SECRET);
        const token = await new SignJWT({ sub: output.account.address })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("30d")
          .sign(secret);

        // 5. Set session cookie server-side (HTTP-only, secure)
        setCookie("session", token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
        });

        return json({ address: output.account.address });
      },
    },
  },
});
