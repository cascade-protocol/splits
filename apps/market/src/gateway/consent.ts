/**
 * OAuth Consent Page Handler
 *
 * Minimal HTML page for OAuth authorization with wallet connection.
 * Per ADR-0004 §5.4: HTML consent page with inline wallet-standard JS.
 *
 * Flow:
 * 1. GET /oauth/authorize - Show consent page
 *    - If no session cookie: show "Connect Wallet" button
 *    - If session exists: show consent form with scopes
 * 2. POST /oauth/authorize - Complete authorization
 *    - Verify session, call OAUTH_PROVIDER.completeAuthorization
 *    - Redirect to client with auth code
 */

import { Hono } from "hono";
import { jwtVerify } from "jose";
import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";

// Extended Env with OAUTH_PROVIDER injected by OAuthProvider
interface AppEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
  JWT_SECRET: string; // Used for session JWT verification
}

// Scope descriptions for display
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "tabs:spend": "Make payments using your Tabs spending limit",
  "mcps:access": "Access MCP services on your behalf",
};

// Allowed redirect URI hosts (localhost only for MCP clients)
const ALLOWED_REDIRECT_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Validate redirect URI is localhost only (security)
 */
function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return ALLOWED_REDIRECT_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Verify session cookie and return wallet address
 */
async function verifySession(
  request: Request,
  jwtSecret: string,
): Promise<string | null> {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...val] = c.trim().split("=");
      return [key, val.join("=")];
    }),
  );

  const sessionToken = cookies.session;
  if (!sessionToken) return null;

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(sessionToken, secret);
    return payload.sub as string;
  } catch {
    return null;
  }
}

/**
 * Render consent page HTML
 */
function renderConsentPage(params: {
  clientId: string;
  clientName?: string;
  scopes: string[];
  walletAddress?: string;
  state: string;
  error?: string;
}): string {
  const { clientId, clientName, scopes, walletAddress, state, error } = params;

  const scopeList = scopes
    .map(
      (scope) => `
      <li>
        <code>${scope}</code>
        <span class="desc">${SCOPE_DESCRIPTIONS[scope] || scope}</span>
      </li>
    `,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize - Cascade Market</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 32px;
      max-width: 420px;
      width: 100%;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 600;
    }
    .subtitle {
      color: #888;
      margin: 0 0 24px;
      font-size: 14px;
    }
    .client-id {
      font-family: monospace;
      background: #262626;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
    .section-title {
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      margin: 0 0 12px;
      letter-spacing: 0.5px;
    }
    .scopes {
      list-style: none;
      padding: 0;
      margin: 0 0 24px;
    }
    .scopes li {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid #262626;
    }
    .scopes li:last-child { border-bottom: none; }
    .scopes code {
      background: #262626;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
    }
    .scopes .desc {
      color: #888;
      font-size: 13px;
    }
    .wallet-info {
      background: #262626;
      padding: 12px 16px;
      border-radius: 8px;
      margin: 0 0 24px;
    }
    .wallet-info .label {
      font-size: 11px;
      color: #666;
      text-transform: uppercase;
      margin: 0 0 4px;
    }
    .wallet-info .address {
      font-family: monospace;
      font-size: 13px;
      word-break: break-all;
    }
    .error {
      background: #2d1515;
      border: 1px solid #5c2020;
      color: #f87171;
      padding: 12px 16px;
      border-radius: 8px;
      margin: 0 0 24px;
      font-size: 14px;
    }
    .actions {
      display: flex;
      gap: 12px;
    }
    button {
      flex: 1;
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-deny {
      background: #262626;
      color: #fafafa;
    }
    .btn-approve {
      background: #2563eb;
      color: white;
    }
    .btn-connect {
      background: #7c3aed;
      color: white;
      width: 100%;
    }
    .connect-prompt {
      text-align: center;
      color: #888;
      font-size: 14px;
      margin: 0 0 16px;
    }
    #wallet-picker {
      display: none;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }
    .wallet-option {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #262626;
      border: 1px solid #333;
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .wallet-option:hover { border-color: #7c3aed; }
    .wallet-option img { width: 24px; height: 24px; border-radius: 4px; }
    .wallet-option span { font-size: 14px; }
    #status {
      text-align: center;
      color: #888;
      font-size: 13px;
      margin-top: 12px;
      min-height: 20px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize Application</h1>
    <p class="subtitle">
      <span class="client-id">${clientName || clientId}</span> wants to access your Cascade Market account.
    </p>

    ${error ? `<div class="error">${error}</div>` : ""}

    <p class="section-title">Permissions requested</p>
    <ul class="scopes">${scopeList}</ul>

    ${
      walletAddress
        ? `
      <div class="wallet-info">
        <p class="label">Authorizing as</p>
        <p class="address">${walletAddress}</p>
      </div>
      <form method="POST">
        <input type="hidden" name="state" value="${state}">
        <input type="hidden" name="action" value="">
        <div class="actions">
          <button type="submit" name="action" value="deny" class="btn-deny">Deny</button>
          <button type="submit" name="action" value="approve" class="btn-approve">Authorize</button>
        </div>
      </form>
    `
        : `
      <p class="connect-prompt">Connect your wallet to continue</p>
      <div id="wallet-picker"></div>
      <button id="connect-btn" class="btn-connect" onclick="showWallets()">Connect Wallet</button>
      <div id="status"></div>
      <script type="module">
        import { getWallets } from 'https://esm.sh/@wallet-standard/app@1.1.0';

        const state = '${state}';

        window.showWallets = () => {
          const { get } = getWallets();
          const wallets = get().filter(w =>
            w.chains?.some(c => c.startsWith('solana:'))
          );

          const picker = document.getElementById('wallet-picker');
          const btn = document.getElementById('connect-btn');

          if (wallets.length === 0) {
            document.getElementById('status').textContent = 'No Solana wallets found. Please install one.';
            return;
          }

          picker.innerHTML = wallets.map((w, i) => \`
            <div class="wallet-option" onclick="selectWallet(\${i})">
              <img src="\${w.icon}" alt="\${w.name}">
              <span>\${w.name}</span>
            </div>
          \`).join('');

          picker.style.display = 'flex';
          btn.style.display = 'none';

          window.wallets = wallets;
        };

        window.selectWallet = async (index) => {
          const wallet = window.wallets[index];
          const status = document.getElementById('status');

          try {
            status.textContent = 'Connecting...';

            // Connect wallet
            const connectFeature = wallet.features['standard:connect'];
            const { accounts } = await connectFeature.connect();

            if (!accounts.length) {
              status.textContent = 'No accounts found';
              return;
            }

            const account = accounts[0];
            status.textContent = 'Sign in to continue...';

            // Get SIWS input from server
            const nonceResp = await fetch('/api/auth/nonce');
            const input = await nonceResp.json();

            // Use solana:signIn if available (preferred), fallback to signMessage
            const signInFeature = wallet.features['solana:signIn'];
            let output;

            if (signInFeature) {
              // Native SIWS - wallet handles message construction
              const [result] = await signInFeature.signIn(input);
              output = result;
            } else {
              // Fallback: construct message manually and sign
              const signFeature = wallet.features['solana:signMessage'];
              if (!signFeature) {
                throw new Error('Wallet does not support signing');
              }

              // Build SIWS message per spec
              const message = [
                input.domain + ' wants you to sign in with your Solana account:',
                account.address,
                '',
                input.statement || '',
                '',
                'URI: ' + input.uri,
                'Version: ' + input.version,
                'Chain ID: ' + (input.chainId || 'mainnet'),
                'Nonce: ' + input.nonce,
                'Issued At: ' + input.issuedAt,
                input.resources?.length ? 'Resources:\\n- ' + input.resources.join('\\n- ') : ''
              ].filter(Boolean).join('\\n');

              const encoder = new TextEncoder();
              const messageBytes = encoder.encode(message);

              const [{ signature }] = await signFeature.signMessage({
                account,
                message: messageBytes
              });

              output = {
                account: {
                  address: account.address,
                  publicKey: Array.from(account.publicKey)
                },
                signedMessage: Array.from(messageBytes),
                signature: Array.from(signature)
              };
            }

            status.textContent = 'Verifying...';

            // Verify with server (sets session cookie)
            const verifyResp = await fetch('/api/auth/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nonce: input.nonce,
                output: {
                  account: {
                    address: output.account.address,
                    publicKey: Array.from(output.account.publicKey)
                  },
                  signedMessage: Array.from(output.signedMessage),
                  signature: Array.from(output.signature)
                }
              })
            });

            if (!verifyResp.ok) {
              const err = await verifyResp.json();
              throw new Error(err.error || 'Verification failed');
            }

            // Reload to show consent form (now has session)
            window.location.reload();

          } catch (err) {
            status.textContent = err.message || 'Connection failed';
            console.error('Wallet error:', err);
          }
        };
      </script>
    `
    }
  </div>
</body>
</html>`;
}

// Create Hono app for consent handling
const app = new Hono<{ Bindings: AppEnv }>();

/**
 * GET /oauth/authorize - Show consent page
 */
app.get("/oauth/authorize", async (c) => {
  // Parse OAuth request using library helper
  let oauthReq: AuthRequest;
  try {
    oauthReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (err) {
    return c.html(
      renderConsentPage({
        clientId: "unknown",
        scopes: [],
        state: "",
        error: `Invalid OAuth request: ${err instanceof Error ? err.message : "Unknown error"}`,
      }),
      400,
    );
  }

  // Validate redirect URI (localhost only)
  if (!isValidRedirectUri(oauthReq.redirectUri)) {
    return c.html(
      renderConsentPage({
        clientId: oauthReq.clientId,
        scopes: oauthReq.scope,
        state: "",
        error: "Only localhost redirect URIs are allowed for MCP clients",
      }),
      400,
    );
  }

  // Look up client info
  const clientInfo = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);

  // Check session for wallet address
  const walletAddress = await verifySession(c.req.raw, c.env.JWT_SECRET);

  // Encode OAuth request in state for POST handler
  const state = btoa(JSON.stringify(oauthReq));

  return c.html(
    renderConsentPage({
      clientId: oauthReq.clientId,
      clientName: clientInfo?.clientName,
      scopes: oauthReq.scope,
      walletAddress: walletAddress || undefined,
      state,
    }),
  );
});

/**
 * POST /oauth/authorize - Handle approval/denial
 */
app.post("/oauth/authorize", async (c) => {
  const formData = await c.req.formData();
  const state = formData.get("state");
  const action = formData.get("action");

  if (!state || typeof state !== "string") {
    return c.text("Missing state parameter", 400);
  }

  let oauthReq: AuthRequest;
  try {
    oauthReq = JSON.parse(atob(state));
  } catch {
    return c.text("Invalid state parameter", 400);
  }

  // Handle denial
  if (action === "deny") {
    const redirectUrl = new URL(oauthReq.redirectUri);
    redirectUrl.searchParams.set("error", "access_denied");
    redirectUrl.searchParams.set(
      "error_description",
      "User denied the request",
    );
    if (oauthReq.state) {
      redirectUrl.searchParams.set("state", oauthReq.state);
    }
    return c.redirect(redirectUrl.toString(), 302);
  }

  // Verify session for wallet address
  const walletAddress = await verifySession(c.req.raw, c.env.JWT_SECRET);
  if (!walletAddress) {
    return c.html(
      renderConsentPage({
        clientId: oauthReq.clientId,
        scopes: oauthReq.scope,
        state,
        error: "Session expired. Please connect your wallet again.",
      }),
      401,
    );
  }

  // Complete authorization using library helper
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: walletAddress,
    metadata: {
      authorizedAt: Date.now(),
    },
    scope: oauthReq.scope,
    props: {
      walletAddress,
    },
  });

  return c.redirect(redirectTo, 302);
});

export { app as consentApp };
