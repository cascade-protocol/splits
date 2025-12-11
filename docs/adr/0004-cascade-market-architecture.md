# ADR-0004: Cascade Market Architecture

**Date:** 2025-12-11
**Status:** Accepted
**Goal:** Build "ngrok for paid MCPs" - MCP monetization platform that drives Cascade Splits adoption

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
Cascade Ecosystem
│
├── Market (PRIMARY) ─────── Main consumer-facing product at cascade.fyi
│   └── MCP devs monetizing + Clients paying via Tabs under the hood
│
├── Tabs (DEVELOPER TOOL) ── SDK/API for payment integration
│   └── Devs building custom x402 integrations
│
└── Splits (DEVELOPER TOOL) ─ SDK/API for revenue splitting
    └── Devs using splitting protocol directly
```

**Market abstracts away Tabs + Splits.** Users don't need to know they exist. Developers building custom solutions access them via `/tabs` and `/splits` routes.

---

## Architecture Decisions

### Single App with Route-Based Separation

One unified app at `cascade.fyi` with distinct route trees:

```
cascade.fyi/              → Market landing + dashboard (consumer-focused)
cascade.fyi/dashboard     → Services dashboard
cascade.fyi/services/new  → Create service wizard
cascade.fyi/explore       → Browse MCPs
cascade.fyi/pay           → Client onboarding (Tabs embedded)
cascade.fyi/tabs          → Tabs developer console
cascade.fyi/splits        → Splits developer console
```

**Rationale:** Single deployment, shared wallet state, one codebase. Can migrate to separate apps later if needed.

### Tech Stack

| Choice | Decision | Rationale |
|--------|----------|-----------|
| **Framework** | TanStack Start | Server functions, type-safe RPC, file-based routing, TanStack Query integration |
| **Bundler** | Vite + Cloudflare plugin | Runs in actual Workers runtime locally |
| **Deployment** | Cloudflare Workers | Modern full-stack approach, D1/KV bindings |
| **Styling** | Tailwind CSS v4 | Primary styling, utility-first |
| **UI Components** | shadcn/ui sidebar template | Built on Tailwind, pre-built responsive layout |
| **Approach** | Mobile-first | Sidebar handles responsive behavior automatically |
| **Starting point** | Fresh `apps/market` | Clean slate, no legacy patterns |

### SSR Strategy

Minimal SSR - only for public/SEO pages:

| Route | SSR | Why |
|-------|-----|-----|
| `/` (landing) | ✅ | SEO, social previews |
| `/explore` | ✅ | Discoverability |
| `/dashboard/*` | ❌ | Authenticated, wallet |
| `/services/*` | ❌ | Authenticated |
| `/pay` | ❌ | Wallet-heavy |
| `/tabs/*` | ❌ | Authenticated |
| `/splits/*` | ❌ | Authenticated |

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

### Why Not Refactor Existing Apps?

- `apps/dashboard` and `apps/tabs` have their own patterns and quirks
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

Dashboard: https://cascade.fyi/dashboard
```

**What happens behind the scenes:**
1. CLI establishes tunnel to Cascade edge
2. Platform already created Cascade Split (dev = 99%, protocol = 1%) during registration
3. Public URL assigned, MCP discoverable
4. Incoming requests: no payment → 402, payment → verify → forward
5. Settlements go to split vault (USDC)
6. Platform batches `execute_split()` periodically
7. Dev sees analytics in dashboard

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Client has Tabs account (Squads smart account + spending limit)     │
│  2. Client uses tabsFetch() to call paid MCP                            │
│                                                                         │
│     tabsFetch("https://twitter.mcps.cascade.fyi/mcp", {                 │
│       tabsApiKey: "tabs_..."                                            │
│     })                                                                  │
│                                                                         │
│  3. On 402 (payTo = split_vault):                                       │
│     └── tabsFetch calls tabs.cascade.fyi/api/settle                     │
│     └── Tabs builds useSpendingLimit tx (smart_account → split_vault)   │
│     └── Returns signed tx                                               │
│                                                                         │
│  4. tabsFetch retries with PAYMENT-SIGNATURE header                     │
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
│  x402HTTPResourceServer (from @x402/hono)                               │
│  ├── Dynamic payTo: lookup split_vault by subdomain                     │
│  ├── Dynamic price: lookup price from service registry                  │
│  ├── Bazaar extension: advertise MCP for discovery                      │
│  └── onAfterSettle hook: record payment for split execution             │
│                                                                         │
│  HTTPFacilitatorClient → tabs.cascade.fyi                               │
│  └── Verifies smart wallet (Squads) payment transactions                │
│                                                                         │
│  TunnelRelay (Durable Object with WebSocket Hibernation)                │
│  └── Forward verified requests to developer's MCP                       │
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

### Tabs vs Gateway (Different x402 Roles)

| | Tabs (`tabs.cascade.fyi`) | Gateway (`*.mcps.cascade.fyi`) |
|---|---|---|
| **x402 Role** | Client facilitator | Resource server |
| **What it does** | Builds spending limit tx for payers | Routes payments to split vaults |
| **Who calls it** | tabsFetch() in client apps | MCP clients making requests |
| **Position in flow** | Before payment sent | After payment received |

Tabs remains separate - it's general-purpose x402 client infrastructure, not specific to Cascade Market.

---

## Existing Infrastructure

| Component | Status | Location |
|-----------|--------|----------|
| **Cascade Splits** | ✅ Deployed | `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB` |
| **Cascade Tabs** | ✅ Deployed | `tabs.cascade.fyi` |
| **tabs-sdk** | ✅ Published | `@cascade-fyi/tabs-sdk` |
| **splits-sdk** | ✅ Published | `@cascade-fyi/splits-sdk` |

---

## Components to Build

| Component | Description | Tech |
|-----------|-------------|------|
| **Market App** | Dashboard + Gateway (single deployment) | TanStack Start + Hono + Durable Objects |
| **cascade CLI** | Tunnel client, connects to gateway | Node.js (can port to Go later) |

> **Note:** Market App and Gateway are a single Cloudflare Workers deployment.
> TanStack Start handles `cascade.fyi` (dashboard, server functions).
> Hono handles `*.mcps.cascade.fyi` (x402 payments, tunnels).
> Routing by hostname in custom server entry. Can extract Gateway later if needed.

---

## Directory Structure

```
cascade-splits/
├── apps/
│   └── market/                        # Single deployment: cascade.fyi + *.mcps.cascade.fyi
│       ├── src/
│       │   ├── routes/                # TanStack Start file-based routes
│       │   │   ├── __root.tsx         # Root layout with SidebarProvider
│       │   │   ├── index.tsx          # Landing page
│       │   │   ├── dashboard.tsx      # Services overview
│       │   │   ├── services/
│       │   │   │   ├── index.tsx      # Services list
│       │   │   │   ├── new.tsx        # Create service wizard
│       │   │   │   └── $id.tsx        # Service detail
│       │   │   ├── explore.tsx        # Browse MCPs
│       │   │   ├── pay.tsx            # Client onboarding (embedded Tabs)
│       │   │   ├── tabs/              # Tabs developer console
│       │   │   └── splits/            # Splits developer console
│       │   │
│       │   ├── components/
│       │   │   ├── app-sidebar.tsx    # shadcn sidebar
│       │   │   ├── nav-main.tsx
│       │   │   ├── nav-user.tsx
│       │   │   └── ...
│       │   │
│       │   ├── server/                # Server functions (D1 CRUD)
│       │   │   ├── services.ts        # createService, getServices, etc.
│       │   │   └── tokens.ts          # Token generation/validation
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
│   ├── cascade-cli/                   # CLI (Node.js initially)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── tunnel.ts
│   │   │   └── config.ts
│   │   └── package.json
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

    // Market: cascade.fyi → TanStack Start (dashboard, server functions)
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

### Sidebar Navigation

```tsx
// Market section (consumer-focused)
const marketNav = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "My Services", url: "/services", icon: Server },
  { title: "Explore", url: "/explore", icon: Search },
]

// Developer tools section
const devNav = [
  { title: "Tabs", url: "/tabs", icon: CreditCard },
  { title: "Splits", url: "/splits", icon: GitBranch },
]

// Sidebar footer = wallet button + user menu
```

### Responsive Behavior (handled by shadcn)

- **Mobile**: Sidebar becomes off-canvas drawer (hamburger trigger)
- **Desktop**: Persistent sidebar, collapsible to icons
- **State**: Persisted via cookie

---

## Developer Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Developer visits cascade.fyi                                        │
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
│  1. Client discovers MCP on cascade.fyi/explore                         │
│                                                                         │
│  2. Clicks "Use this MCP" → redirected to /pay if no Tabs account       │
│                                                                         │
│  3. /pay page (embedded Tabs onboarding):                               │
│     └── Create Squads smart account                                     │
│     └── Deposit USDC                                                    │
│     └── Set daily spending limit                                        │
│     └── Get API key: tabs_xxx                                           │
│                                                                         │
│  4. Client uses tabsFetch() in their code:                              │
│                                                                         │
│     import { tabsFetch } from "@cascade-fyi/tabs-sdk";                  │
│                                                                         │
│     const response = await tabsFetch(                                   │
│       "https://twitter-research.mcps.cascade.fyi/mcp",                  │
│       { tabsApiKey: "tabs_xxx" }                                        │
│     );                                                                  │
│                                                                         │
│  5. tabsFetch handles x402 automatically                                │
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

## x402 Integration

The MCP Gateway uses `x402HTTPResourceServer` from `@x402/hono` with dynamic routing:

```typescript
// apps/market/src/gateway/index.ts
import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/http";
import { enableBazaar } from "@x402/extensions/bazaar";

const app = new Hono<{ Bindings: Env }>();

// Service registry lookup (from D1)
async function getServiceBySubdomain(subdomain: string, db: D1Database) {
  return db.prepare(
    "SELECT split_vault, price, name FROM services WHERE name = ?"
  ).bind(subdomain).first();
}

// Configure x402 resource server
const x402Server = new x402ResourceServer({
  facilitatorClient: new HTTPFacilitatorClient("https://tabs.cascade.fyi/api"),

  // Dynamic payTo: route payments to split vault by subdomain
  payTo: async (context) => {
    const subdomain = context.adapter.getHeader("host")?.split(".")[0];
    const service = await getServiceBySubdomain(subdomain!, context.env.DB);
    return service?.split_vault;
  },

  // Dynamic price: lookup from service registry
  price: async (context) => {
    const subdomain = context.adapter.getHeader("host")?.split(".")[0];
    const service = await getServiceBySubdomain(subdomain!, context.env.DB);
    return service?.price ?? "1000"; // Default $0.001
  },

  hooks: {
    // Record payment for split execution
    onAfterSettle: async (context, payment) => {
      const subdomain = context.adapter.getHeader("host")?.split(".")[0];
      await context.env.DB.prepare(
        "UPDATE services SET pending_balance = pending_balance + ?, total_calls = total_calls + 1 WHERE name = ?"
      ).bind(payment.amount, subdomain).run();
    },
  },
});

// Enable MCP discovery via Bazaar extension
enableBazaar(x402Server, {
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

// Apply payment middleware to MCP routes
app.use("/mcp/*", paymentMiddleware(x402Server));

// Forward verified requests to developer's MCP via tunnel
app.all("/mcp/*", async (c) => {
  const subdomain = c.req.header("host")?.split(".")[0];
  const tunnelId = c.env.TUNNEL_RELAY.idFromName(subdomain!);
  const tunnel = c.env.TUNNEL_RELAY.get(tunnelId);
  return tunnel.fetch(c.req.raw);
});

export default app;
```

### Key x402 Patterns Used

| Pattern | Usage |
|---------|-------|
| **Dynamic payTo** | Route payments to per-service split vaults |
| **Dynamic price** | Per-service pricing from D1 |
| **HTTPFacilitatorClient** | Delegate verify/settle to tabs.cascade.fyi (understands smart wallet payments) |
| **Bazaar extension** | Advertise MCPs for client/agent discovery |
| **onAfterSettle hook** | Update cached stats in D1 for dashboard |

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

-- Note: Payment history queried from on-chain indexer (Helius/Solscan), not duplicated here
```

---

## Implementation Order

1. **Market App Scaffold** - TanStack Start + Vite + Cloudflare + shadcn sidebar
2. **Landing + Dashboard UI** - Basic routes and navigation
3. **Service Creation Flow** - Server functions → Split creation → Token generation
4. **Gateway Integration** - Add gateway/ with x402HTTPResourceServer + TunnelRelay DO
5. **CLI** - Node.js tunnel client (packages/cascade-cli)
6. **Client Onboarding** - Embedded Tabs flow at /pay
7. **Explore Page** - MCP discovery (backed by Bazaar extension)

---

## Key Decisions

1. **Solana only** - Simplifies everything, uses existing Tabs + Splits infrastructure

2. **Single app with route separation** - Simpler than multiple apps, can split later

3. **TanStack Start** - Server functions for type-safe D1 CRUD, collocated server/client code, built-in TanStack Query integration

4. **shadcn sidebar template** - Pre-built responsive layout, removes maintenance burden

5. **Mobile-first** - Sidebar handles responsive behavior automatically

6. **Fresh app from scratch** - Cleaner than refactoring existing dashboard/tabs apps

7. **Developer pays rent** - ~$2 registration (refundable), natural skin in game

8. **Tabs facilitator for everything** - `tabs.cascade.fyi` handles both client-side settlement (tabsFetch) AND Gateway payment verification (understands smart wallet transactions)

9. **Batched execute_split (deferred)** - Platform bears gas cost (covered by 1%), implement later

10. **Streamable HTTP only** - No stdio MCP support, modern transport only

11. **Single deployment for Market + Gateway** - TanStack Start handles cascade.fyi, Hono handles *.mcps.cascade.fyi, hostname routing in server.ts. Can extract Gateway later if needed.

12. **x402HTTPResourceServer with dynamic payTo** - Route payments to per-service split vaults using subdomain lookup

13. **Tabs stays separate** - Different x402 role (client facilitator vs resource server), remains general-purpose infrastructure

14. **Shared D1 access** - Both dashboard and gateway read/write same D1 database directly. Appropriate for single-team MVP. Add API layer later if organizational boundaries require it.

15. **Component strategy** - Fresh shadcn install in market app with same config as dashboard (new-york style, slate base, OKLCH colors). Copy `index.css` color tokens from dashboard for visual consistency. Consolidate to shared `packages/ui` later when both apps stabilize.

16. **Minimal SSR** - Only landing (`/`) and explore (`/explore`) pages use SSR for SEO. All authenticated/wallet routes use `ssr: false` to avoid hydration complexity.

---

## Future Considerations (Deferred)

- **Split Executor** - Batch `execute_split()` service (CF Queue + Worker) for automatic revenue distribution
- **Shared UI package** - Extract common components to `packages/ui` once market app stabilizes
- ERC-8004 integration for on-chain discovery/reputation
- Multi-chain support (Base EVM)
- Custom split configurations (revenue sharing with API providers)
- Subscription/tiered pricing models
- Advanced Bazaar features (capability descriptions, categories, ratings)
