/**
 * OAuth Business Logic
 *
 * Pure functions for OAuth2 token exchange and refresh.
 * Uses PKCE for security (required by MCP SDK).
 *
 * Note: These functions accept D1Database and JWT secret as parameters.
 * Server functions that access cloudflare:workers env should be defined
 * in route files following TanStack Start patterns.
 */

import { SignJWT, jwtVerify } from "jose";
import { verifyChallenge } from "pkce-challenge";
import { nanoid } from "nanoid";

// JWT issuer for token validation
const JWT_ISSUER = "https://market.cascade.fyi";

/**
 * Client ID validation
 *
 * Valid format: lowercase alphanumeric + hyphens, 3-64 chars
 * Must start and end with alphanumeric (no leading/trailing hyphens)
 *
 * Examples: "cascade-cli", "claude-code", "my-mcp-client"
 */
const CLIENT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

function validateClientId(clientId: string): {
  valid: boolean;
  error?: string;
} {
  if (!clientId) {
    return { valid: false, error: "client_id is required" };
  }
  if (clientId.length < 3) {
    return { valid: false, error: "client_id must be at least 3 characters" };
  }
  if (clientId.length > 64) {
    return { valid: false, error: "client_id must be at most 64 characters" };
  }
  if (!CLIENT_ID_REGEX.test(clientId)) {
    return {
      valid: false,
      error:
        "client_id must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric",
    };
  }
  return { valid: true };
}

/** Hash a token using SHA-256 for secure storage */
async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * AuthInfo type that matches MCP SDK expectations
 */
export interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number; // seconds since epoch
  resource?: URL;
  extra?: Record<string, unknown>;
}

/**
 * Create an authorization code
 * Called when user approves OAuth consent
 */
export async function createAuthCode(
  db: D1Database,
  params: {
    userAddress: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
  },
): Promise<string> {
  // Validate client_id format
  const clientIdValidation = validateClientId(params.clientId);
  if (!clientIdValidation.valid) {
    throw new Error(clientIdValidation.error);
  }

  const code = nanoid(32);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  await db
    .prepare(
      `INSERT INTO auth_codes (code, user_address, client_id, redirect_uri, scope, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      code,
      params.userAddress,
      params.clientId,
      params.redirectUri,
      params.scope,
      params.codeChallenge,
      expiresAt,
    )
    .run();

  return code;
}

/**
 * Exchange authorization code for tokens
 * Verifies PKCE code_verifier against stored code_challenge
 */
export async function exchangeCodeForTokens(
  db: D1Database,
  jwtSecret: string,
  params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  },
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
} | null> {
  // 1. Atomically mark code as used and return data (prevents race conditions)
  // Uses UPDATE...RETURNING to claim the code in a single atomic operation
  const authCode = await db
    .prepare(
      `UPDATE auth_codes
       SET used_at = datetime('now')
       WHERE code = ? AND used_at IS NULL
       RETURNING code, user_address, client_id, redirect_uri, scope, code_challenge, expires_at`,
    )
    .bind(params.code)
    .first<{
      code: string;
      user_address: string;
      client_id: string;
      redirect_uri: string;
      scope: string;
      code_challenge: string;
      expires_at: string;
    }>();

  if (!authCode) {
    return null; // Code doesn't exist or already used
  }

  // 2. Check expiration
  if (new Date(authCode.expires_at) < new Date()) {
    return null;
  }

  // 3. Verify client_id and redirect_uri match
  if (
    authCode.client_id !== params.clientId ||
    authCode.redirect_uri !== params.redirectUri
  ) {
    return null;
  }

  // 4. Verify PKCE - verify code_verifier produces the stored challenge
  const pkceValid = await verifyChallenge(
    params.codeVerifier,
    authCode.code_challenge,
  );
  if (!pkceValid) {
    return null;
  }

  // 5. Issue access token (1 hour)
  const secret = new TextEncoder().encode(jwtSecret);
  const accessToken = await new SignJWT({
    sub: authCode.user_address,
    client_id: params.clientId,
    scope: authCode.scope,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);

  // 6. Issue refresh token (30 days)
  const refreshToken = nanoid(64);
  const refreshTokenHash = await hashToken(refreshToken);
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const refreshTokenId = nanoid(16);

  await db
    .prepare(
      `INSERT INTO refresh_tokens (id, user_address, token_hash, client_id, scope, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      refreshTokenId,
      authCode.user_address,
      refreshTokenHash,
      params.clientId,
      authCode.scope,
      refreshExpiresAt,
    )
    .run();

  return {
    accessToken,
    refreshToken,
    expiresIn: 3600, // 1 hour in seconds
    scope: authCode.scope,
  };
}

/**
 * Refresh access token using refresh token
 *
 * Implements refresh token rotation for security:
 * - Issues new access token
 * - Rotates refresh token (revokes old, issues new)
 * - Returns new refresh token in response
 */
export async function refreshAccessToken(
  db: D1Database,
  jwtSecret: string,
  params: {
    refreshToken: string;
    clientId: string;
  },
): Promise<{
  accessToken: string;
  refreshToken: string; // New rotated refresh token
  expiresIn: number;
  scope: string;
} | null> {
  // 1. Hash the provided refresh token
  const tokenHash = await hashToken(params.refreshToken);

  // 2. Lookup refresh token
  const storedToken = await db
    .prepare(
      `SELECT * FROM refresh_tokens
     WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL`,
    )
    .bind(tokenHash, params.clientId)
    .first<{
      id: string;
      user_address: string;
      scope: string;
      expires_at: string;
    }>();

  if (!storedToken) {
    return null;
  }

  // 3. Check expiration
  if (new Date(storedToken.expires_at) < new Date()) {
    return null;
  }

  // 4. Issue new access token
  const secret = new TextEncoder().encode(jwtSecret);
  const accessToken = await new SignJWT({
    sub: storedToken.user_address,
    client_id: params.clientId,
    scope: storedToken.scope,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);

  // 5. Refresh token rotation: revoke old, issue new
  // This prevents token replay attacks
  await db
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`,
    )
    .bind(storedToken.id)
    .run();

  const newRefreshToken = nanoid(64);
  const newRefreshTokenHash = await hashToken(newRefreshToken);
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const newRefreshTokenId = nanoid(16);

  await db
    .prepare(
      `INSERT INTO refresh_tokens (id, user_address, token_hash, client_id, scope, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newRefreshTokenId,
      storedToken.user_address,
      newRefreshTokenHash,
      params.clientId,
      storedToken.scope,
      refreshExpiresAt,
    )
    .run();

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: 3600,
    scope: storedToken.scope,
  };
}

/**
 * Verify access token and return AuthInfo for MCP SDK
 * Used by gateway to verify Bearer tokens
 */
export async function verifyAccessToken(
  jwtSecret: string,
  token: string,
): Promise<AuthInfo> {
  const secret = new TextEncoder().encode(jwtSecret);
  const { payload } = await jwtVerify(token, secret);

  return {
    token,
    clientId: payload.client_id as string,
    scopes: (payload.scope as string).split(" "),
    expiresAt: payload.exp,
    extra: {
      walletAddress: payload.sub,
    },
  };
}

/**
 * Revoke a refresh token
 */
export async function revokeRefreshToken(
  db: D1Database,
  params: {
    refreshToken: string;
    clientId: string;
  },
): Promise<boolean> {
  const tokenHash = await hashToken(params.refreshToken);

  const result = await db
    .prepare(
      `UPDATE refresh_tokens
     SET revoked_at = datetime('now')
     WHERE token_hash = ? AND client_id = ?`,
    )
    .bind(tokenHash, params.clientId)
    .run();

  return result.meta.changes > 0;
}
