/**
 * Service Token Decoding
 *
 * Per ADR-0004 §4.8: Tokens encode service metadata for CLI authentication.
 * Format: csc_<base64url(JSON)>
 *
 * Note: CLI only decodes tokens - signature verification happens on the Gateway.
 */

/**
 * Service Token payload structure (per ADR-0004 §4.8).
 */
export interface ServiceToken {
  namespace: string; // e.g., "cascade"
  name: string; // e.g., "twitter"
  splitConfig: string; // SplitConfig PDA
  splitVault: string; // Vault ATA (payTo)
  price: number; // USDC base units per call
  createdAt: number; // Unix timestamp (ms)
  expiresAt: number; // Unix timestamp (ms)
  signature: string; // HMAC signature (verified by Gateway)
}

/**
 * Decode a service token.
 *
 * Format: csc_<base64url(JSON)>
 *
 * @param token - Token string
 * @returns Decoded payload or null if invalid format
 */
export function decodeServiceToken(token: string): ServiceToken | null {
  if (!token.startsWith("csc_")) {
    return null;
  }

  try {
    // Decode base64url
    const base64 = token.slice(4).replace(/-/g, "+").replace(/_/g, "/");
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
 * Check if a token is expired.
 */
export function isTokenExpired(payload: ServiceToken): boolean {
  return payload.expiresAt < Date.now();
}

/**
 * Get service path from token.
 *
 * @returns Service path (e.g., "@cascade/twitter")
 */
export function getServicePath(payload: ServiceToken): string {
  return `@${payload.namespace}/${payload.name}`;
}

/**
 * Format price for display.
 *
 * @param price - USDC base units
 * @returns Human-readable price (e.g., "$0.0010")
 */
export function formatPrice(price: number): string {
  return `$${(price / 1_000_000).toFixed(4)}`;
}
