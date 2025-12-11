/**
 * Service Token Generation and Verification
 *
 * Tokens encode service metadata for CLI authentication.
 * Format: csc_<base64url(JSON)>
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Token payload structure
export interface ServiceToken {
  serviceId: string;
  splitConfig: string; // PDA address
  splitVault: string; // Vault ATA (payTo)
  price: string; // USDC base units
  createdAt: number;
  signature: string; // HMAC signature
}

// Validation schemas
const createTokenSchema = z.object({
  serviceId: z.string().uuid(),
  splitConfig: z.string().min(32),
  splitVault: z.string().min(32),
  price: z.string().regex(/^\d+$/),
});

const verifyTokenSchema = z.object({
  token: z.string().startsWith("csc_"),
});

// Get secret for HMAC signing
const getTokenSecret = async (): Promise<string> => {
  // In production, this would come from env
  // For MVP, using a placeholder that should be set in wrangler.jsonc
  const { env } = await import("cloudflare:workers");
  const secret = (env as { TOKEN_SECRET?: string }).TOKEN_SECRET;
  if (!secret) {
    // Development fallback - DO NOT USE IN PRODUCTION
    console.warn("TOKEN_SECRET not set, using development fallback");
    return "cascade-market-dev-secret-change-in-production";
  }
  return secret;
};

/**
 * Create HMAC signature for token payload
 */
async function createSignature(
  payload: Omit<ServiceToken, "signature">,
): Promise<string> {
  const secret = await getTokenSecret();
  const data = JSON.stringify({
    serviceId: payload.serviceId,
    splitConfig: payload.splitConfig,
    splitVault: payload.splitVault,
    price: payload.price,
    createdAt: payload.createdAt,
  });

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Verify HMAC signature
 */
async function verifySignature(payload: ServiceToken): Promise<boolean> {
  const expectedSignature = await createSignature({
    serviceId: payload.serviceId,
    splitConfig: payload.splitConfig,
    splitVault: payload.splitVault,
    price: payload.price,
    createdAt: payload.createdAt,
  });
  return payload.signature === expectedSignature;
}

/**
 * Encode a service token
 * Format: csc_<base64url(JSON)>
 */
export function encodeServiceToken(payload: ServiceToken): string {
  const json = JSON.stringify(payload);
  const base64 = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `csc_${base64}`;
}

/**
 * Decode a service token
 * Returns null if invalid format
 */
export function decodeServiceToken(token: string): ServiceToken | null {
  if (!token.startsWith("csc_")) {
    return null;
  }

  try {
    const base64 = token.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json) as ServiceToken;

    // Validate required fields
    if (
      !payload.serviceId ||
      !payload.splitConfig ||
      !payload.splitVault ||
      !payload.price ||
      !payload.createdAt ||
      !payload.signature
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify a service token's signature
 */
export async function verifyServiceToken(token: string): Promise<boolean> {
  const payload = decodeServiceToken(token);
  if (!payload) {
    return false;
  }
  return verifySignature(payload);
}

/**
 * Server function to create a new service token
 */
export const createServiceToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createTokenSchema.parse(data))
  .handler(async (ctx) => {
    const { data } = ctx;
    const payload: Omit<ServiceToken, "signature"> = {
      serviceId: data.serviceId,
      splitConfig: data.splitConfig,
      splitVault: data.splitVault,
      price: data.price,
      createdAt: Date.now(),
    };

    const signature = await createSignature(payload);
    const token: ServiceToken = { ...payload, signature };

    return {
      token: encodeServiceToken(token),
      expiresAt: null, // Tokens don't expire for MVP
    };
  });

/**
 * Server function to verify a token
 */
export const verifyToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifyTokenSchema.parse(data))
  .handler(async (ctx) => {
    const { data } = ctx;
    const payload = decodeServiceToken(data.token);
    if (!payload) {
      return { valid: false, error: "Invalid token format" };
    }

    const signatureValid = await verifySignature(payload);
    if (!signatureValid) {
      return { valid: false, error: "Invalid signature" };
    }

    return {
      valid: true,
      payload: {
        serviceId: payload.serviceId,
        splitConfig: payload.splitConfig,
        splitVault: payload.splitVault,
        price: payload.price,
        createdAt: payload.createdAt,
      },
    };
  });
