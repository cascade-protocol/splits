/**
 * Login Command
 *
 * OAuth 2.0 + PKCE flow for authenticating with Cascade Market.
 *
 * Flow:
 * 1. Generate PKCE code_verifier + code_challenge
 * 2. Open browser to market.cascade.fyi/oauth/authorize
 * 3. Start local HTTP server on random port for callback
 * 4. Receive auth code from callback
 * 5. Exchange code for tokens via POST /oauth/token
 * 6. Save credentials to XDG path
 */

import { buildCommand } from "@stricli/core";
import { intro, outro, spinner } from "@clack/prompts";
import pc from "picocolors";
import * as http from "node:http";
import open from "open";
import pkceChallenge from "pkce-challenge";
import { saveCredentials, type Credentials } from "../lib/auth";

const GATEWAY_URL = "https://market.cascade.fyi";

/**
 * Find an available port by starting a server on port 0.
 */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Could not determine port"));
      }
    });
    server.on("error", reject);
  });
}

/**
 * OAuth token response.
 */
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  wallet_address: string;
}

export const loginCommand = buildCommand({
  docs: {
    brief: "Login to Cascade Market",
  },
  parameters: {
    positional: { kind: "tuple", parameters: [] },
  },
  async func() {
    intro(pc.cyan("Cascade Login"));

    const s = spinner();

    // 1. Generate PKCE challenge
    s.start("Generating secure session");
    const { code_verifier, code_challenge } = await pkceChallenge();
    s.stop("Session ready");

    // 2. Find available port for callback
    const port = await findAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    // 3. Build authorization URL
    const state = crypto.randomUUID();
    const authUrl = new URL(`${GATEWAY_URL}/oauth/authorize`);
    authUrl.searchParams.set("client_id", "cascade-cli");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "tabs:spend");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", code_challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    // 4. Start local callback server
    const authCode = await new Promise<string>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith("/callback")) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        // Send response immediately
        if (error || !code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Authentication Failed</h1><p>You can close this window.</p></body></html>",
          );
          server.close();
          reject(new Error(error || "Invalid state or missing code"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Authentication Successful!</h1><p>You can close this window and return to the CLI.</p></body></html>",
        );
        server.close();
        resolve(code);
      });

      server.listen(port, "127.0.0.1", () => {
        // Open browser
        console.log(pc.dim(`Opening browser for login...`));
        open(authUrl.toString()).catch(() => {
          console.log(pc.yellow(`Please open this URL manually:`));
          console.log(authUrl.toString());
        });
      });

      // Timeout after 5 minutes
      const timeout = setTimeout(
        () => {
          server.close();
          reject(new Error("Login timed out"));
        },
        5 * 60 * 1000,
      );

      server.on("close", () => clearTimeout(timeout));
    });

    // 5. Exchange auth code for tokens
    s.start("Completing authentication");

    const tokenResponse = await fetch(`${GATEWAY_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: redirectUri,
        client_id: "cascade-cli",
        code_verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const error = (await tokenResponse.json()) as { error?: string };
      s.stop("Authentication failed");
      throw new Error(error.error || "Token exchange failed");
    }

    const tokens = (await tokenResponse.json()) as TokenResponse;

    // 6. Save credentials
    const credentials: Credentials = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      walletAddress: tokens.wallet_address,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };

    await saveCredentials(credentials);
    s.stop("Authentication complete");

    outro(
      `Logged in as ${pc.cyan(credentials.walletAddress.slice(0, 8))}...${pc.cyan(credentials.walletAddress.slice(-8))}`,
    );
  },
});
