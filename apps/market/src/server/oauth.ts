/**
 * OAuth Server Functions
 *
 * Handles OAuth2 token exchange and refresh for MCP clients.
 * Uses PKCE for security (required by MCP SDK).
 */

import { SignJWT, jwtVerify } from "jose";
import { verifyChallenge } from "pkce-challenge";
import { nanoid } from "nanoid";
import { env } from "cloudflare:workers";

// JWT issuer for token validation
const JWT_ISSUER = "https://market.cascade.fyi";

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
export async function createAuthCode(params: {
  userAddress: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
}): Promise<string> {
  const code = nanoid(32);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  await env.DB.prepare(
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
export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
} | null> {
  // 1. Lookup auth code
  const authCode = await env.DB.prepare(
    "SELECT * FROM auth_codes WHERE code = ? AND used_at IS NULL",
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
    return null;
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

  // 5. Mark code as used
  await env.DB.prepare(
    "UPDATE auth_codes SET used_at = datetime('now') WHERE code = ?",
  )
    .bind(params.code)
    .run();

  // 6. Issue access token (1 hour)
  const secret = new TextEncoder().encode(env.JWT_SECRET);
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

  // 7. Issue refresh token (30 days)
  const refreshToken = nanoid(64);
  const refreshTokenHash = await hashToken(refreshToken);
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const refreshTokenId = nanoid(16);

  await env.DB.prepare(
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
 */
export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
}): Promise<{
  accessToken: string;
  expiresIn: number;
  scope: string;
} | null> {
  // 1. Hash the provided refresh token
  const tokenHash = await hashToken(params.refreshToken);

  // 2. Lookup refresh token
  const storedToken = await env.DB.prepare(
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
  const secret = new TextEncoder().encode(env.JWT_SECRET);
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

  return {
    accessToken,
    expiresIn: 3600,
    scope: storedToken.scope,
  };
}

/**
 * Verify access token and return AuthInfo for MCP SDK
 * Used by gateway to verify Bearer tokens
 */
export async function verifyAccessToken(token: string): Promise<AuthInfo> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
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
export async function revokeRefreshToken(params: {
  refreshToken: string;
  clientId: string;
}): Promise<boolean> {
  const tokenHash = await hashToken(params.refreshToken);

  const result = await env.DB.prepare(
    `UPDATE refresh_tokens
     SET revoked_at = datetime('now')
     WHERE token_hash = ? AND client_id = ?`,
  )
    .bind(tokenHash, params.clientId)
    .run();

  return result.meta.changes > 0;
}
