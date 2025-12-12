/**
 * POST /api/auth/verify
 *
 * Verify SIWS (Sign In With Solana) signature and issue JWT session.
 *
 * 1. Check nonce exists and delete (one-time use)
 * 2. Verify Ed25519 signature using @solana/kit
 * 3. Issue JWT with 30-day expiration
 * 4. Set HTTP-only session cookie
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import {
  getPublicKeyFromAddress,
  type Address,
  verifySignature,
  signatureBytes,
} from "@solana/kit";
import { SignJWT } from "jose";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/api/auth/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json();

        // Validate request body
        const { signedMessage, signature, address, nonce } = body as {
          signedMessage: string;
          signature: string;
          address: string;
          nonce: string;
        };

        if (!signedMessage || !signature || !address || !nonce) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        // 1. Check nonce exists and delete (one-time use)
        const nonceExists = await env.KV.get(`nonce:${nonce}`);
        if (!nonceExists) {
          return json({ error: "Invalid or expired nonce" }, { status: 400 });
        }
        await env.KV.delete(`nonce:${nonce}`);

        // 2. Decode signature and message from base64
        const sigBytes = Uint8Array.from(atob(signature), (c) =>
          c.charCodeAt(0),
        );
        const msgBytes = Uint8Array.from(atob(signedMessage), (c) =>
          c.charCodeAt(0),
        );

        // 3. Get CryptoKey from Solana address for signature verification
        const publicKey = await getPublicKeyFromAddress(address as Address);

        // 4. Convert to SignatureBytes type and verify
        const sig = signatureBytes(sigBytes);
        const isValid = await verifySignature(publicKey, sig, msgBytes);

        if (!isValid) {
          return json({ error: "Invalid signature" }, { status: 401 });
        }

        // 5. Verify nonce is in the signed message (prevent replay attacks)
        const messageText = new TextDecoder().decode(msgBytes);
        if (!messageText.includes(`Nonce: ${nonce}`)) {
          return json(
            { error: "Nonce mismatch in signed message" },
            { status: 400 },
          );
        }

        // 6. Issue JWT (30 days)
        const secret = new TextEncoder().encode(env.JWT_SECRET);
        const token = await new SignJWT({ sub: address })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("30d")
          .sign(secret);

        // 7. Set session cookie server-side (HTTP-only, secure)
        setCookie("session", token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
        });

        return json({ address });
      },
    },
  },
});
