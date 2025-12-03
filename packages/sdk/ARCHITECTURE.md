# SDK Architecture

## Quick Start

```typescript
// HTTP-only (most servers)
import { sendEnsureSplit, sendExecuteSplit, isCascadeSplit } from '@cascade-fyi/splits-sdk/solana';

// WebSocket available
import { ensureSplitConfig, executeAndConfirmSplit } from '@cascade-fyi/splits-sdk/solana';

// Browser with wallet-adapter
import { createSplitsClient } from '@cascade-fyi/splits-sdk/solana/client';
import { fromWalletAdapter } from '@cascade-fyi/splits-sdk/solana/web3-compat';
```

## Core: `ensure` is the primary interface

Idempotent operation — call repeatedly, get consistent result:
- Not exists → creates
- Exists, different config → updates
- Exists, same config → no-op

## Design Decisions

| Decision | Reasoning |
|----------|-----------|
| `@solana/kit` over web3.js | Kit is Solana's official successor. Better types, tree-shaking, functional API. web3.js support via adapters for existing wallets. |
| Result types, not exceptions | `BLOCKED` is valid state, not error. All outcomes explicit. |
| `seed` parameter | Controls identity. Same label = same split across chains. |
| Client factory + direct functions | Factory for stateful apps, direct for one-off scripts. Same impl. |
| Instruction builders exposed | Facilitators have own tx/confirmation logic. Don't force ours. |
| ATA validation upfront | On-chain allows missing ATAs (funds go to unclaimed). SDK prevents this. |
| Caching (`isCascadeSplit`, protocol config) | Facilitators check every payment. Status rarely changes. |

## Layers

| Layer | When to use |
|-------|-------------|
| `ensure` | **Default** — idempotent create/update |
| `create` | UI "Create" button — always new (unique seed) |
| Instruction builders | Custom tx building, own confirmation |

---

## Solana-Specific

### Why Two Confirmation Paths

`@solana/kit` confirmation requires WebSocket. Many servers only have HTTP.

| Function | Transport | Use when |
|----------|-----------|----------|
| `ensureSplitConfig()` | WebSocket | Have `rpcSubscriptions` |
| `sendEnsureSplit()` | HTTP polling | HTTP-only environment |

### Why Three Files for `ensure`

```
client/ensure.ts        Core business logic
ensureSplitConfig.ts    Thin wrapper → WebSocket (via fromKitSigner)
sendEnsureSplit.ts      Standalone → HTTP polling
```

**Why duplication in `sendEnsureSplit`?** Can't use `fromKitSigner` (requires WebSocket). Extracting shared logic is future improvement.

**Why not a flag?** WebSocket dependency is structural in kit. Would break tree-shaking for HTTP-only users.

### Why `/solana/web3-compat` Separate

Core uses only `@solana/kit`. Web3.js bridge is opt-in:
- Tree-shaking — kit-only users don't bundle web3.js
- Clear boundary — explicit legacy bridge
