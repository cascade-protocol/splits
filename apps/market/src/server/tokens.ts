/**
 * Service Token Generation and Verification
 *
 * Tokens encode service metadata for CLI authentication.
 * Format: csc_<base64url(JSON)>
 *
 * Note: Pure functions accept secrets as parameters.
 * Server functions that access cloudflare:workers env should be defined
 * in route files following TanStack Start patterns.
 */

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
// Note: serviceId is now derived from splitConfig (chain is source of truth)
export const createTokenSchema = z.object({
  splitConfig: z.string().min(32).max(44), // base58 Solana address
  splitVault: z.string().min(32).max(44),
  price: z.string().regex(/^\d+$/),
});

export const verifyTokenSchema = z.object({
  token: z.string().startsWith("csc_"),
});

/**
 * Create HMAC signature for token payload
 */
async function createSignature(
  tokenSecret: string,
  payload: Omit<ServiceToken, "signature">,
): Promise<string> {
  const data = JSON.stringify({
    serviceId: payload.serviceId,
    splitConfig: payload.splitConfig,
    splitVault: payload.splitVault,
    price: payload.price,
    createdAt: payload.createdAt,
  });

  const encoder = new TextEncoder();
  const keyData = encoder.encode(tokenSecret);
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
async function verifySignature(
  tokenSecret: string,
  payload: ServiceToken,
): Promise<boolean> {
  const expectedSignature = await createSignature(tokenSecret, {
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
export async function verifyServiceToken(
  tokenSecret: string,
  token: string,
): Promise<boolean> {
  const payload = decodeServiceToken(token);
  if (!payload) {
    return false;
  }
  return verifySignature(tokenSecret, payload);
}

/**
 * Generate a signed service token
 * Used by server functions that have access to TOKEN_SECRET
 */
export async function generateServiceToken(
  tokenSecret: string,
  data: {
    serviceId: string;
    splitConfig: string;
    splitVault: string;
    price: string;
  },
): Promise<{ token: string; expiresAt: null }> {
  const payload: Omit<ServiceToken, "signature"> = {
    serviceId: data.serviceId,
    splitConfig: data.splitConfig,
    splitVault: data.splitVault,
    price: data.price,
    createdAt: Date.now(),
  };

  const signature = await createSignature(tokenSecret, payload);
  const token: ServiceToken = { ...payload, signature };

  return {
    token: encodeServiceToken(token),
    expiresAt: null, // Tokens don't expire for MVP
  };
}

/**
 * Verify a token and return its payload
 * Used by server functions that have access to TOKEN_SECRET
 */
export async function verifyTokenPayload(
  tokenSecret: string,
  token: string,
): Promise<
  | { valid: true; payload: Omit<ServiceToken, "signature"> }
  | { valid: false; error: string }
> {
  const payload = decodeServiceToken(token);
  if (!payload) {
    return { valid: false, error: "Invalid token format" };
  }

  const signatureValid = await verifySignature(tokenSecret, payload);
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
}
