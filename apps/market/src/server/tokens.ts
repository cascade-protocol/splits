/**
 * Service Token Generation and Verification
 *
 * Per ADR-0004 §4.8: Tokens encode service metadata for CLI authentication.
 * Format: csc_<base64url(JSON)>
 *
 * Note: Pure functions accept secrets as parameters.
 * Server functions that access cloudflare:workers env should be defined
 * in route files following TanStack Start patterns.
 */

import { z } from "zod";

// 30 days in milliseconds
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Service Token payload structure (per ADR-0004 §4.8)
 */
export interface ServiceToken {
  namespace: string; // e.g., "cascade"
  name: string; // e.g., "twitter"
  splitConfig: string; // SplitConfig PDA
  splitVault: string; // Vault ATA (payTo)
  price: number; // USDC base units per call
  createdAt: number; // Unix timestamp (ms)
  expiresAt: number; // Unix timestamp (ms) - default: createdAt + 30 days
  signature: string; // HMAC signature
}

// Validation schemas
export const createTokenSchema = z.object({
  namespace: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9-]+$/),
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9-]+$/),
  splitConfig: z.string().min(32).max(44), // base58 Solana address
  splitVault: z.string().min(32).max(44),
  price: z.number().int().positive(),
});

export const verifyTokenSchema = z.object({
  token: z.string().startsWith("csc_"),
});

/**
 * Create HMAC signature for token payload
 * Signs all fields except signature itself
 */
async function createSignature(
  tokenSecret: string,
  payload: Omit<ServiceToken, "signature">,
): Promise<string> {
  const data = JSON.stringify({
    namespace: payload.namespace,
    name: payload.name,
    splitConfig: payload.splitConfig,
    splitVault: payload.splitVault,
    price: payload.price,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
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
 * Constant-time string comparison to prevent timing attacks.
 *
 * The === operator short-circuits on first byte mismatch, leaking info
 * about valid prefixes. This function compares all bytes regardless of
 * early mismatches, making response time constant for any input.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify HMAC signature using timing-safe comparison
 */
async function verifySignature(
  tokenSecret: string,
  payload: ServiceToken,
): Promise<boolean> {
  const expectedSignature = await createSignature(tokenSecret, {
    namespace: payload.namespace,
    name: payload.name,
    splitConfig: payload.splitConfig,
    splitVault: payload.splitVault,
    price: payload.price,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
  });

  return constantTimeEqual(payload.signature, expectedSignature);
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
      !payload.namespace ||
      !payload.name ||
      !payload.splitConfig ||
      !payload.splitVault ||
      typeof payload.price !== "number" ||
      !payload.createdAt ||
      !payload.expiresAt ||
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
 * Check if a token is expired
 */
export function isTokenExpired(payload: ServiceToken): boolean {
  return payload.expiresAt < Date.now();
}

/**
 * Generate a signed service token
 * Used by server functions that have access to TOKEN_SECRET
 */
export async function generateServiceToken(
  tokenSecret: string,
  data: {
    namespace: string;
    name: string;
    splitConfig: string;
    splitVault: string;
    price: number;
  },
): Promise<{ token: string; expiresAt: number }> {
  const now = Date.now();
  const expiresAt = now + TOKEN_TTL_MS;

  const payload: Omit<ServiceToken, "signature"> = {
    namespace: data.namespace,
    name: data.name,
    splitConfig: data.splitConfig,
    splitVault: data.splitVault,
    price: data.price,
    createdAt: now,
    expiresAt,
  };

  const signature = await createSignature(tokenSecret, payload);
  const token: ServiceToken = { ...payload, signature };

  return {
    token: encodeServiceToken(token),
    expiresAt,
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

  if (isTokenExpired(payload)) {
    return { valid: false, error: "Token expired" };
  }

  return {
    valid: true,
    payload: {
      namespace: payload.namespace,
      name: payload.name,
      splitConfig: payload.splitConfig,
      splitVault: payload.splitVault,
      price: payload.price,
      createdAt: payload.createdAt,
      expiresAt: payload.expiresAt,
    },
  };
}
