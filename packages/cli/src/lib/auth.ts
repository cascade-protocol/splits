/**
 * Credential Management
 *
 * Handles OAuth token storage at XDG-compliant paths.
 * Location: ~/.config/cascade/credentials.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const GATEWAY_URL = "https://market.cascade.fyi";
const CONFIG_DIR = path.join(os.homedir(), ".config", "cascade");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

// Refresh tokens 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * User credentials stored locally.
 */
export interface Credentials {
  accessToken: string;
  refreshToken: string;
  walletAddress: string;
  expiresAt: number; // Unix timestamp (ms)
}

/**
 * Load credentials from disk.
 *
 * @returns Credentials if file exists and is valid, null otherwise
 */
export async function loadCredentials(): Promise<Credentials | null> {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      return null;
    }

    const content = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
    const data = JSON.parse(content) as Credentials;

    // Validate required fields
    if (
      !data.accessToken ||
      !data.refreshToken ||
      !data.walletAddress ||
      !data.expiresAt
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Save credentials to disk.
 *
 * Creates config directory if it doesn't exist.
 */
export async function saveCredentials(creds: Credentials): Promise<void> {
  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  // Write with restricted permissions
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

/**
 * Clear stored credentials.
 */
export async function clearCredentials(): Promise<void> {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Check if credentials are expired or about to expire.
 */
export function isExpired(creds: Credentials): boolean {
  return Date.now() >= creds.expiresAt - REFRESH_BUFFER_MS;
}

/**
 * Refresh credentials if expired.
 *
 * If refresh fails, returns null (caller should prompt re-login).
 */
export async function refreshIfNeeded(
  creds: Credentials,
): Promise<Credentials | null> {
  if (!isExpired(creds)) {
    return creds;
  }

  try {
    const response = await fetch(`${GATEWAY_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
      }),
    });

    if (!response.ok) {
      // Refresh token expired or revoked
      await clearCredentials();
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const newCreds: Credentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      walletAddress: creds.walletAddress,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    await saveCredentials(newCreds);
    return newCreds;
  } catch {
    return null;
  }
}

/**
 * Require valid credentials, prompting login if needed.
 *
 * @throws Error if not logged in
 */
export async function requireCredentials(): Promise<Credentials> {
  const creds = await loadCredentials();
  if (!creds) {
    throw new Error("Not logged in. Run: cascade login");
  }

  const refreshed = await refreshIfNeeded(creds);
  if (!refreshed) {
    throw new Error("Session expired. Run: cascade login");
  }

  return refreshed;
}
