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
│   └── CLI tunnel + dashboard at market.cascade.fyi
│
└── For Clients ──────── Pay for MCPs seamlessly
    └── One-time Tabs setup, then OAuth per MCP client
    └── Payments happen invisibly via Gateway
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
│  2. Enter service name (becomes subdomain: name.mcps.cascade.fyi)           │
│  3. Set price per call (e.g., $0.001)                                       │
│  4. Click "Create Service"                                                  │
│  5. Sign transaction → creates Cascade Split on-chain                       │
│  6. Receive CLI token (csc_xxx)                                             │
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
│  $ cascade --token csc_xxx localhost:3000                                   │
│                                                                             │
│  ✓ Authenticated: twitter-research                                          │
│  ✓ Price: $0.001/call                                                       │
│  ✓ Live at: https://twitter-research.mcps.cascade.fyi                       │
│                                                                             │
│  Outcome: MCP is publicly accessible, payments routed to Split              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  ONGOING: Monitor & Collect Revenue                                         │
│  market.cascade.fyi/dashboard                                               │
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

**Total steps:** 6 to go live, then CLI running whenever serving

---

### 2.2 Client Journey (MCP Consumer)

**Goal:** "I want to use paid MCP services from Claude Code"

**Prerequisites:** Solana wallet with USDC

**Key principle:** Zero upfront commitment. All setup happens just-in-time during OAuth.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Browse MCPs                                                        │
│  market.cascade.fyi/explore                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Visit site (no wallet needed)                                           │
│  2. Browse available services                                               │
│  3. Copy MCP URL (e.g., https://twitter-research.mcps.cascade.fyi)          │
│                                                                             │
│  NO WALLET REQUIRED - user can explore freely                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Add to Claude Code                                                 │
│  Claude Code settings (outside our app)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  4. Add MCP server URL to Claude Code config                                │
│  5. Claude Code connects → receives 401 → triggers OAuth                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Authorize (All-in-One)                                             │
│  Browser opens market.cascade.fyi/oauth/authorize                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  OAuth flow handles everything: wallet, Tabs setup, SIWS, authorization     │
│                                                                             │
│  ┌─ State A: No wallet connected ────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │  Connect your wallet to authorize Claude Code                         │  │
│  │                                                                       │  │
│  │  [Connect Wallet]                                                     │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  6. Connect wallet                                                          │
│                                    ↓                                        │
│  ┌─ State B: No Tabs account (first-time user) ──────────────────────────┐  │
│  │                                                                       │  │
│  │  Set up your payment account to continue                              │  │
│  │                                                                       │  │
│  │  Deposit: [$10]  [$25]  [$50]  [Custom]                               │  │
│  │  Daily Limit: [$5/day]  [$10/day]  [$25/day]  [No limit]              │  │
│  │                                                                       │  │
│  │  [Create Account & Deposit]                                           │  │
│  │                                                                       │  │
│  │  🔒 Non-custodial · Powered by Squads Protocol                        │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  7. Select deposit + limit, sign setup transaction                          │
│     (SKIPPED if user already has Tabs account)                              │
│                                    ↓                                        │
│  ┌─ State C: Needs SIWS ─────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │  Sign in to prove wallet ownership                                    │  │
│  │                                                                       │  │
│  │  [Sign Message with Wallet]                                           │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  8. Sign SIWS message                                                       │
│                                    ↓                                        │
│  ┌─ State D: Ready to authorize ─────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │  ✓ Verified: DYw8...abc                                               │  │
│  │  ✓ Balance: $10.00 USDC                                               │  │
│  │                                                                       │  │
│  │  Claude Code wants to pay for MCPs on your behalf.                    │  │
│  │  Daily limit: $10.00/day                                              │  │
│  │                                                                       │  │
│  │  [Deny]                    [Authorize]                                │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  9. Click "Authorize"                                                       │
│  10. Redirected back to Claude Code with tokens                             │
│                                                                             │
│  Outcome: Everything set up, Claude Code authorized                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  ONGOING: Use MCPs                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Claude Code sends request → Gateway validates OAuth → Gateway pays from    │
│  user's Tabs account → forwards to MCP → response returned                  │
│                                                                             │
│  User sees nothing - payments are invisible                                 │
│  User can manage account anytime at /pay (optional)                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Total steps:** 10 for first MCP (3 wallet interactions), then seamless

**Returning user (has Tabs):** Steps 6→8→9→10 only (2 wallet interactions)

**Key UX decisions:**
- Zero upfront commitment — browse without wallet
- Just-in-time setup — Tabs created during OAuth if needed
- Single transaction for Tabs setup (account + deposit + limit bundled)
- Smart defaults reduce decisions ($10 deposit, $10/day limit)
- /pay is optional account management, not required setup

---

## 3. System Architecture

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CASCADE MARKET                                    │
│                     Single Cloudflare Workers Deployment                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  market.cascade.fyi (TanStack Start)                                        │
│  ├── /                    Landing page                                      │
│  ├── /explore             Browse MCPs (SSR for SEO)                         │
│  ├── /pay                 Optional account management (deposit/withdraw)    │
│  ├── /dashboard           Supplier's service management                     │
│  ├── /services/new        Create new service                                │
│  ├── /services/$id        Service details                                   │
│  ├── /oauth/authorize     OAuth + just-in-time Tabs setup + SIWS            │
│  ├── /oauth/token         Token exchange                                    │
│  └── /.well-known/*       OAuth discovery endpoints                         │
│                                                                             │
│  *.mcps.cascade.fyi (Hono Gateway)                                          │
│  ├── /mcp/*               x402 payment + tunnel forwarding                  │
│  ├── /tunnel/connect      CLI WebSocket endpoint                            │
│  └── /discovery/resources Bazaar extension                                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Bindings                                                                   │
│  ├── D1: services, tokens, auth_codes, refresh_tokens                       │
│  ├── KV: rate limiting, nonces                                              │
│  └── Durable Objects: TunnelRelay (WebSocket hibernation)                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              CASCADE CLI                                    │
│                           Go binary (goreleaser)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  $ cascade --token csc_xxx localhost:3000                                   │
│                                                                             │
│  - Connects WebSocket to *.mcps.cascade.fyi/tunnel/connect                  │
│  - Forwards requests to local MCP server                                    │
│  - Returns responses through tunnel                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            ON-CHAIN (SOLANA)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Cascade Splits Program (SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB)       │
│  ├── SplitConfig PDA: per-service, holds recipient config                   │
│  └── Vault ATA: receives payments, owned by SplitConfig                     │
│                                                                             │
│  Squads v4 (Tabs accounts)                                                  │
│  ├── Multisig PDA: derived from user wallet (create_key)                    │
│  ├── Vault: holds user's USDC                                               │
│  └── SpendingLimit: authorizes Gateway to spend up to daily limit           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Supplier Data Flow

```
Developer creates service:

  Browser                    Market                      Solana
     │                          │                           │
     │  1. Create service       │                           │
     │  (name, price)           │                           │
     │ ─────────────────────────>                           │
     │                          │                           │
     │                          │  2. Build createSplit tx  │
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
     │                          │  6. Store service in D1   │
     │                          │  (name, splitConfig,      │
     │                          │   vault, price, owner)    │
     │                          │                           │
     │  7. Return CLI token     │                           │
     │ <─────────────────────────                           │
     │                          │                           │


Developer connects CLI:

  CLI                       Gateway (DO)                  D1
   │                            │                          │
   │  1. WebSocket connect      │                          │
   │  + X-SERVICE-TOKEN header  │                          │
   │ ──────────────────────────>│                          │
   │                            │                          │
   │                            │  2. Verify token sig     │
   │                            │  3. Decode service info  │
   │                            │                          │
   │                            │  4. Update status        │
   │                            │ ────────────────────────>│
   │                            │                          │
   │  5. Connected              │                          │
   │ <──────────────────────────│                          │
   │                            │                          │
```

### 3.3 Client Data Flow

```
Client uses MCP:

  Claude Code              Gateway                   Solana              MCP (via CLI)
      │                       │                         │                      │
      │  1. MCP request       │                         │                      │
      │  Authorization:       │                         │                      │
      │  Bearer <token>       │                         │                      │
      │ ─────────────────────>│                         │                      │
      │                       │                         │                      │
      │                       │  2. Verify OAuth token  │                      │
      │                       │  → extract wallet addr  │                      │
      │                       │                         │                      │
      │                       │  3. Derive Tabs PDAs    │                      │
      │                       │  from wallet address    │                      │
      │                       │                         │                      │
      │                       │  4. Build spending      │                      │
      │                       │  limit tx               │                      │
      │                       │ ───────────────────────>│                      │
      │                       │                         │                      │
      │                       │  5. Settle via          │                      │
      │                       │  facilitator            │                      │
      │                       │ ───────────────────────>│                      │
      │                       │                         │                      │
      │                       │  6. Forward request     │                      │
      │                       │ ──────────────────────────────────────────────>│
      │                       │                         │                      │
      │                       │  7. MCP response        │                      │
      │                       │ <──────────────────────────────────────────────│
      │                       │                         │                      │
      │  8. Response          │                         │                      │
      │ <─────────────────────│                         │                      │
      │                       │                         │                      │
```

---

## 4. Key Decisions

### 4.1 Authentication

| Context | Auth Method | Rationale |
|---------|-------------|-----------|
| Browsing /explore | None | Public data, zero friction |
| Browsing site (general) | Wallet connection only | No private data shown |
| Viewing Tabs balance at /pay | Wallet connection only | On-chain data is public |
| Deposit/Withdraw at /pay | Transaction signature | Wallet signs tx |
| Creating service | Transaction signature | Wallet signs tx |
| **OAuth authorization** | **Connect + Tabs setup (if needed) + SIWS** | All-in-one onboarding |

**Decision:** Just-in-time setup. Users can browse without wallet. All onboarding (wallet connection, Tabs account creation, SIWS) happens during OAuth authorization flow. This minimizes upfront friction and only asks for commitment when user demonstrates intent.

**Pattern:** Don't ask for commitment until user shows intent (common in web3: Uniswap, OpenSea, etc.)

### 4.2 Tabs Data Storage

| Approach | Pros | Cons |
|----------|------|------|
| D1 table | Fast lookup (~5ms) | Sync issues, stale data |
| **On-chain only** | **Always correct, no sync** | Slower lookup (~100-200ms) |

**Decision:** On-chain only. All Tabs account data derived from chain:

```typescript
function getTabsAccountPdas(userWallet: Address) {
  // Deterministic: same wallet always → same smart account
  const [multisigPda] = getMultisigPda({ createKey: userWallet });
  const [spendingLimitPda] = getSpendingLimitPda({
    multisig: multisigPda,
    createKey: GATEWAY_PUBKEY,
  });
  const vaultAta = getAssociatedTokenAddress(multisigPda, USDC_MINT);

  return { multisigPda, spendingLimitPda, vaultAta };
}
```

**Lookup flow:**
1. Derive PDAs from connected wallet
2. Batch fetch accounts from RPC
3. If multisig exists → has Tabs account
4. Parse balance from vault ATA
5. Parse spending limit status from SpendingLimit account

**Caching:** Optional KV cache (30s TTL) for `/pay` page loads.

### 4.3 Tabs Setup Transaction

**Decision:** Bundle account creation, deposit, and spending limit into ONE transaction.

```typescript
const setupTx = await buildTabsSetupTx({
  owner: userWallet,
  depositAmount: 10_000_000n,  // 10 USDC
  dailyLimit: 10_000_000n,     // $10/day
  spender: GATEWAY_ADDRESS,
});
// User signs once, everything is set up
```

### 4.4 Service Token Design

Tokens are self-contained (JWT-like), signed by platform:

```typescript
interface ServiceTokenPayload {
  serviceId: string;      // Unique identifier (= splitConfig address)
  splitConfig: string;    // SplitConfig PDA
  splitVault: string;     // Vault ATA (payTo)
  price: string;          // USDC base units per call
  createdAt: number;
}

// Format: csc_<base64(JSON + HMAC signature)>
```

Token contains everything Gateway needs. Gateway verifies HMAC signature.

### 4.5 OAuth Tokens

| Token | Lifetime | Storage | Purpose |
|-------|----------|---------|---------|
| Access Token | 1 hour | Client memory | Bearer auth for MCP requests |
| Refresh Token | 30 days | D1 (hashed) | Obtain new access tokens |

Access token payload:
```typescript
{
  sub: "DYw8...abc",           // Wallet address (from SIWS)
  client_id: "https://...",   // MCP client URL
  scope: "tabs:spend",        // Authorized scopes
  exp: 1702304400,            // Expiry
}
```

### 4.6 Gateway Payment Flow

Gateway acts as both resource server and payment handler:

1. Validate OAuth Bearer token → extract wallet address
2. Lookup service by subdomain (D1) → get price, splitVault
3. Derive user's Tabs smart account PDA from wallet
4. Build Squads spending limit transaction (smart account → splitVault)
5. Submit to facilitator.cascade.fyi for settlement
6. On success → forward request to TunnelRelay DO
7. Return MCP response to client

**Key point:** Client never sees 402. Gateway handles payment invisibly.

### 4.7 Other Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Just-in-time onboarding | All client setup in OAuth flow, zero upfront friction |
| 2 | Solana only (MVP) | Simplifies everything, uses existing Splits + Squads |
| 3 | Single deployment (Market + Gateway) | Simpler ops, can split later |
| 4 | TanStack Start | Server functions, type-safe RPC, TanStack Query integration |
| 5 | Header navigation | Simpler than sidebar, responsive sheet for mobile |
| 6 | Fresh app (not refactor) | Cleaner than fighting existing patterns |
| 7 | Developer pays Split rent (~$2) | Natural skin in game, refundable |
| 8 | Go for CLI | Single binary, cross-platform, fast startup |
| 9 | Minimal SSR | Only `/` and `/explore` for SEO |
| 10 | Streamable HTTP only | No stdio MCP support |
| 11 | 99/1 revenue split | Developer gets 99%, protocol 1% |

---

## 5. Implementation Reference

### 5.1 Routes

| Route | SSR | Auth | Purpose |
|-------|-----|------|---------|
| `/` | ✅ | None | Landing page |
| `/explore` | ✅ | None | Browse MCPs (SEO) |
| `/pay` | ❌ | Wallet connected | Optional account management (deposit, withdraw, limits) |
| `/dashboard` | ❌ | Wallet connected | Supplier service list |
| `/services/new` | ❌ | Wallet connected | Create service |
| `/services/$id` | ❌ | Wallet connected | Service details |
| `/oauth/authorize` | ❌ | Multi-step* | OAuth consent + just-in-time Tabs setup |
| `/oauth/token` | - | - | Token exchange (API) |
| `/.well-known/*` | - | - | OAuth discovery (API) |

*`/oauth/authorize` handles: wallet connection → Tabs setup (if needed) → SIWS → authorization

### 5.2 Directory Structure

```
apps/market/
├── src/
│   ├── routes/
│   │   ├── __root.tsx
│   │   ├── index.tsx
│   │   ├── explore.tsx
│   │   ├── pay.tsx              # Optional account management
│   │   ├── dashboard.tsx
│   │   ├── services/
│   │   │   ├── new.tsx
│   │   │   └── $id.tsx
│   │   ├── oauth/
│   │   │   ├── authorize.tsx    # Multi-step: connect → Tabs setup → SIWS → consent
│   │   │   └── token.ts
│   │   └── [.]well-known/
│   │       ├── oauth-protected-resource.ts
│   │       └── oauth-authorization-server.ts
│   │
│   ├── components/
│   │   ├── ui/                  # shadcn/ui
│   │   ├── tabs/                # Tabs-specific components
│   │   │   ├── SetupWizard.tsx  # Used in /oauth/authorize and /pay
│   │   │   ├── AccountCard.tsx  # Balance display, used in /pay
│   │   │   └── DepositModal.tsx
│   │   ├── Header.tsx
│   │   └── ...
│   │
│   ├── gateway/
│   │   ├── index.ts             # Hono app
│   │   └── tunnel.ts            # TunnelRelay DO
│   │
│   ├── server/
│   │   ├── services.ts          # D1 CRUD for services
│   │   ├── tokens.ts            # Service token generation
│   │   └── oauth.ts             # OAuth logic
│   │
│   ├── lib/
│   │   ├── tabs.ts              # Squads/Tabs helpers
│   │   └── utils.ts
│   │
│   └── server.ts                # Hostname routing
│
├── schema.sql
└── wrangler.jsonc

packages/golang/cli/
├── main.go
├── internal/
│   ├── config/                  # Token parsing
│   └── tunnel/                  # WebSocket client
└── .goreleaser.yaml
```

### 5.3 Database Schema (D1)

```sql
-- Services: one per MCP registration
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,          -- Subdomain
  owner_address TEXT NOT NULL,        -- Developer's wallet

  -- On-chain references
  split_config TEXT NOT NULL,         -- SplitConfig PDA
  split_vault TEXT NOT NULL,          -- Vault ATA

  -- Config
  price TEXT NOT NULL,                -- USDC base units per call

  -- State
  status TEXT DEFAULT 'offline',      -- online/offline

  -- Stats
  total_calls INTEGER DEFAULT 0,
  total_revenue TEXT DEFAULT '0',
  pending_balance TEXT DEFAULT '0',

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  last_connected_at TEXT
);

CREATE INDEX idx_services_owner ON services(owner_address);
CREATE INDEX idx_services_name ON services(name);

-- Service tokens (optional, for revocation)
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id),
  token_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT
);

-- OAuth authorization codes (10-minute TTL)
CREATE TABLE auth_codes (
  code TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- OAuth refresh tokens (30-day TTL)
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
```

**Note:** No `tabs_accounts` table. Tabs data is derived from on-chain.

### 5.4 Build Order

1. **OAuth authorize with Tabs setup** — Multi-step flow: connect → setup → SIWS → consent
2. **Tabs on-chain lookups** — Derive PDAs, fetch balance/limits from chain
3. **Gateway Tabs integration** — Use Squads spending limit for payments
4. **Service creation with D1** — Persist service after Split creation
5. **Dashboard** — List user's services from D1
6. **Service status updates** — CLI connect/disconnect updates D1
7. **/pay account management** — Optional deposit/withdraw/limit changes

---

## 6. Open Questions

### Resolved in This ADR
- ✅ Where to store Tabs accounts → On-chain only
- ✅ When to require SIWS → OAuth only
- ✅ How many transactions for setup → One bundled tx
- ✅ When to require wallet/Tabs setup → Just-in-time during OAuth (not upfront)

### Deferred
- Split executor (batch `execute_split`) — Platform bears gas, implement later
- Multi-chain support (Base) — See ADR-0005
- Custom split configurations — Revenue sharing with API providers
- Subscription/tiered pricing

---

## 7. Existing Infrastructure

| Component | Status | Reference |
|-----------|--------|-----------|
| Cascade Splits (Solana) | ✅ Deployed | `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB` |
| splits-sdk | ✅ Published | `@cascade-fyi/splits-sdk` |
| tabs-sdk | ✅ Published | `@cascade-fyi/tabs-sdk` |
| Squads v4 | ✅ External | squads.so |
