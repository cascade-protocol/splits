# ADR-0005: Base Chain Support

**Date:** 2025-12-11
**Status:** Deferred
**Depends on:** ADR-0004 (Cascade Market Architecture)
**Goal:** Add Base (EVM) support to Cascade Market for multi-chain MCP monetization

---

## Context

ADR-0004 establishes Cascade Market as a Solana-first platform. This ADR outlines the implementation plan for adding Base chain support, enabling MCP developers to receive payments in USDC on Base.

**Why Base:**
- x402 protocol supports both Solana and Base
- Large EVM developer ecosystem
- Low transaction fees (L2)
- Coinbase ecosystem alignment

---

## Prerequisites (from ADR-0004)

Before implementing Base support, the following must be complete:

- [ ] Chain selector UI (shows "Coming Soon" for Base)
- [ ] SIWS authentication working
- [ ] OAuth for MCP clients working
- [ ] Solana payment flow working end-to-end

---

## Architecture

### Chain Selector Behavior

When user switches to Base:
1. Disconnect current Solana wallet
2. Reload page (clean slate)
3. Show EVM wallet connection (wagmi/viem)
4. All services/data scoped to Base

```typescript
type Chain = "solana" | "base";

// Each chain has completely separate:
// - Wallet connection
// - Services list
// - Payment method
// - Auth session (separate JWT)
```

### Authentication: SIWE (Sign-In With Ethereum)

Base uses SIWE instead of SIWS. Same CAIP-122 message format:

```
cascade.fyi wants you to sign in with your Ethereum account:
0xabc...123

Sign in to Cascade Market

URI: https://cascade.fyi
Version: 1
Chain ID: 8453
Nonce: abc123...
Issued At: 2025-12-11T12:00:00Z
```

**Implementation:**
- Use `siwe` npm package (established standard)
- Same JWT structure, different signature verification (ECDSA vs Ed25519)
- Same OAuth flow for MCP clients

### OAuth for MCP Clients (Base)

Same OAuth structure as Solana (see ADR-0004), with chain-specific metadata:

**Protected Resource Metadata (RFC 9728):**

```typescript
// /.well-known/oauth-protected-resource
// Chain determined from context (hostname, session, or x402 network field)
{
  resource: "https://cascade.fyi",
  authorization_servers: ["https://cascade.fyi"],
  scopes_supported: ["spend-permission:use", "services:read"],
  resource_name: "Cascade Market (Base)",
}
```

**OAuth flow is identical to Solana:**
1. MCP client gets 401 → fetches OAuth metadata
2. User authenticates via SIWE (not SIWS)
3. User approves → auth code → tokens
4. If payment required → x402 with Base network (Spend Permissions)

**Important:** OAuth (authentication) and x402 (payments) remain separate concerns.
The only difference is the signature verification method and payment mechanism.

### Payments: Coinbase Smart Wallet Spend Permissions

Unlike Solana (which uses Tabs/Squads smart wallets), Base can use native Coinbase Smart Wallet "Spend Permissions":

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PAYMENT COMPARISON                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SOLANA (Tabs)                      BASE (Spend Permissions)            │
│  ─────────────                      ────────────────────────            │
│  1. User creates Squads wallet      1. User grants spend permission     │
│  2. Deposits USDC                   2. (No deposit needed)              │
│  3. Sets spending limit             3. Permission has limit + expiry    │
│  4. Server calls useSpendingLimit   4. Server executes directly         │
│                                                                         │
│  Funds: In smart wallet             Funds: In user's main wallet        │
│  Complexity: Medium                 Complexity: Low                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why Spend Permissions (not Tabs-equivalent):**
- Native to Coinbase Smart Wallet
- Simpler UX (no deposit step)
- Lower friction for Base users
- Built-in UI in Coinbase Wallet app

### Splits: EVM Splits Contract

Cascade Splits has an EVM version deployed on Base:

| Component | Address |
|-----------|---------|
| **SplitsFactory** | `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` |
| **Chain** | Base Mainnet & Sepolia |

**Key Differences from Solana:**
- Splits are immutable (no update/close)
- Simpler execution (no unclaimed flow)
- Lower rent costs

---

## Data Model Changes

### Services Table

Add `chain` column:

```sql
ALTER TABLE services ADD COLUMN chain TEXT DEFAULT 'solana';

-- Composite unique constraint
CREATE UNIQUE INDEX idx_services_name_chain ON services(name, chain);
```

A service name can exist on both chains:
- `twitter-research` on Solana → `twitter-research.mcps.cascade.fyi` (Solana context)
- `twitter-research` on Base → `twitter-research.mcps.cascade.fyi` (Base context)

Gateway determines chain from authenticated user's context or x402 network field.

### Auth Tables

Add chain to auth tables:

```sql
ALTER TABLE refresh_tokens ADD COLUMN chain TEXT DEFAULT 'solana';
ALTER TABLE auth_codes ADD COLUMN chain TEXT DEFAULT 'solana';
```

### JWT Claims

```typescript
// Solana JWT
{
  sub: "DYw4...abc",     // Solana pubkey
  chain: "solana",
  tabsAccount: "7xK9...",
}

// Base JWT
{
  sub: "0xabc...123",    // EVM address
  chain: "base",
  spendPermissionId: "0x...",
}
```

---

## Implementation Plan

### Phase 1: Authentication

1. **Add SIWE library** - Use `siwe` npm package
2. **Chain-aware auth context** - Separate providers for Solana/Base
3. **Update auth server** - Handle both SIWS and SIWE
4. **Update JWT claims** - Include chain and chain-specific data

### Phase 2: Wallet Integration

1. **Add wagmi/viem** - EVM wallet connection
2. **Coinbase Smart Wallet SDK** - For spend permissions
3. **Chain-aware wallet button** - Shows correct wallet per chain

### Phase 3: Payment Flow

1. **Spend Permission UI** - Request permission on service creation
2. **Gateway integration** - Detect chain, use appropriate payment method
3. **EVM Splits SDK** - Create splits on Base

### Phase 4: Service Creation

1. **Chain selection in wizard** - Pick Solana or Base
2. **EVM Split creation** - Deploy split via factory
3. **Spend permission setup** - User grants permission for payments

---

## Components to Build

| Component | Description |
|-----------|-------------|
| `apps/market/src/lib/evm-wallet.tsx` | wagmi/viem wallet provider |
| `apps/market/src/server/auth-evm.ts` | SIWE verification (uses `siwe` npm package directly) |
| `apps/market/src/components/spend-permission.tsx` | Coinbase Smart Wallet SDK integration |

**Note:** No custom `packages/siwe` needed - use the established `siwe` npm package directly.
Same approach as Solana: no custom SIWS package, use native Wallet Standard `solana:signIn`.

---

## Key Decisions

1. **Separate auth sessions per chain** - Simpler than unified identity
2. **Spend Permissions over custom smart wallet** - Native Coinbase UX
3. **Same service name allowed on both chains** - Gateway routes by context
4. **SIWE package over custom** - Established standard, well-tested
5. **No bridging** - Each chain is independent, no cross-chain complexity

---

## Risks

| Risk | Mitigation |
|------|------------|
| Coinbase SDK changes | Pin versions, abstract behind interface |
| Spend Permission adoption | Fallback to direct payment if needed |
| User confusion (two chains) | Clear UI separation, chain badge on services |

---

## Success Criteria

- [ ] User can connect Base wallet and create service
- [ ] MCP client can authenticate via OAuth on Base
- [ ] Payments flow through Spend Permissions
- [ ] Revenue distributed via EVM Splits
- [ ] Chain selector works seamlessly
