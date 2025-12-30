# ADR-0004: Cascade Market Architecture

**Date:** 2025-12-16
**Status:** Accepted
**Goal:** Build "ngrok for paid MCPs" — MCP monetization platform that drives Cascade Splits adoption
**Chain:** Solana (Base support deferred to ADR-0005)

---

## 1. Problem & Solution

### Problem

MCP developers need a simple way to monetize their MCPs. Currently:
- No turnkey solution for paid MCP endpoints
- Developers must implement payment handling themselves
- Revenue distribution requires custom infrastructure

### Solution

**Cascade Market** — a platform where:
- **Suppliers** (MCP developers) run one command to get a paid MCP endpoint
- **Clients** (MCP consumers) set up once, then use any paid MCP seamlessly

```
Cascade Market
│
├── For Suppliers ────── Monetize your MCP in one command
│   └── `cascade serve` tunnels local MCP to market.cascade.fyi/mcps/@you/name
│
└── For Clients ──────── Pay for MCPs seamlessly
    └── `cascade mcp add @cascade/twitter` → works in Claude Code
    └── Payments happen invisibly via x402 + Tabs
```

**Market is the product.** Tabs and Splits are invisible infrastructure.

---

## 2. User Journeys

### 2.1 Supplier Journey (MCP Developer)

**Goal:** "I want to monetize my MCP"

**Prerequisites:** Solana wallet with SOL for transaction fees (~$2 rent for Split)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Create Service                                                     │
│  market.cascade.fyi/services/new                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Connect Solana wallet                                                   │
│  2. Enter namespace + name (e.g., @cascade/twitter)                         │
│  3. Click "Create Service"                                                  │
│  4. Sign transaction → creates Cascade Split on-chain                       │
│  5. Receive CLI token (csc_xxx)                                             │
│                                                                             │
│  Outcome: Split created, token generated                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Connect MCP                                                        │
│  Local terminal                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  $ cascade serve --token csc_xxx localhost:3000                             │
│                                                                             │
│  ✓ Service: @cascade/twitter (from token)                                   │
│  ✓ Price: $0.0001/call (default), discovery free                            │
│  ✓ Live at: market.cascade.fyi/mcps/@cascade/twitter                        │
│                                                                             │
│  Outcome: MCP is publicly accessible, payments routed to Split              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  ONGOING: Monitor & Collect Revenue                                         │
│  market.cascade.fyi/services                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  - View stats (calls, revenue, status)                                      │
│  - Revenue accumulates in Split vault                                       │
│  - Claim anytime (execute_split distributes to wallet)                      │
│                                                                             │
│  Revenue split: 99% to developer, 1% protocol fee                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Total steps:** 5 to go live, then CLI running whenever serving

---

### 2.2 Client Journey (MCP Consumer)

**Goal:** "I want to use paid MCP services from Claude Code"

**Prerequisites:** Solana wallet with USDC

**Key principle:** Cascade CLI handles x402 payments invisibly. Claude Code stays vanilla.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Browse MCPs                                                        │
│  market.cascade.fyi/explore                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Visit site (no wallet needed)                                           │
│  2. Browse available services                                               │
│  3. Copy command: `cascade mcp add @cascade/twitter`                        │
│                                                                             │
│  NO WALLET REQUIRED - user can explore freely                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Add MCP via CLI                                                    │
│  Local terminal                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  $ cascade mcp add @cascade/twitter                                         │
│                                                                             │
│  → Not logged in. Opening browser for authentication...                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Authenticate (First Time Only)                                     │
│  Browser opens market.cascade.fyi/oauth/authorize?client=cli                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─ State A: Connect wallet ────────────────────────────────────────────┐   │
│  │  [Connect Wallet]                                                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─ State B: Setup Tabs (first-time user) ──────────────────────────────┐   │
│  │  Deposit: [$10]  [$25]  [$50]  [Custom]                              │   │
│  │  Daily Limit: [$5/day]  [$10/day]  [$25/day]                         │   │
│  │  [Create Account & Deposit]                                          │   │
│  │  🔒 Non-custodial · Powered by Squads Protocol                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─ State C: Sign in (SIWS) ────────────────────────────────────────────┐   │
│  │  [Sign Message with Wallet]                                          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  → Credentials returned to CLI, stored in XDG config dir            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: CLI Completes Setup                                                │
│  Back in terminal                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✓ Logged in as DYw8...abc                                                  │
│  ✓ Tabs balance: $10.00                                                     │
│  ✓ Added @cascade/twitter to Claude Code                                    │
│                                                                             │
│  MCP added to ~/.claude/settings.json:                                      │
│  {                                                                          │
│    "mcpServers": {                                                          │
│      "@cascade/twitter": {                                                  │
│        "command": "cascade",                                                │
│        "args": ["mcp", "proxy", "@cascade/twitter"]                         │
│      }                                                                      │
│    }                                                                        │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  ONGOING: Use MCPs                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Claude Code ──stdio──► Cascade CLI ──x402──► Gateway ──tunnel──► MCP       │
│                                                                             │
│  - Claude Code sees normal MCP (no payment awareness needed)                │
│  - CLI handles x402 flow (402 → build tx → retry with payment)              │
│  - Gateway signs, forwards, settles AFTER response                          │
│  - User sees nothing - payments are invisible                               │
│                                                                             │
│  User can manage account anytime at market.cascade.fyi/pay (optional)       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Total steps:** 4 for first MCP (2 wallet interactions), then just `cascade mcp add`

**Returning user (has credentials):** Single command, no browser needed

---

## 3. System Architecture

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Claude Code (vanilla MCP client)                                           │
│  - No x402 awareness needed                                                 │
│  - Connects to local CLI via stdio                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                              │ stdio
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CASCADE CLI                                       │
│              TypeScript (npm: @cascade-fyi/cli or bun compiled)             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Consumer commands:                                                         │
│  ├── cascade login              Authenticate, setup Tabs, store credentials │
│  ├── cascade mcp add <service>  Add paid MCP to Claude Code config          │
│  ├── cascade mcp remove <svc>   Remove MCP from Claude Code config          │
│  ├── cascade mcp proxy <svc>    Run as stdio proxy (called by Claude Code)  │
│  └── cascade status             Show balance, daily spend, active MCPs      │
│                                                                             │
│  Supplier commands:                                                         │
│  └── cascade serve [options] [url]             Expose local MCP via tunnel  │
│                                                                             │
│  Credentials: $XDG_CONFIG_HOME/cascade/credentials (OAuth tokens)           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │ Streamable HTTP + x402 MCP transport
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        market.cascade.fyi                                   │
│                  Single Cloudflare Workers Deployment                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TanStack Start (Web App)                                                   │
│  ├── /                    Landing page                                      │
│  ├── /explore             Browse MCPs (SSR for SEO)                         │
│  ├── /pay                 Optional Tabs account management                  │
│  ├── /services            Supplier dashboard                                │
│  ├── /services/new        Create new service                                │
│  ├── /oauth/authorize     CLI authentication (+ Tabs setup)                 │
│  └── /oauth/token         Token exchange                                    │
│                                                                             │
│  Hono Gateway (/mcps/*)                                                     │
│  └── /mcps/:namespace/:name/*   x402 payment + tunnel routing               │
│       → Calls facilitator.cascade.fyi for verify/settle                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Bindings                                                                   │
│  ├── KV (OAUTH_KV): OAuth tokens (workers-oauth-provider, AES-GCM encrypted)│
│  ├── KV: rate limiting, SIWS nonces                                         │
│  └── Durable Objects: TunnelRelay (per-service, keyed by @namespace/name)   │
└─────────────────────────────────────────────────────────────────────────────┘
                │                                        │
                │ HTTP (verify/settle)                   │ WebSocket tunnel
                ▼                                        ▼
┌───────────────────────────────────────┐  ┌──────────────────────────────────┐
│      facilitator.cascade.fyi          │  │  Supplier's Cascade CLI          │
│      Separate Cloudflare Worker       │  │  (`cascade serve`)               │
├───────────────────────────────────────┤  │  └── Local MCP Server            │
│                                       │  └──────────────────────────────────┘
│  GET  /supported   Supported schemes  │
│  POST /verify      Verify payment tx  │
│  POST /settle      Settle payment tx  │
│                                       │
│  Implements RFC #646:                 │
│  - CPI verification via simulation    │
│  - Deadline validator support         │
│  - Durable nonce support              │
└───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ON-CHAIN (SOLANA)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Cascade Splits Program (SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB)       │
│  ├── SplitConfig PDA: per-service, holds recipient config                   │
│  └── Vault ATA: receives payments, owned by SplitConfig                     │
│                                                                             │
│  Squads v4 (Tabs accounts)                                                  │
│  ├── Multisig PDA: derived from user wallet (create_key)                    │
│  ├── Vault: holds user's USDC                                               │
│  └── SpendingLimit: authorizes Gateway executor to spend up to daily limit  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Supplier Data Flow

```
Developer creates service:

  Browser                    Market                      Solana
     │                          │                           │
     │  1. Create service       │                           │
     │  (@namespace/name)       │                           │
     │ ─────────────────────────>                           │
     │                          │                           │
     │                          │  2. Build createSplit tx  │
     │                          │  uniqueId = labelToUniqueId("@namespace/name")
     │                          │ ─────────────────────────>│
     │                          │                           │
     │  3. Sign tx              │                           │
     │ <─────────────────────────                           │
     │                          │                           │
     │  4. Submit signed tx     │                           │
     │ ─────────────────────────>                           │
     │                          │  5. Confirm               │
     │                          │ ─────────────────────────>│
     │                          │                           │
     │  6. Return CLI token     │                           │
     │  (contains: namespace,   │                           │
     │   name, splitConfig,     │                           │
     │   token, sig)            │                           │
     │ <─────────────────────────                           │
     │                          │                           │

No D1 storage — Split exists on-chain, token is self-contained.
Price is NOT in token — configured at runtime via CLI flag, config, or default.


Developer connects CLI:

  CLI                       TunnelRelay (DO)
   │                            │
   │  1. WebSocket connect      │
   │  + X-SERVICE-TOKEN header  │  (contains namespace, name, splitConfig)
   │  + X-SERVICE-PRICE header  │  (from --price flag, config, or default)
   │ ──────────────────────────>│
   │                            │
   │                            │  2. Verify token signature
   │                            │  3. Extract @namespace/name from token
   │                            │  4. Store price in DO state
   │                            │
   │  5. Connected              │
   │ <──────────────────────────│
   │                            │

Service identity (namespace, name) comes from token — no duplication needed.
Price resolved by CLI: --price flag > config > default (0.0001).
DO keyed by "@namespace/name" (extracted from token).
On disconnect, DO persists lastPrice + lastSeen for /explore discoverability.
```

### 3.3 Client Data Flow (x402-Native)

The Gateway MCP endpoint is **fully x402 compliant** — it expects signed transactions.
Tabs signing is decoupled into a separate `/sign` endpoint.

```
TABS USERS (Cascade CLI):

  Claude Code      CLI (proxy)              Gateway              Facilitator        MCP (via tunnel)
      │                │                       │                      │                    │
      │  1. MCP call   │                       │                      │                    │
      │ ──────────────>│                       │                      │                    │
      │                │                       │                      │                    │
      │                │  2. Forward request   │                      │                    │
      │                │  (no payment yet)     │                      │                    │
      │                │ ─────────────────────>│                      │                    │
      │                │                       │                      │                    │
      │                │  3. 402 Payment       │                      │                    │
      │                │  Required             │                      │                    │
      │                │ <─────────────────────│                      │                    │
      │                │                       │                      │                    │
      │                │  4. Build unsigned tx │                      │                    │
      │                │                       │                      │                    │
      │                │  5. POST /sign        │                      │                    │
      │                │  { unsignedTx }       │                      │                    │
      │                │ ─────────────────────>│                      │                    │
      │                │                       │                      │                    │
      │                │  6. { signedTx }      │                      │                    │
      │                │ <─────────────────────│                      │                    │
      │                │                       │                      │                    │
      │                │  7. Retry with        │                      │                    │
      │                │  SIGNED tx            │                      │                    │
      │                │ ─────────────────────>│                      │                    │
      │                │                       │                      │                    │
      │                │                       │  8. Verify signature │                    │
      │                │                       │  9. Forward to MCP   │                    │
      │                │                       │ ────────────────────────────────────────>│
      │                │                       │                      │                    │
      │                │                       │  10. MCP response    │                    │
      │                │                       │ <────────────────────────────────────────│
      │                │                       │                      │                    │
      │                │                       │  11. Settle payment  │                    │
      │                │                       │  (AFTER success)     │                    │
      │                │                       │ ────────────────────>│                    │
      │                │                       │                      │                    │
      │                │                       │  12. Receipt         │                    │
      │                │                       │ <────────────────────│                    │
      │                │                       │                      │                    │
      │                │  13. Response +       │                      │                    │
      │                │  receipt              │                      │                    │
      │                │ <─────────────────────│                      │                    │
      │                │                       │                      │                    │
      │  14. Response  │                       │                      │                    │
      │ <──────────────│                       │                      │                    │


EXTERNAL x402 CLIENTS (any wallet, no Tabs):

  External Client                            Gateway              Facilitator        MCP (via tunnel)
      │                                         │                      │                    │
      │  1. MCP request (no payment)            │                      │                    │
      │ ───────────────────────────────────────>│                      │                    │
      │                                         │                      │                    │
      │  2. 402 PaymentRequired                 │                      │                    │
      │ <───────────────────────────────────────│                      │                    │
      │                                         │                      │                    │
      │  3. Sign tx with own wallet             │                      │                    │
      │     (no /sign call needed)              │                      │                    │
      │                                         │                      │                    │
      │  4. MCP request + SIGNED tx             │                      │                    │
      │ ───────────────────────────────────────>│                      │                    │
      │                                         │                      │                    │
      │                                         │  5. Verify → forward → settle            │
      │                                         │                      │                    │
      │  6. Response + receipt                  │                      │                    │
      │ <───────────────────────────────────────│                      │                    │
```

**Key points:**
- Gateway MCP endpoint expects **signed transactions** (standard x402)
- `/sign` endpoint is **optional** — only for Tabs users who need executor co-signing
- External x402 clients can use Gateway directly with their own signing
- Settlement happens AFTER successful response (x402 standard)

**Round trips:**
- Tabs users: 3 (402 → /sign → retry) — can optimize with caching
- External clients: 2 (402 → retry) — standard x402
```

---

## 4. Key Decisions

### 4.1 Path-Based Routing (Not Subdomains)

| Approach | Pros | Cons |
|----------|------|------|
| Subdomains (`*.mcps.cascade.fyi`) | Isolation | Wildcard SSL, DNS complexity, no namespacing |
| **Path-based** (`/mcps/@ns/name`) | **Single domain, namespaces built-in** | Slightly longer URLs |

**Decision:** Path-based routing with namespace structure.

```
market.cascade.fyi/mcps/@cascade/twitter    ← Platform-owned
market.cascade.fyi/mcps/@tenequm/weather    ← User-owned
market.cascade.fyi/mcps/@someorg/api        ← Org-owned
```

**Benefits:**
- Single domain = simpler SSL, CORS, caching
- Namespaces prevent collisions (like npm/GitHub)
- Standard path routing in Gateway
- Cleaner URL structure

**Service name encoding:**
```typescript
// Full scoped name encoded in uniqueId
const uniqueId = labelToUniqueId("@cascade/twitter");
const splitConfig = deriveSplitConfig(ownerWallet, USDC_MINT, uniqueId);
```

### 4.2 CLI as x402 Client (Not Claude Code)

| Approach | Pros | Cons |
|----------|------|------|
| Claude Code native x402 | Direct integration | Requires Anthropic changes |
| Browser OAuth per request | Works today | Clunky UX, many prompts |
| **CLI as local proxy** | **Works now, invisible payments** | Requires CLI install |

**Decision:** Cascade CLI acts as local MCP server (stdio) that proxies to Gateway with x402 payments.

Claude Code config:
```json
{
  "mcpServers": {
    "@cascade/twitter": {
      "command": "cascade",
      "args": ["mcp", "proxy", "@cascade/twitter"]
    }
  }
}
```

**Benefits:**
- Claude Code stays vanilla (no modifications needed)
- CLI handles all x402 complexity
- User authenticates once, payments are invisible
- Works with any MCP client that supports stdio

### 4.3 Pluggable Signing Architecture

**Decision:** Gateway MCP endpoint accepts any **signed transaction** — signing is decoupled and pluggable.

```
                              How does the transaction get signed?
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              │                             │                             │
              ▼                             ▼                             ▼
      Gateway /sign                  Direct wallet                  Future options
      (Tabs users)                   (own signing)                  (other smart wallets)
              │                             │                             │
              │ Executor signs via          │ User signs with             │
              │ Squads SpendingLimit        │ their own wallet            │
              │                             │                             │
              └─────────────────────────────┴─────────────────────────────┘
                                            │
                                            ▼
                              Gateway MCP endpoint (/mcps/*)
                              Expects SIGNED transaction
                              Doesn't care HOW it was signed
```

**Key principle:** The Gateway MCP endpoint is **pure x402** — it accepts any validly signed transaction. How clients obtain signatures is their choice:

| Signing Method | Who Uses It | How It Works |
|----------------|-------------|--------------|
| **Gateway `/sign`** | Tabs users (Cascade CLI) | CLI builds tx → `/sign` adds executor signature |
| **Direct wallet** | External x402 clients | User signs with own wallet, sends directly |
| **Future: user keys** | Power users | User-managed signing keys (no Gateway involved) |
| **Future: other wallets** | Other smart wallet users | Other co-signing services |

**Why `/sign` exists (Tabs architecture):**
- Tabs uses Squads v4 spending limits for pre-authorized payments
- User's wallet is `create_key` for the Squads multisig
- Gateway's executor key has a `SpendingLimit` to spend from user's vault
- `/sign` adds the executor signature to user-built transactions
- This enables "invisible payments" without per-transaction wallet prompts

**The `/sign` endpoint is NOT part of x402** — it's a Cascade-specific signing service, one pluggable option among many.

### 4.4 Gateway Endpoints

```
x402 Resource Server:
POST /mcps/:ns/:name/*    MCP transport (JSON-RPC with _meta["x402/payment"])

Cascade-specific:
POST /sign                Tabs signing service (pluggable, optional)
```

**Facilitator is a separate service (`facilitator.cascade.fyi`):**
- Gateway calls facilitator via HTTP for verify/settle operations
- Facilitator exposes standard x402 REST endpoints (`/verify`, `/settle`, `/supported`)
- Implements RFC #646 enhancements (CPI verification via simulation, deadline validators)
- Can be reused by other x402 resource servers
- See [coinbase/x402#646](https://github.com/coinbase/x402/issues/646) for spec details

**`/sign` endpoint** (for Tabs users):
```typescript
// POST /sign
// Signs spending limit tx with Gateway's executor key

Request:
{
  unsignedTx: "base64...",
  wallet: "DYw8..."       // For validation
}

Response:
{
  transaction: "base64..."  // x402 SVM payload field name
}
```

**MCP endpoint** (standard x402):
```typescript
// Gateway MCP handler - expects SIGNED transactions
if (!payment) {
  return json402(buildPaymentRequired(serviceConfig));
}

// Verify signature (NOT sign it - tx is already signed)
const isValid = verifyTransaction(payment.transaction, {
  expectedAmount: serviceConfig.price,
  expectedDestination: serviceConfig.splitVault,
});

if (!isValid) {
  return c.json({ error: 'Invalid payment' }, 400);
}

// Forward FIRST (before settlement)
const mcpResponse = await forwardToTunnel(service, request);

// Only settle if MCP succeeded
if (!mcpResponse.error) {
  const receipt = await facilitator.settle(payment.transaction);
  mcpResponse._meta = { 'x402/payment-response': receipt };
}

return mcpResponse;
```

### 4.5 Authentication Model

| Context | Auth Method | Rationale |
|---------|-------------|-----------|
| Web browsing (/, /explore) | None | Public data, zero friction |
| Web /pay, /services | Wallet connected | Need wallet for Tabs/Split queries |
| **CLI authentication** | **OAuth + SIWS → stored locally** | Proves wallet ownership for Tabs |
| CLI → Gateway requests | Bearer token | Identifies wallet for Tabs lookup |

**Decision:** CLI authenticates once via OAuth, stores credentials locally. Gateway uses bearer token to identify which Tabs account to charge.

**Implementation:** Uses `@cloudflare/workers-oauth-provider` which wraps the Worker entry point:

```typescript
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

export default new OAuthProvider({
  apiRoute: ["/mcps/", "/sign"],      // Protected routes → apiHandler
  apiHandler: GatewayHandler,          // Receives ctx.props after token validation
  defaultHandler: marketHandler,       // TanStack Start + consent page
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  scopesSupported: ["tabs:spend", "mcps:access"],
});
```

**Token flow:**
1. CLI initiates OAuth with PKCE
2. Browser opens `/oauth/authorize` (HTML consent page with wallet connection)
3. User connects wallet via SIWS, approves scopes
4. `completeAuthorization()` generates auth code
5. CLI exchanges code for opaque tokens (stored in KV, AES-GCM encrypted)
6. Bearer token on requests → OAuthProvider validates → `ctx.props.walletAddress` available

### 4.6 Tabs Data Storage

**Decision:** On-chain only. Tabs account data queried from chain.

**Important:** Squads v4 Settings PDAs use a **global counter** (`accountIndex`), not the user's wallet address. The user's wallet is stored as `settingsAuthority` inside the account, not in the PDA seeds.

```typescript
// Settings PDA derivation (from Squads v4):
// Seeds: ["smart_account", "settings", accountIndex (u128)]
// accountIndex is a global counter from ProgramConfig, NOT the wallet

// To find a user's Tabs account, must query chain:
async function findTabsAccount(rpc: Rpc, userWallet: Address) {
  // Query for Settings where settingsAuthority == userWallet
  const accounts = await rpc.getProgramAccounts(SQUADS_PROGRAM, {
    filters: [{
      memcmp: {
        offset: 24,  // settingsAuthority field offset
        bytes: base58Encode(userWallet),
      }
    }]
  });

  if (accounts.length === 0) return null;

  const settingsAddress = accounts[0].pubkey;
  const spendingLimitPda = await deriveSpendingLimit(settingsAddress, EXECUTOR_PUBKEY);
  const vaultPda = await deriveSmartAccount(settingsAddress);
  const vaultAta = getAssociatedTokenAddress(vaultPda, USDC_MINT);

  return { settingsAddress, spendingLimitPda, vaultPda, vaultAta };
}
```

**Performance note:** Use KV cache (`wallet → settingsAddress`) after first lookup to avoid repeated `getProgramAccounts` calls.

### 4.7 Service Data Storage

**Decision:** KV for service catalog (Sati-compatible JSON), DO for runtime state, on-chain for identity.

| Data | Source |
|------|--------|
| Service existence | On-chain (Split PDA exists) |
| Service owner | On-chain (`authority` field in SplitConfig) |
| Service identity | Service token (namespace, name, splitConfig) |
| Tool catalog | KV (populated on CLI connect) |
| Pricing config | KV (from CLI on connect) |
| Online/offline | KV + DO (updated on connect/disconnect) |
| Last seen | KV (timestamp of last disconnect) |
| Analytics | Analytics Engine (connect/disconnect/request events) |

#### 4.7.1 KV Storage (Sati-Compatible)

Service records stored in KV as JSON, directly compatible with ERC-8004 registration files for future Sati migration:

```
Key: service:@{namespace}/{name}
Value: ServiceRecord JSON
```

```typescript
interface ServiceRecord {
  // ERC-8004 standard fields (Sati-compatible)
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;                    // "@cascade/github"
  description?: string;

  endpoints: Array<{
    name: string;                  // "MCP"
    endpoint: string;              // "wss://market.cascade.fyi/mcps/@cascade/github"
    version: string;               // "2024-11-05"
  }>;

  // Future: when registered on Sati
  registrations?: Array<{
    agentId: string;               // "sati:mainnet:GH1Bmint..."
    agentRegistry: string;         // CAIP-2 format
  }>;

  // Cascade-specific extension
  "x-cascade": {
    // Identity (from service token)
    splitConfig: string;           // Solana pubkey
    tokenMint: string;             // USDC mint

    // Pricing
    pricing: {
      default: number;             // Default price for tools/call (USDC)
      discovery: boolean;          // If true, bill discovery endpoints too
      tools?: Record<string, number>;  // Per-tool overrides: { "ai_review": 0.05 }
    };

    // Tool catalog (populated on connect via tools/list)
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: object;
      price?: number;              // null = use default
    }>;

    // Runtime status
    status: {
      isOnline: boolean;
      lastSeen?: string;           // ISO timestamp
      connectedAt?: string;        // ISO timestamp (if online)
    };

    // Metadata
    createdAt: string;
  };
}
```

**Why KV:**
- Simple key-value lookups for service data
- `list({ prefix: "service:" })` for /explore discovery
- JSON blobs are Sati-compatible — publish to IPFS when ready
- No D1 setup required
- Eventually consistent is acceptable (service appearing 60s late on /explore is fine)

#### 4.7.2 Pricing Model

**What gets billed:**
- `tools/call` — billed at tool's price (or default)
- `tools/list`, `resources/*`, `prompts/*` — free by default (discovery)
- `initialize`, `ping` — always free (protocol overhead)

**Anti-spam option:** `--disable-free-discovery` flag (or `free_discovery: false` in config) bills discovery endpoints at default price.

**Price resolution (highest to lowest):**
1. Per-tool price in config (`serve.tools.<name>`)
2. CLI `--price` flag
3. Config `serve.price_per_call`
4. Default: 0.0001 USDC

**Price lifecycle:**
1. CLI resolves pricing config using precedence above
2. CLI sends pricing to DO on WebSocket connect (X-SERVICE-PRICING header)
3. DO fetches tool catalog via `tools/list` from local MCP
4. DO builds ServiceRecord and writes to KV
5. On disconnect, DO updates `status.isOnline=false`, `status.lastSeen`
6. Price can change on each reconnect (dynamic pricing)

#### 4.7.3 Service Discovery for /explore

```typescript
// List all services
const { keys } = await env.SERVICES_KV.list({ prefix: "service:" });

// Get each service record
const services = await Promise.all(
  keys.map(k => env.SERVICES_KV.get<ServiceRecord>(k.name, "json"))
);

// Filter online (in code, simple for MVP)
const online = services.filter(s => s["x-cascade"].status.isOnline);
```

**Display:**
- Online: "@cascade/github — $0.001/call — 12 tools"
- Offline: "@cascade/github — last seen 2 days ago"
- Per-tool pricing shown on detail page

#### 4.7.4 Migration to Sati (Future)

When ready for on-chain service registry:
1. Service owner clicks "Register on Sati" in web UI
2. Publish existing ServiceRecord JSON to IPFS (already compatible!)
3. Create Sati agent NFT with `uri` → IPFS hash
4. Update ServiceRecord with `registrations` array
5. KV becomes cache/index of on-chain data

### 4.8 Service Token Design

Signed token with `csc_` prefix. Proves service ownership; price configured separately.

```typescript
interface ServiceToken {
  namespace: string;      // e.g., "@cascade"
  name: string;           // e.g., "twitter"
  splitConfig: string;    // SplitConfig PDA
  token: string;          // Token mint (Solana) or ERC20 address (EVM)
  createdAt: number;      // Unix timestamp
  expiresAt: number;      // Unix timestamp (default: createdAt + 30 days)
  signature: string;      // HMAC signature (covers all fields above)
}

// Format: csc_<base64url(JSON)>
```

**Derivable from token fields:**
- `vault` = ATA(splitConfig, token) — no need to include in token

**Not in token (configured separately):**
- `price` — set in cascade.yaml, allows dynamic pricing without token regeneration

**Token lifecycle:**
- **Generation:** Created on service registration, 30-day TTL by default
- **Validation:** TunnelRelay DO checks `expiresAt > Date.now()` on WebSocket connect
- **Renewal:** Supplier requests new token via `/services` dashboard (re-authenticates with wallet)
- **Revocation (future):** Store revoked token hashes in KV if needed

### 4.9 OAuth Tokens

Uses `@cloudflare/workers-oauth-provider` for token management:

| Token | Lifetime | Storage | Format |
|-------|----------|---------|--------|
| Access Token | 1 hour | KV (OAUTH_KV) | Opaque string |
| Refresh Token | 30 days | KV (OAUTH_KV) | Opaque string |

**Key differences from custom JWT implementation:**
- Tokens are **opaque** (not JWTs) — no claims to decode client-side
- Token data stored in KV with **AES-GCM encryption** (per-token wrapped keys)
- User data passed via `props` during authorization, available as `ctx.props` in handlers
- Library handles PKCE validation, refresh rotation, and token revocation

**Props set during authorization:**
```typescript
await env.OAUTH_PROVIDER.completeAuthorization({
  userId: walletAddress,
  props: { walletAddress },  // Available as ctx.props in apiHandler
  scope: ["tabs:spend"],
});
```

**Accessing user data in Gateway:**
```typescript
// In apiHandler (GatewayHandler class)
const walletAddress = this.ctx.props.walletAddress;
```

### 4.10 Custom SVM Verification (Critical Dependency)

**Problem:** The current x402 `exact` SVM scheme specification blocks our Tabs implementation.

The x402 spec requires transactions with exactly 3-4 instructions ending in a direct `TransferChecked` instruction. However, Tabs uses **Squads v4 spending limits**, which execute transfers via **Cross-Program Invocation (CPI)**. CPI transfers appear as smart wallet program calls, not direct token transfers — the current spec rejects these as invalid.

**Our solution:** Implement custom SVM verification that supports:
1. **CPI transfer verification** via transaction simulation (not static instruction parsing)
2. **Deadline validation** for `maxTimeoutSeconds` enforcement (optional)
3. **Durable nonces** for extended timeouts beyond Solana's ~90s blockhash expiry (optional)

**RFC submitted:** [coinbase/x402#646](https://github.com/coinbase/x402/issues/646) proposes extending the spec to support smart wallets. Until merged, we implement custom verification.

**Why we can't use `@x402/svm` facilitator:**
- Standard facilitator uses static instruction parsing
- Rejects CPI transfers from Squads spending limits
- We must verify via simulation to support smart wallet payments

**Our approach (`facilitator.cascade.fyi`):**
- Separate facilitator service implementing RFC #646 enhancements
- Exposes standard x402 REST endpoints (`/verify`, `/settle`, `/supported`)
- Uses simulation-based verification for CPI transfers
- Maintains all security constraints (fee payer safety, amount exactness, destination verification)
- Once RFC is merged into x402 spec, can be replaced with standard facilitator

### 4.11 x402 Protocol Compliance

**Decision:** Use standard x402 `exact` scheme for full MCP transport compatibility.

```typescript
// 402 PaymentRequired response (standard x402)
{
  "error": {
    "code": 402,
    "data": {
      "x402Version": 2,
      "accepts": [{
        "scheme": "exact",                    // Standard scheme
        "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",  // CAIP-2 mainnet
        "amount": "1000",
        "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "payTo": "<split_vault>",
        "maxTimeoutSeconds": 60,
        "extra": {
          "executorKey": "<gateway_executor>"  // For co-signing
        }
      }]
    }
  }
}

// Payment payload (standard x402 MCP transport)
{
  "_meta": {
    "x402/payment": {
      "x402Version": 2,
      "accepted": { /* chosen requirement */ },
      "payload": {
        "transaction": "base64..."  // Standard x402 SVM payload field
      }
    }
  }
}
```

**Benefits:**
- Full x402 MCP transport compliance
- Any x402-aware client can use our Gateway
- If Claude Code adds x402 support, it would work without our CLI
- No custom scheme to maintain

### 4.12 TypeScript CLI

| Approach | Pros | Cons |
|----------|------|------|
| Go binary | Single binary, no runtime | Can't reuse existing TS SDKs |
| **TypeScript CLI** | **Reuse tabs-sdk, splits-sdk, @solana/kit** | Needs Node.js or bun |

**Decision:** TypeScript CLI to reuse existing SDKs and maintain single-language codebase.

**Distribution options:**
```bash
# npm global install
npm install -g @cascade-fyi/cli

# npx (no install)
npx @cascade-fyi/cli mcp add @cascade/twitter

# Bun compiled binary
curl -fsSL https://cascade.fyi/install.sh | sh
```

**Benefits:**
- Direct use of `@cascade-fyi/tabs-sdk` for tx building
- Direct use of `@cascade-fyi/splits-sdk` for Split queries
- Direct use of `@solana/kit` for Solana primitives
- Single language for entire stack (Gateway + CLI)
- Easier maintenance

### 4.13 Other Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Path-based routing | Simpler infra, built-in namespaces |
| 2 | CLI as x402 client | Works with vanilla Claude Code |
| 3 | Settle after response | x402 standard, no charge on failure |
| 4 | No D1 for services | On-chain + token is source of truth |
| 5 | Solana only (MVP) | Simplifies everything |
| 6 | Single deployment | Market + Gateway in one Workers deploy |
| 7 | TanStack Start | Type-safe, SSR where needed |
| 8 | TypeScript for CLI | Reuse existing SDKs (tabs-sdk, splits-sdk) |
| 9 | Standard x402 exact scheme | Full MCP transport compatibility |
| 10 | 99/1 revenue split | Developer gets 99%, protocol 1% |

---

## 5. Implementation Reference

### 5.1 Routes

| Route | SSR | Auth | Purpose |
|-------|-----|------|---------|
| `/` | ✅ | None | Landing page |
| `/explore` | ✅ | None | Browse MCPs (SEO) |
| `/pay` | ❌ | Wallet | Tabs account management |
| `/services` | ❌ | Wallet | Supplier dashboard |
| `/services/new` | ❌ | Wallet | Create service |
| `/oauth/authorize` | ❌ | Multi-step | CLI authentication |
| `/oauth/token` | - | - | Token exchange (API) |
| **x402 Resource Server** |
| `/mcps/:ns/:name/*` | - | x402 | MCP transport endpoint |
| **Cascade-specific** |
| `/sign` | - | Bearer | Tabs signing service (pluggable) |

### 5.2 Directory Structure

```
apps/market/
├── src/
│   ├── routes/
│   │   ├── __root.tsx
│   │   ├── index.tsx              # Landing
│   │   ├── explore.tsx            # Browse MCPs (SSR)
│   │   ├── pay.tsx                # Tabs management
│   │   └── services/
│   │       ├── index.tsx          # Supplier dashboard
│   │       └── new.tsx            # Create service
│   │   # Note: /oauth/authorize is HTML (in server.ts), /oauth/token handled by library
│   │
│   ├── components/
│   │   ├── ui/                    # shadcn/ui
│   │   └── tabs/                  # Tabs-specific components
│   │
│   ├── gateway/
│   │   ├── index.ts               # Hono app for /mcps/*
│   │   ├── auth.ts                # getAuthProps() helper for ctx.props
│   │   ├── sign.ts                # POST /sign handler
│   │   ├── x402.ts                # Payment handling
│   │   └── tunnel.ts              # TunnelRelay DO
│   │
│   ├── server/
│   │   ├── tokens.ts              # Service token gen/verify
│   │   └── splits.ts              # On-chain queries
│   │   # Note: oauth.ts removed - handled by workers-oauth-provider
│   │
│   └── server.ts                  # OAuthProvider wrapper entry point
│
└── wrangler.jsonc                 # No D1, uses OAUTH_KV

packages/cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                   # Entry point
│   ├── bin.ts                     # CLI entry (commander)
│   ├── commands/
│   │   ├── login.ts               # OAuth flow
│   │   ├── status.ts              # Account status
│   │   ├── mcp/
│   │   │   ├── add.ts             # Add to Claude Code config
│   │   │   ├── remove.ts          # Remove from config
│   │   │   └── proxy.ts           # stdio proxy (x402 client)
│   │   └── serve.ts               # Supplier tunnel
│   └── lib/
│       ├── auth.ts                # OAuth, credentials storage
│       ├── x402.ts                # Payment building, 402 handling
│       ├── mcp-proxy.ts           # stdio ↔ HTTP bridging
│       ├── tunnel.ts              # WebSocket tunnel client
│       └── config.ts              # Claude Code config manipulation
└── build/                         # Bun compiled binaries (optional)

apps/facilitator/
├── src/
│   ├── index.ts                   # Hono app entry
│   ├── types.ts                   # Env bindings
│   ├── routes/
│   │   ├── supported.ts           # GET /supported
│   │   ├── verify.ts              # POST /verify
│   │   └── settle.ts              # POST /settle
│   └── lib/
│       ├── validation.ts          # CPI verification via simulation (RFC #646)
│       └── signer.ts              # Fee payer signing
└── wrangler.jsonc                 # → facilitator.cascade.fyi
```

### 5.3 Storage Architecture

**No D1 database.** All storage uses KV, Analytics Engine, or on-chain data:

| Data | Storage | Details |
|------|---------|---------|
| OAuth tokens | KV (OAUTH_KV) | Managed by `workers-oauth-provider`, AES-GCM encrypted |
| Rate limits | KV | Sliding window counters with TTL |
| SIWS nonces | KV | Short-lived (5 min TTL) |
| **Service catalog** | **KV (SERVICES_KV)** | **Sati-compatible JSON (see §4.7.1)** |
| Service identity | On-chain | SplitConfig PDA + service token |
| Tabs accounts | On-chain | Squads v4 Settings + SpendingLimit |
| **Service events** | **Analytics Engine** | **Connect/disconnect/error events (see §5.7)** |
| Audit trail | Analytics Engine | Sign operations (executor forensics) |

**KV namespaces:**
```
OAUTH_KV     → OAuth tokens (workers-oauth-provider)
KV           → Rate limits, SIWS nonces
SERVICES_KV  → Service catalog (Sati-compatible JSON)
```

**KV key patterns:**
```
oauth:access:<token_id>     → encrypted props + metadata
oauth:refresh:<token_id>    → encrypted props + metadata
ratelimit:sign:<wallet>:<window> → request count
siws:nonce:<nonce>          → wallet address (pending verification)
service:@namespace/name     → ServiceRecord JSON (Sati-compatible)
```

### 5.4 Gateway Endpoints

**OAuth entry point:**

Uses `@cloudflare/workers-oauth-provider` which wraps the Worker:
- `apiRoute: ["/mcps/", "/sign"]` — Protected routes, receive validated `ctx.props`
- `defaultHandler` — TanStack Start + consent page
- `scopesSupported: ["tabs:spend", "mcps:access"]`

**Consent page (`/oauth/authorize`):**
- Minimal HTML (no React) for security
- State A: "Connect Wallet" button (wallet-standard)
- State B: Tabs setup for first-time users
- State C: SIWS sign-in
- On approve: `completeAuthorization()` with `props: { walletAddress }`

**`POST /sign` — Tabs signing service:**

```
Request:  { unsignedTx: "base64...", wallet: "DYw8..." }
Response: { transaction: "base64..." }
```

Validates spending limit tx belongs to authenticated wallet, signs with executor key.

**`POST /mcps/:ns/:name/*` — x402 MCP endpoint:**

Flow:
1. Extract payment from `_meta["x402/payment"]`
2. No payment → return 402 with `PaymentRequired`
3. Verify via `facilitator.cascade.fyi/verify`
4. Forward to supplier tunnel
5. On success → settle via `facilitator.cascade.fyi/settle`
6. Return response with receipt in `_meta["x402/payment-response"]`

### 5.5 CLI x402 Flow

**`cascade mcp proxy` — stdio proxy:**

1. Read JSON-RPC from stdin
2. Forward to Gateway (`POST /mcps/<service>`)
3. On 402: build unsigned tx → `POST /sign` → retry with signed payment
4. Write response to stdout

**Payment construction:**

Uses `@cascade-fyi/tabs-sdk` to build spending limit transactions:
- Input: wallet, destination (Split vault), amount, mint
- Output: unsigned transaction (base64)

**x402 payment payload:**

```typescript
{
  "_meta": {
    "x402/payment": {
      "x402Version": 2,
      "accepted": { /* chosen requirement */ },
      "payload": { "transaction": "base64..." }
    }
  }
}
```

### 5.6 Analytics Engine

Two datasets for observability:

| Dataset | Binding | Purpose |
|---------|---------|---------|
| `executor_signing_audit` | AUDIT | Security forensics for /sign endpoint |
| `service_events` | SERVICE_EVENTS | Service availability monitoring |

**Service events schema:**

| Field | Type | Description |
|-------|------|-------------|
| `blob1` | string | Service path (`@namespace/name`) |
| `blob2` | string | Event type: `connect`, `disconnect`, `error` |
| `blob3` | string | Context: splitConfig (connect), close code (disconnect), error message |
| `double1` | number | Timestamp |
| `double2` | number | Session start (disconnect only, for duration calc) |
| `index1` | string | Service path (sampling key) |

Events written on: WebSocket connect, disconnect, error in TunnelRelay DO.

### 5.7 CLI Configuration

**`cascade serve` command:**

```
cascade serve [options] [url]

Arguments:
  url                       Local MCP URL (default: http://localhost:3000/mcp)

Options:
  --token <token>           Service token (required if no config)
  --price <price>           Default price per tools/call in USDC (default: 0.0001)
  --disable-free-discovery  Bill discovery endpoints (tools/list, resources/*, prompts/*)
  --config <path>           Config file path (auto-discovers if not set)
```

**Config file format (`cascade.yaml`):**

```yaml
serve:
  token: ${CASCADE_SERVICE_TOKEN}
  url: ${MCP_ENDPOINT:-http://localhost:3000/mcp}
  price_per_call: 0.001
  free_discovery: true              # Set to false to bill discovery endpoints
  tools:                            # Optional per-tool pricing
    ai_code_review: 0.05
    simple_lookup: 0.0001
```

**Resolution precedence (highest to lowest):**
1. CLI flags (`--token`, `--price`, `--disable-free-discovery`)
2. Auto-mapped env vars (`CASCADE_SERVE_*`)
3. Config file values
4. Defaults (price=0.0001, free_discovery=true, url=localhost:3000/mcp)

**Auto-mapped env vars:**

| Env Var | Config Path |
|---------|-------------|
| `CASCADE_SERVE_URL` | serve.url |
| `CASCADE_SERVE_TOKEN` | serve.token |
| `CASCADE_SERVE_PRICE` | serve.price_per_call |
| `CASCADE_SERVE_FREE_DISCOVERY` | serve.free_discovery |

**Config discovery:** `./cascade.yaml` → `./cascade.yml` → `/etc/cascade/cascade.yaml`

**Container deployment:**

```yaml
# docker-compose.yaml
services:
  my-mcp:
    build: .
    environment:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

  cascade:
    image: ghcr.io/cascade-fyi/cascade:latest
    volumes: ['./cascade.yaml:/etc/cascade/cascade.yaml:ro']
    environment:
      CASCADE_SERVICE_TOKEN: ${CASCADE_SERVICE_TOKEN}
      CASCADE_SERVE_URL: http://my-mcp:3000/mcp
```

### 5.8 Build Order

1. **CLI login flow** — OAuth, SIWS, credential storage
2. **CLI mcp add** — Add to Claude Code config
3. **CLI mcp proxy** — stdio proxy with x402 payment handling
4. **Facilitator service** — /verify, /settle, /supported (Gateway depends on this)
5. **Gateway /mcps/* route** — 402 response, facilitator calls, tunnel forwarding
6. **Gateway /sign endpoint** — Tabs executor signing
7. **Service creation flow** — Create Split, generate token
8. **CLI serve** — Supplier tunnel connection
9. **Web UI** — /explore, /pay, /services

---

## 6. Open Questions

### Resolved in This ADR
- ✅ Subdomain vs path routing → Path-based (`/mcps/@ns/name`)
- ✅ Who handles x402 → CLI (not Claude Code directly)
- ✅ When to settle → After successful response (x402 standard)
- ✅ Where to store Tabs → On-chain only
- ✅ Where to store services → KV (Sati-compatible JSON) + on-chain identity
- ✅ CLI architecture → Dual-purpose (consumer + supplier)
- ✅ CLI language → TypeScript (reuse existing SDKs)
- ✅ x402 scheme → Standard `exact` scheme (no custom spec)
- ✅ Who builds tx → CLI builds unsigned tx
- ✅ Signing architecture → Decoupled `/sign` endpoint (Gateway MCP expects signed tx)
- ✅ External client support → Any x402 client can use Gateway directly
- ✅ Per-tool pricing → Config-based (`serve.tools.<name>: <price>`)
- ✅ Discovery endpoint billing → Opt-in via `--disable-free-discovery` flag

### Deferred
- Split executor (batch `execute_split`) — Platform bears gas, implement later
- Multi-chain support (Base) — See ADR-0005
- Custom split configurations — Revenue sharing with API providers
- Subscription/tiered pricing
- User-managed signing keys — Allow users to authorize their own keypair instead of Gateway executor
- Optimize Tabs round trips — Cache requirements, batch /sign with retry (currently 3 calls, could be 1-2)
- HTTP transport (`/api/*`) — x402 headers (PAYMENT-REQUIRED/PAYMENT-SIGNATURE) for non-MCP clients
- Resource server extensions — x402 extension metadata enrichment
- Full price history — Track all price changes over time via Analytics Engine (currently only last price persisted)
- On-chain service metadata — Optional PDA for description, pricing tiers, endpoint specs (enables trustless discovery)

---

## 7. Existing Infrastructure

| Component | Status | Reference |
|-----------|--------|-----------|
| Cascade Splits (Solana) | ✅ Deployed | `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB` |
| Cascade Facilitator | ✅ Ready | `facilitator.cascade.fyi` (RFC #646 implementation) |
| splits-sdk | ✅ Published | `@cascade-fyi/splits-sdk` |
| tabs-sdk | ✅ Published | `@cascade-fyi/tabs-sdk` |
| Squads v4 | ✅ External | squads.so |
| x402 Protocol | ✅ External | github.com/coinbase/x402 |
