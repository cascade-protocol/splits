# SDK Architecture

## Quick Start

```typescript
// Core module - instructions + helpers (kit-agnostic, works with any kit version)
import { executeSplit, isCascadeSplit, deriveSplitConfig } from '@cascade-fyi/splits-sdk/solana';

// High-level client - WebSocket confirmation (requires kit@5.0)
import { ensureSplitConfig, executeAndConfirmSplit } from '@cascade-fyi/splits-sdk/solana/client';

// Browser with wallet-adapter
import { createSplitsClient } from '@cascade-fyi/splits-sdk/solana/client';
import { fromWalletAdapter } from '@cascade-fyi/splits-sdk/solana/web3-compat';
```

## Module Structure

```
./solana           → Core: instructions + helpers + types (kit-agnostic, works with any kit version)
./solana/client    → High-level convenience for browser/dashboard (kit@5.0 + WebSocket)
./solana/generated → Codama-generated types and encoders
./solana/web3-compat → @solana/web3.js ↔ @solana/kit conversion utilities
```

## Core Principle: Instructions vs Transactions

The core module (`/solana`) only builds **instructions**, not transactions. This enables:

1. **Kit version compatibility** — Core works with `@solana/kit` >=2.0.0
2. **Flexible signing flows** — Consumers use their own transaction building
3. **Custom confirmation** — Consumers choose polling, WebSocket, or fire-and-forget

```typescript
// Core returns instruction
const result = await executeSplit(rpc, vault, executor);
if (result.ok) {
  // YOU build and send the transaction
  const tx = buildYourTransaction([result.instruction], signer);
  await sendYourTransaction(tx);
}
```

## Design Decisions

| Decision | Reasoning |
|----------|-----------|
| Core returns instructions | Enables kit version compatibility. Consumers have their own tx/confirmation logic. |
| `@solana/kit` over web3.js | Kit is Solana's official successor. Better types, tree-shaking, functional API. web3.js support via adapters for existing wallets. |
| Result types, not exceptions | `BLOCKED` is valid state, not error. All outcomes explicit. |
| `seed` parameter | Controls identity. Same label = same split across chains. |
| Client factory + direct functions | Factory for stateful apps, direct for one-off scripts. Same impl. |
| ATA validation upfront | On-chain allows missing ATAs (funds go to unclaimed). SDK prevents this. |
| Caching (`isCascadeSplit`, protocol config) | Facilitators check every payment. Status rarely changes. |

## Layers

| Layer | Module | When to use |
|-------|--------|-------------|
| Instructions | `/solana` | **Default** — build your own transactions |
| High-level | `/solana/client` | Browser apps, WebSocket available |
| Client factory | `/solana/client` | Stateful apps with persistent wallet |

---

## Solana-Specific

### Why `/solana/client` Requires kit@5.0

`@solana/kit` v5 has different transaction-building APIs than v2.x. The high-level client uses WebSocket-based confirmation which requires kit@5.0's `sendAndConfirmTransactionFactory`.

The core module avoids this by returning instructions only — no transaction building, no confirmation.

### Why `/solana/web3-compat` Separate

Core uses only `@solana/kit`. Web3.js bridge is opt-in:
- Tree-shaking — kit-only users don't bundle web3.js
- Clear boundary — explicit legacy bridge
