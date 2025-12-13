# ADR-0004: Cascade Market Architecture

**Date:** 2025-12-11
**Status:** Accepted
**Goal:** Build "ngrok for paid MCPs" - MCP monetization platform that drives Cascade Splits adoption
**Chain:** Solana (Base support deferred to ADR-0005)

---

## Problem

MCP developers need a simple way to monetize their MCPs. Currently:
- No turnkey solution for paid MCP endpoints
- Developers must implement payment handling themselves
- Revenue distribution requires custom infrastructure

**Core Value Prop:** Developer runs one command, gets a paid MCP endpoint with automatic revenue distribution.

---

## Product Hierarchy

```
Cascade Market
│
├── For MCP Developers ──── Monetize your MCP in one command
│   └── CLI tunnel + dashboard at market.cascade.fyi
│
└── For MCP Clients ─────── Pay for MCPs seamlessly
    └── OAuth once, use MCPs - payment is invisible
    └── Tabs account setup at /pay (Squads wallet + spending limit)
```

**Market is the product.** Tabs and Splits are invisible infrastructure. Clients authenticate via OAuth, Gateway handles payments server-side - no 402s, no payment UX.

---

## Architecture Decisions

### Single App with Route-Based Separation

One unified app at `market.cascade.fyi` with distinct route trees:

```
market.cascade.fyi/              → Landing (About) when disconnected; Dashboard when connected
market.cascade.fyi/services/new  → Create service wizard
market.cascade.fyi/services/$id  → Service detail page
market.cascade.fyi/explore       → Browse MCPs (SSR for SEO)
market.cascade.fyi/pay           → Tabs account (setup if none, manage if exists)
```

**Rationale:** Single deployment, shared wallet state, one codebase. Conditional rendering at `/` avoids separate dashboard route complexity while maintaining clean URLs.

### Tech Stack

| Choice | Decision | Rationale |
|--------|----------|-----------|
| **Framework** | TanStack Start | Server functions, type-safe RPC, file-based routing, TanStack Query integration |
| **Bundler** | Vite + Cloudflare plugin | Runs in actual Workers runtime locally |
| **Deployment** | Cloudflare Workers | Modern full-stack approach, D1/KV bindings |
| **Styling** | Tailwind CSS v4 | Primary styling, utility-first |
| **UI Components** | shadcn/ui | Built on Tailwind + Radix UI primitives |
| **Approach** | Mobile-first | Header with responsive sheet menu |
| **Starting point** | Fresh `apps/market` | Clean slate, no legacy patterns |

### SSR Strategy

Minimal SSR - only for public/SEO pages:

| Route | SSR | Why |
|-------|-----|-----|
| `/` (landing) | ✅ | SEO, social previews |
| `/explore` | ✅ | Discoverability |
| `/services/*` | ❌ | Authenticated |
| `/pay` | ❌ | Wallet-heavy |

Per-route SSR control:

```tsx
// routes/dashboard.tsx - client-only
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({
  ssr: false, // No SSR - runs entirely on client
  component: Dashboard,
})

// routes/explore.tsx - server-rendered for SEO
export const Route = createFileRoute('/explore')({
  ssr: true, // Default, but explicit for clarity
  loader: () => fetchPublicMCPs(),
  component: Explore,
})
```

> **Note:** The domain is `market.cascade.fyi` to avoid conflicts with the existing dashboard app at `cascade.fyi`. This can be migrated to `cascade.fyi` later when the legacy dashboard is retired.

### Wallet Integration

Wallet adapters require browser APIs. Use `ClientOnly` from `@tanstack/react-router`:

```tsx
// routes/__root.tsx
import { ClientOnly, Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { WalletProvider } from '~/components/wallet-provider'

export const Route = createRootRoute({
  shellComponent: RootShell,
  component: RootComponent,
})

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  return (
    <ClientOnly fallback={<div>Loading...</div>}>
      {() => (
        <WalletProvider>
          <Outlet />
        </WalletProvider>
      )}
    </ClientOnly>
  )
}
```

Vite config (no polyfills needed with `@solana/kit`):

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact(),
  ],
})
```

> **Note:** Using `@solana/client` and `@solana/react-hooks` from Solana Kit (web3.js v2) - fully browser-native, no Node.js polyfills required.

### Authentication (SIWS)

Sign-In With Solana (SIWS) provides wallet-based authentication following the CAIP-122 standard.

**Why SIWS:**
- Proves wallet ownership without sharing private keys
- Standard message format recognizable by users
- Enables OAuth flows for MCP clients (Claude Code, etc.)

**Implementation Approach:**

Uses the native Wallet Standard `solana:signIn` feature (`@solana/wallet-standard-features`) with fallback to `signMessage` for older wallets. No custom SIWS package needed.

```typescript
// Client-side: Check for native signIn feature
const signInFeature = wallet.features?.["solana:signIn"];

if (signInFeature) {
  // Native SIWS - wallet handles message construction
  const [result] = await signInFeature.signIn(input);
} else if (wallet.signMessage) {
  // Fallback: construct CAIP-122 message manually
  const message = constructSIWSMessage(input);
  const signature = await wallet.signMessage(new TextEncoder().encode(message));
}

// Server-side: Verify using @solana/kit
import { getPublicKeyFromAddress } from "@solana/addresses";
import { verifySignature } from "@solana/keys";
```

**Auth Flow (Dashboard):**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. User connects Solana wallet                                         │
│  2. Frontend requests nonce from server                                 │
│  3. Server generates nonce, stores in KV (5min TTL)                     │
│  4. Frontend uses wallet.signIn() or constructs SIWS message:           │
│                                                                         │
│     market.cascade.fyi wants you to sign in with your Solana account:   │
│     DYw4...abc                                                          │
│                                                                         │
│     Sign in to Cascade Market                                           │
│                                                                         │
│     URI: https://market.cascade.fyi                                     │
│     Nonce: abc123...                                                    │
│     Issued At: 2025-12-11T12:00:00Z                                     │
│                                                                         │
│  5. User signs message with wallet                                      │
│  6. Frontend sends signature to server                                  │
│  7. Server verifies signature (Ed25519) + validates nonce               │
│  8. Server issues JWT (30-day, httpOnly cookie)                         │
│  9. User is authenticated                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

**JWT Design:**

```typescript
// 30-day stateless JWT
{
  sub: "DYw4...abc",     // Solana public key
  iat: 1702300800,       // Issued at
  exp: 1704892800,       // 30 days later
}

// Stored in httpOnly cookie (prevents XSS)
Set-Cookie: session=<jwt>; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
```

### OAuth for MCP Clients

MCP clients (Claude Code, etc.) authenticate via OAuth2. Once authenticated, the **Gateway handles all payments internally** - clients never see 402s.

**Key insight:** OAuth authentication gives the Gateway everything it needs to pay on behalf of the user:
- **OAuth token → wallet address** (from SIWS during authorization)
- **Wallet address → Tabs smart account** (lookup in D1)
- **Gateway has spending permission** (user authorized during Tabs setup at /pay)

**Why OAuth:**
- MCP SDK has built-in OAuth2 support with PKCE
- Enables long-running sessions for AI agents
- User authorizes once, agent uses MCP seamlessly - payment is invisible

**OAuth Discovery + Authorization Flow:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PREREQUISITE: User has set up Tabs account at market.cascade.fyi/pay   │
│  └── Created Squads smart account                                       │
│  └── Deposited USDC                                                     │
│  └── Set daily spending limit (authorizes Gateway to spend)             │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  ONE-TIME: MCP client (Claude Code) gets OAuth authorization            │
│                                                                         │
│  1. MCP client connects to https://example.mcps.cascade.fyi             │
│  2. Gateway returns 401 + WWW-Authenticate header                       │
│  3. MCP client fetches /.well-known/oauth-protected-resource (RFC 9728) │
│     → { authorization_servers: ["https://market.cascade.fyi"], ... }    │
│  4. MCP client fetches /.well-known/oauth-authorization-server (RFC 8414)│
│     → { authorization_endpoint, token_endpoint, ... }                   │
│  5. MCP client opens browser → /oauth/authorize                         │
│                                                                         │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │  Authorize Claude Code                                      │     │
│     │                                                             │     │
│     │  This application wants to:                                 │     │
│     │  ✓ Use your Tabs balance for payments                       │     │
│     │                                                             │     │
│     │  Current balance: $142.50 USDC                              │     │
│     │                                                             │     │
│     │  [Deny]  [Authorize]                                        │     │
│     └─────────────────────────────────────────────────────────────┘     │
│                                                                         │
│  6. User signs SIWS (if not logged in) + approves                       │
│  7. Server generates auth code, redirects to localhost callback         │
│  8. MCP client exchanges code for tokens (PKCE verification)            │
│  9. MCP client stores tokens locally                                    │
│ 10. MCP client is now authorized - can make requests with Bearer token  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  EVERY REQUEST: Gateway handles payment internally                      │
│                                                                         │
│  1. MCP client sends request with Bearer token                          │
│  2. Gateway validates token → extracts wallet address                   │
│  3. Gateway looks up user's Tabs smart account (by wallet)              │
│  4. Gateway builds spending limit tx (smart_account → split_vault)      │
│  5. Gateway submits to facilitator, settles on Solana                   │
│  6. On success → forwards request to developer's MCP via tunnel         │
│  7. Response returned to client                                         │
│                                                                         │
│  Client never sees 402 - payment is invisible infrastructure            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Token Design:**

| Token | Lifetime | Storage | Purpose |
|-------|----------|---------|---------|
| Access Token | 1 hour | Memory | Bearer auth for MCP requests |
| Refresh Token | 30 days | D1 (hashed) | Obtain new access tokens |

**OAuth Endpoints:**

```
/.well-known/oauth-protected-resource    → RFC 9728 resource metadata
/.well-known/oauth-authorization-server  → RFC 8414 OAuth metadata
/oauth/authorize                         → Consent screen (SIWS if needed)
/oauth/token                             → Token exchange (PKCE)
```

**Gateway 401 Response (Critical for OAuth Discovery):**

The MCP SDK discovers OAuth via the `WWW-Authenticate` header. Gateway must return:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://market.cascade.fyi/.well-known/oauth-protected-resource"
```

For invalid tokens:
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", resource_metadata="https://market.cascade.fyi/.well-known/oauth-protected-resource"
```

**Token Verification (AuthInfo for MCP SDK):**

```typescript
interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];        // e.g., ["tabs:spend", "services:read"]
  expiresAt?: number;      // seconds since epoch
  resource?: URL;
  extra?: {
    walletAddress: string; // Solana address from SIWS
  };
}
```

### Why Not Refactor Existing Apps?

- Existing apps have their own patterns and quirks
- Refactoring = fighting existing decisions
- Fresh start = faster, cleaner, fewer bugs

---

## Overview

```
Developer Experience:

$ cascade --token csc_xxx localhost:3000

✓ Authenticated: twitter-research
✓ Split: 7xK9...3mP → your-wallet.sol
✓ Price: $0.001/call
✓ Live at: https://twitter-research.mcps.cascade.fyi

Dashboard: https://market.cascade.fyi/dashboard
```

**What happens behind the scenes:**
1. CLI establishes tunnel to Cascade edge
2. Platform already created Cascade Split (dev = 99%, protocol = 1%) during registration
3. Public URL assigned, MCP discoverable
4. Incoming requests from OAuth'd clients: Gateway handles payment internally → forwards to MCP
5. Settlements go to split vault (USDC)
6. Platform batches `execute_split()` periodically
7. Dev sees analytics in dashboard

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      MCP CLIENT (e.g., Claude Code)                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Already authenticated via OAuth (has Bearer token)                  │
│     └── Token contains wallet address from SIWS                         │
│                                                                         │
│  2. Makes normal MCP request:                                           │
│     POST https://twitter-research.mcps.cascade.fyi/mcp                  │
│     Authorization: Bearer <token>                                       │
│                                                                         │
│  Client doesn't know about payments - just uses MCP normally            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         MCP GATEWAY                                     │
│                    *.mcps.cascade.fyi                                   │
│         (Part of Market App deployment - Hono + Durable Objects)        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Validate Bearer token → extract wallet address                      │
│                                                                         │
│  2. Lookup service by subdomain (D1)                                    │
│     └── Get split_vault (payTo) and price                               │
│                                                                         │
│  3. Lookup user's Tabs smart account (D1)                               │
│     └── wallet address → Squads smart account address                   │
│                                                                         │
│  4. Build spending limit transaction                                    │
│     └── useSpendingLimit: smart_account → split_vault                   │
│                                                                         │
│  5. Submit to facilitator.cascade.fyi for settlement                    │
│     └── Facilitator verifies + submits tx to Solana                     │
│                                                                         │
│  6. On success → forward request to TunnelRelay DO                      │
│     └── WebSocket relay to developer's local MCP                        │
│                                                                         │
│  7. Return MCP response to client                                       │
│                                                                         │
│  Bazaar extension: advertise MCP for discovery                          │
│  onAfterSettle hook: record payment stats in D1                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Payment lands in split vault
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CASCADE SPLITS                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Split Vault (USDC ATA owned by SplitConfig PDA)                        │
│  ├── Recipients: [ {dev_address, 99%} ]                                 │
│  └── Protocol fee: 1% (Cascade)                                         │
│                                                                         │
│  Platform batches execute_split() periodically                          │
│  └── Distributes vault balance to configured recipients                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Gateway as Unified Payment Handler

The Gateway handles **both** x402 roles internally:

| Function | What it does |
|----------|--------------|
| **Client facilitator** | Builds spending limit tx from user's Tabs smart account |
| **Resource server** | Routes payments to per-service split vaults |
| **Settlement** | Submits to facilitator.cascade.fyi for on-chain execution |

**Why unified:** MCP clients shouldn't know about x402. OAuth gives Gateway the wallet address; Gateway does the rest server-side. Payment is invisible infrastructure.

---

## Existing Infrastructure

| Component | Status | Location |
|-----------|--------|----------|
| **Cascade Splits (Solana program)** | ✅ Deployed | `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB` |
| **splits-sdk** | ✅ Published | `@cascade-fyi/splits-sdk` |

These are internal infrastructure - Market uses them under the hood. Users never interact with them directly.

---

## Components to Build

| Component | Description | Tech |
|-----------|-------------|------|
| **Market App** | Dashboard + Gateway (single deployment) | TanStack Start + Hono + Durable Objects |
| **cascade CLI** | Tunnel client, connects to gateway | Go (urfave/cli, goreleaser) |

> **Note:** Market App and Gateway are a single Cloudflare Workers deployment.
> TanStack Start handles `market.cascade.fyi` (dashboard, server functions).
> Hono handles `*.mcps.cascade.fyi` (x402 payments, tunnels).
> Routing by hostname in custom server entry. Can extract Gateway later if needed.

---

## Directory Structure

```
cascade-splits/
├── apps/
│   └── market/                        # Single deployment: market.cascade.fyi + *.mcps.cascade.fyi
│       ├── src/
│       │   ├── routes/                # TanStack Start file-based routes
│       │   │   ├── __root.tsx         # Root layout with providers
│       │   │   ├── index.tsx          # Landing page
│       │   │   ├── dashboard.tsx      # Services overview
│       │   │   ├── services/
│       │   │   │   ├── index.tsx      # Services list
│       │   │   │   ├── new.tsx        # Create service wizard
│       │   │   │   └── $id.tsx        # Service detail
│       │   │   ├── explore.tsx        # Browse MCPs
│       │   │   ├── pay.tsx            # Client onboarding (embedded Tabs)
│       │   │   ├── .well-known/
│       │   │   │   ├── oauth-protected-resource.ts   # RFC 9728 metadata
│       │   │   │   └── oauth-authorization-server.ts # RFC 8414 metadata
│       │   │   └── oauth/
│       │   │       ├── authorize.tsx  # OAuth consent screen (SIWS)
│       │   │       └── token.ts       # Token endpoint (PKCE)
│       │   │
│       │   ├── components/
│       │   │   ├── Header.tsx         # Responsive header with nav
│       │   │   ├── Dashboard.tsx      # Services overview
│       │   │   ├── About.tsx          # Landing page content
│       │   │   └── ui/                # shadcn/ui components
│       │   │
│       │   ├── server/                # Server functions (D1 CRUD)
│       │   │   ├── services.ts        # createService, getServices, etc.
│       │   │   ├── tokens.ts          # Token generation/validation
│       │   │   ├── auth.ts            # SIWS nonce, verify, JWT
│       │   │   ├── oauth.ts           # OAuth authorize, token endpoints
│       │   │   └── tabs.ts            # buildSpendingLimitTx, Tabs account management
│       │   │
│       │   ├── gateway/               # Hono app for *.mcps.cascade.fyi
│       │   │   ├── index.ts           # x402HTTPResourceServer + routing
│       │   │   └── tunnel.ts          # TunnelRelay Durable Object
│       │   │
│       │   ├── server.ts              # Custom server entry (hostname routing)
│       │   ├── router.tsx             # TanStack Router config
│       │   └── styles.css
│       │
│       ├── public/
│       ├── package.json
│       ├── vite.config.ts
│       └── wrangler.jsonc
│
├── packages/
│   ├── golang/
│   │   └── cli/                       # Cascade CLI (Go)
│   │       ├── main.go                # Entry point (urfave/cli/v3)
│   │       ├── internal/
│   │       │   ├── config/            # Token parsing
│   │       │   │   └── config.go
│   │       │   └── tunnel/            # WebSocket tunnel client
│   │       │       └── client.go
│   │       ├── go.mod
│   │       └── .goreleaser.yaml       # Cross-platform release config
│   ├── tabs-sdk/                      # Existing
│   └── splits-sdk/                    # Existing
│
└── programs/
    └── cascade-splits/                # Solana program
```

---

## Server Entry Point

Custom server entry routes requests by hostname:

```typescript
// apps/market/src/server.ts
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { gatewayApp } from './gateway'

export default createServerEntry({
  async fetch(request, env) {
    const url = new URL(request.url);

    // Gateway: *.mcps.cascade.fyi → Hono (x402, tunnels)
    if (url.hostname.endsWith('.mcps.cascade.fyi')) {
      return gatewayApp.fetch(request, env);
    }

    // Market: market.cascade.fyi → TanStack Start (dashboard, server functions)
    return handler.fetch(request, { context: { env } });
  },
})
```

**Why this pattern:**
- Single deployment, single wrangler config
- Gateway can be extracted to separate app later (just move `src/gateway/`)
- Both access same D1 database (appropriate for single-team MVP)
- Durable Objects defined in wrangler.jsonc, work with either entry point

---

## UI Structure

### Header Navigation

The app uses a responsive Header component instead of sidebar for simpler navigation:

```tsx
// Header with navigation links (when connected)
const navItems = [
  { title: "Dashboard", to: "/" },
  { title: "Explore", to: "/explore" },
  { title: "Pay", to: "/pay" },
];
```

### Responsive Behavior

- **Desktop**: Horizontal navigation bar with links + wallet button
- **Mobile**: Sheet-based slide-out menu (hamburger trigger)
- **Wallet**: Connection button in header, user menu when connected

---

## Developer Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Developer visits market.cascade.fyi                                 │
│     └── Sees landing page with value prop                               │
│     └── Connects Solana wallet                                          │
│                                                                         │
│  2. Navigates to Dashboard → "Create Service"                           │
│     └── Name: "twitter-research"                                        │
│     └── Price: $0.001/call                                              │
│     └── (Receiving address = wallet by default)                         │
│                                                                         │
│  3. Dashboard creates Cascade Split                                     │
│     └── createSplitConfig({                                             │
│           authority: platform_authority,  // For execute_split          │
│           mint: USDC,                                                   │
│           recipients: [{ address: dev_wallet, percentage_bps: 9900 }],  │
│           unique_id: derived_from_service_id                            │
│         })                                                              │
│     └── Dev signs tx, pays ~$2 rent (refundable)                        │
│                                                                         │
│  4. Success modal shows:                                                │
│     └── API token: csc_xxx                                              │
│     └── CLI command: cascade --token csc_xxx localhost:3000             │
│     └── Public URL: https://twitter-research.mcps.cascade.fyi           │
│                                                                         │
│  5. Developer runs CLI locally:                                         │
│                                                                         │
│     $ cascade --token csc_xxx localhost:3000                            │
│                                                                         │
│     ✓ Authenticated: twitter-research                                   │
│     ✓ Live at: https://twitter-research.mcps.cascade.fyi                │
│                                                                         │
│  6. Dashboard shows:                                                    │
│     └── Status: 🟢 Online                                               │
│     └── Stats: calls, revenue, pending distribution                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Client Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ONE-TIME SETUP: Create Tabs Account                                    │
│                                                                         │
│  1. User visits market.cascade.fyi/pay                                  │
│  2. Connects Solana wallet                                              │
│  3. Creates Squads smart account                                        │
│  4. Deposits USDC                                                       │
│  5. Sets daily spending limit (authorizes Gateway as spender)           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  ONE-TIME: Authorize MCP Client (e.g., Claude Code)                     │
│                                                                         │
│  1. User adds MCP server URL to Claude Code config                      │
│  2. Claude Code connects → gets 401 → discovers OAuth                   │
│  3. Browser opens → user signs in (SIWS) + approves                     │
│  4. Claude Code receives tokens, stores locally                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  EVERY REQUEST: Seamless paid MCP usage                                 │
│                                                                         │
│  1. Claude Code makes MCP request with Bearer token                     │
│  2. Gateway handles payment internally (user never sees 402)            │
│  3. Request forwarded to MCP, response returned                         │
│                                                                         │
│  User experience: MCP just works. Payment is invisible.                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Token Design

```typescript
interface ServiceToken {
  serviceId: string;        // Unique service identifier
  splitConfig: string;      // SplitConfig PDA address
  splitVault: string;       // Vault ATA address (payTo)
  price: string;            // Price per call in USDC base units
  createdAt: number;        // Timestamp
  signature: string;        // Platform signature for verification
}

// Encoded as: csc_<base64(JSON.stringify(payload))>
// CLI sends token to Gateway for tunnel authentication
// Gateway verifies token (checks signature field to ensure platform issued it)
```

---

## Gateway Payment Flow

The Gateway handles payments internally for OAuth-authenticated MCP clients:

```typescript
// apps/market/src/gateway/index.ts
import { Hono } from "hono";
import { HTTPFacilitatorClient } from "@x402/http";
import { enableBazaar } from "@x402/extensions/bazaar";
import { verifyAccessToken } from "../server/oauth";
import { buildSpendingLimitTx } from "../server/tabs";

const app = new Hono<{ Bindings: Env }>();
const facilitator = new HTTPFacilitatorClient("https://facilitator.cascade.fyi");

// Lookup helpers
async function getServiceBySubdomain(subdomain: string, db: D1Database) {
  return db.prepare(
    "SELECT split_vault, price, name FROM services WHERE name = ?"
  ).bind(subdomain).first();
}

async function getTabsAccount(walletAddress: string, db: D1Database) {
  return db.prepare(
    "SELECT smart_account, spending_limit FROM tabs_accounts WHERE wallet_address = ?"
  ).bind(walletAddress).first();
}

// MCP routes - Gateway handles payment internally
app.all("/mcp/*", async (c) => {
  const subdomain = c.req.header("host")?.split(".")[0];

  // 1. Validate OAuth token → get wallet address
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="https://market.cascade.fyi/.well-known/oauth-protected-resource"`
      }
    });
  }

  const token = authHeader.slice(7);
  const authInfo = await verifyAccessToken(token, c.env);
  if (!authInfo) {
    return new Response("Invalid token", { status: 401 });
  }

  // 2. Lookup service (payTo, price)
  const service = await getServiceBySubdomain(subdomain!, c.env.DB);
  if (!service) {
    return new Response("Service not found", { status: 404 });
  }

  // 3. Lookup user's Tabs smart account
  const tabsAccount = await getTabsAccount(authInfo.walletAddress, c.env.DB);
  if (!tabsAccount) {
    return new Response("No Tabs account - visit market.cascade.fyi/pay to set up", { status: 402 });
  }

  // 4. Build spending limit transaction
  const paymentTx = await buildSpendingLimitTx({
    smartAccount: tabsAccount.smart_account,
    amount: service.price,
    recipient: service.split_vault,  // payTo = split vault
  });

  // 5. Submit to facilitator for settlement
  const settlement = await facilitator.settle(paymentTx);
  if (!settlement.success) {
    return new Response("Payment failed", { status: 402 });
  }

  // 6. Record payment stats
  await c.env.DB.prepare(
    "UPDATE services SET pending_balance = pending_balance + ?, total_calls = total_calls + 1 WHERE name = ?"
  ).bind(service.price, subdomain).run();

  // 7. Forward to developer's MCP via tunnel
  const tunnelId = c.env.TUNNEL_RELAY.idFromName(subdomain!);
  const tunnel = c.env.TUNNEL_RELAY.get(tunnelId);
  return tunnel.fetch(c.req.raw);
});

// Enable MCP discovery via Bazaar extension
enableBazaar(app, {
  async getResources(context) {
    const services = await context.env.DB
      .prepare("SELECT name, price FROM services WHERE status = 'online'")
      .all();
    return services.results.map((s) => ({
      name: s.name,
      price: s.price,
      endpoint: `https://${s.name}.mcps.cascade.fyi/mcp`,
    }));
  },
});

export default app;
```

### Key Patterns

| Pattern | Usage |
|---------|-------|
| **OAuth → wallet lookup** | Extract wallet from Bearer token, lookup Tabs smart account |
| **Server-side payment** | Gateway builds spending limit tx, not client |
| **HTTPFacilitatorClient** | Submit tx to facilitator.cascade.fyi for on-chain settlement |
| **Dynamic payTo** | Route payments to per-service split vaults by subdomain |
| **Bazaar extension** | Advertise MCPs for client/agent discovery |
| **No 402 to client** | Gateway handles payment before forwarding to MCP |

---

## Database Schema (D1)

```sql
-- Services (one per MCP registration)
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,          -- Subdomain: "twitter-research"
  owner_address TEXT NOT NULL,        -- Developer's Solana wallet

  -- Cascade Split
  split_config TEXT NOT NULL,         -- SplitConfig PDA
  split_vault TEXT NOT NULL,          -- Vault ATA (payTo address)

  -- Pricing
  price TEXT NOT NULL,                -- USDC base units per call

  -- State
  status TEXT DEFAULT 'offline',      -- online/offline
  tunnel_id TEXT,                     -- Active tunnel connection

  -- Stats (denormalized for fast reads)
  total_calls INTEGER DEFAULT 0,
  total_revenue TEXT DEFAULT '0',
  pending_balance TEXT DEFAULT '0',

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  last_connected_at TIMESTAMP,
  last_executed_at TIMESTAMP          -- Last execute_split
);

-- Index for split executor
CREATE INDEX idx_services_pending ON services(pending_balance, last_executed_at)
  WHERE pending_balance > '0';

-- Tabs accounts (user's Squads smart wallet for payments)
CREATE TABLE tabs_accounts (
  wallet_address TEXT PRIMARY KEY,    -- User's Solana wallet (from SIWS)
  smart_account TEXT NOT NULL,        -- Squads smart account address
  spending_limit TEXT NOT NULL,       -- Daily spending limit in USDC base units
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OAuth refresh tokens (for MCP client auth)
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP
);

CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_address);

-- OAuth authorization codes (short-lived, 10min)
CREATE TABLE auth_codes (
  code TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP
);

-- Note: Payment history queried from on-chain indexer (Helius/Solscan), not duplicated here
-- Note: Nonces stored in KV (5min TTL), not D1
```

---

## Implementation Order

1. **Market App Scaffold** - TanStack Start + Vite + Cloudflare + shadcn
2. **Landing + Dashboard UI** - Routes and navigation
3. **Authentication** - SIWS auth flow, JWT sessions
4. **Service Creation Flow** - Split creation → Token generation
5. **Gateway Integration** - Payment handling + TunnelRelay DO
6. **CLI** - Go tunnel client
7. **OAuth for MCP Clients** - OAuth server, consent screen
8. **Client Onboarding** - Tabs account setup at /pay
9. **Explore Page** - MCP discovery

---

## Key Decisions

1. **Solana only** - Simplifies everything, uses existing Tabs + Splits infrastructure

2. **Single app with route separation** - Simpler than multiple apps, can split later

3. **TanStack Start** - Server functions for type-safe D1 CRUD, collocated server/client code, built-in TanStack Query integration

4. **Header-based navigation** - Simpler than sidebar, responsive sheet menu for mobile

5. **Mobile-first** - Header with sheet component handles responsive behavior

6. **Fresh app from scratch** - Cleaner than refactoring existing apps

7. **Developer pays rent** - ~$2 registration (refundable), natural skin in game

8. **Gateway handles payments internally** - For MCP clients, Gateway builds spending limit tx and settles via `facilitator.cascade.fyi`. No separate Tabs service - functionality embedded in Market at `/pay`.

9. **Batched execute_split (deferred)** - Platform bears gas cost (covered by 1%), implement later

10. **Streamable HTTP only** - No stdio MCP support, modern transport only

11. **Single deployment for Market + Gateway** - TanStack Start handles market.cascade.fyi, Hono handles *.mcps.cascade.fyi, hostname routing in server.ts. Can extract Gateway later if needed.

12. **Dynamic payTo by subdomain** - Route payments to per-service split vaults using subdomain lookup

13. **Payment is invisible** - MCP clients never see 402s. Gateway handles payments server-side after OAuth authentication.

14. **Shared D1 access** - Both dashboard and gateway read/write same D1 database directly. Appropriate for single-team MVP. Add API layer later if organizational boundaries require it.

15. **Go for CLI** - Single binary distribution, cross-platform (macOS/Linux/Windows), fast startup. Uses urfave/cli/v3 for CLI framework and goreleaser for releases.

16. **Component strategy** - Fresh shadcn install (new-york style, slate base, OKLCH colors).

17. **Minimal SSR** - Only landing (`/`) and explore (`/explore`) pages use SSR for SEO. All authenticated/wallet routes use `ssr: false` to avoid hydration complexity.

18. **SIWS via Wallet Standard** - Uses native `solana:signIn` feature from Wallet Standard (CAIP-122). No custom package needed - server-side verification only using `@solana/kit`.

19. **30-day stateless JWT** - Simple auth without refresh complexity for dashboard. httpOnly cookie prevents XSS. Re-sign on expiry.

20. **OAuth2 for MCP clients** - Full OAuth2 with PKCE for Claude Code and other MCP clients. Access token (1hr) + refresh token (30d) pattern.

21. **KV for nonces** - Short-lived (5min) nonces in Cloudflare KV, not D1. Faster reads, automatic TTL cleanup.

22. **Architecture ready for multi-chain** - Data model and auth patterns support adding Base later. No UI changes for MVP - Solana only. See ADR-0005 for Base implementation.

---

## Future Considerations (Deferred)

- **Split Executor** - Batch `execute_split()` service for automatic revenue distribution
- **Multi-chain support (Base EVM)** - See ADR-0005 for implementation details
- Custom split configurations (revenue sharing with API providers)
- Subscription/tiered pricing models
