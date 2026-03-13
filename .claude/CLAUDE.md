# Cascade Splits

Permissionless payment splitter. Distributes tokens from vault to recipients by percentage.

**Program ID:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Critical Gotchas

### 1. Unclaimed Flow (Most Important)
Missing recipient ATAs don't cause errors - amounts are **held as unclaimed** in state:
- `execute_split` checks `data_is_empty()` before transfer
- If missing: stores in `unclaimed_amounts[i]`
- Next execution auto-clears if ATA now exists
- **Cannot close/update split until all unclaimed = 0**

### 2. Remaining Accounts Order
```
execute_split: [recipient_ata_0, ..., recipient_ata_N, protocol_ata_LAST]
```
Protocol ATA accessed via `.last().unwrap()` - will panic if missing or wrong position.

### 3. Zero-Copy Struct Size
`SplitConfig` is 1,832 bytes with `#[repr(C)]` padding. Changing fields **breaks deserialization**.

### 4. Percentage Math
- Recipients must sum to **9900 bps** (99%)
- Protocol gets 1% + rounding dust
- Math: `(amount * bps) / 10000` rounds DOWN

### 5. Update/Close Requires Empty State
- Vault must be empty (execute first to distribute)
- All `unclaimed_amounts` must be zero
- `protocol_unclaimed` must be zero

### 6. Two-Step Authority Transfer
Protocol authority transfer requires two transactions:
1. `transfer_protocol_authority` - Sets `pending_authority` (current authority signs)
2. `accept_protocol_authority` - Completes transfer (new authority signs)

Can be overwritten by calling transfer again. Cancel by setting to `Pubkey::default()`.

### 7. TanStack Start + Cloudflare Workers (apps/market)

**Problem:** `cloudflare:workers` imports fail during client bundle build because Rollup can't resolve them.

**Root Cause:** When a route file imports from `@/server/foo.ts`, Rollup walks the entire module tree. If `foo.ts` imports `cloudflare:workers`, the build fails—even with dynamic imports.

**Solution:** Follow Cloudflare's official pattern:

```typescript
// ✅ CORRECT: In route file (e.g., routes/oauth/authorize.tsx)
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";  // Static import OK in route files
import { businessLogic } from "@/server/oauth";  // Pure function, no cloudflare imports

const myServerFn = createServerFn({ method: "POST" })
  .inputValidator((data: MyType) => data)
  .handler(async ({ data }) => {
    // Access env INSIDE the handler - this runs server-side only
    return businessLogic(env.DB, env.JWT_SECRET, data);
  });
```

```typescript
// ✅ CORRECT: In server module (e.g., server/oauth.ts)
// NO cloudflare:workers import here!
export async function businessLogic(
  db: D1Database,
  jwtSecret: string,
  data: MyType
) {
  // Pure function - dependencies passed as parameters
  return db.prepare("...").bind(...).run();
}
```

```typescript
// ❌ WRONG: Server module importing cloudflare:workers
import { env } from "cloudflare:workers";  // Breaks client build!
export async function businessLogic(data: MyType) {
  return env.DB.prepare("...").run();
}
```

**Why it works:** TanStack Start code-splits `createServerFn` handlers from client bundles. The `@cloudflare/vite-plugin` handles `cloudflare:workers` for SSR. By keeping the import in the route file (not shared modules), only server code sees it.

**File organization:**
- `@/server/*.ts` - Pure functions accepting `db`, `jwtSecret`, etc. as params
- `routes/**/*.tsx` - Server functions with `cloudflare:workers` import
- `gateway/*.ts` - Server-only (Hono/Durable Objects), can import directly

## Architecture

```
User Payment → Vault (ATA owned by SplitConfig PDA)
             → execute_split (permissionless)
                → Recipients OR unclaimed
                → Protocol fee (1%)
```

**PDAs:**
- Protocol Config: `["protocol_config"]` - singleton, 105 bytes
- Split Config: `["split_config", authority, mint, unique_id]` - 1,832 bytes
- Vault: ATA with split_config as owner

## SDKs

Two separate packages for Solana and EVM:

### @cascade-fyi/splits-sdk (Solana)

See `packages/splits-sdk/ARCHITECTURE.md` for design rationale.

```typescript
// Core module - instructions + helpers (kit-agnostic, works with any kit version >=2.0.0)
import { executeSplit, isCascadeSplit, createSplitConfig } from '@cascade-fyi/splits-sdk';

// High-level client - WebSocket confirmation (requires kit@5.0)
import { ensureSplitConfig, executeAndConfirmSplit } from '@cascade-fyi/splits-sdk';

// Browser with wallet-adapter
import { createSplitsClient } from '@cascade-fyi/splits-sdk';
import { fromWalletAdapter } from '@cascade-fyi/splits-sdk/web3-compat';
```

Core module returns instructions; transaction building is consumer's responsibility.
High-level client uses discriminated unions (`created`, `updated`, `blocked`, `failed`), not exceptions.

### @cascade-fyi/splits-sdk-evm (Base)

EVM SDK using viem. Splits are **immutable** (no update/close).

**Factory Address:** `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` (Base Mainnet & Sepolia)

```typescript
// High-level client
import { createEvmSplitsClient } from '@cascade-fyi/splits-sdk-evm/client';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const client = createEvmSplitsClient(base, {
  account: privateKeyToAccount('0x...')
});

const result = await client.ensureSplit({
  uniqueId: '0x...',
  recipients: [{ address: '0xAlice...', share: 60 }, { address: '0xBob...', share: 40 }]
});

// Low-level functions
import { ensureSplit, executeSplit, isCascadeSplit } from '@cascade-fyi/splits-sdk-evm';
```

Result types: `CREATED`, `NO_CHANGE`, `FAILED` for ensure; `EXECUTED`, `SKIPPED`, `FAILED` for execute.

## Release Process

Two separate workflows: **Solana program** (manual) and **SDK packages** (automated via Nx).

### SDK Releases (Automated)

All SDK packages (`splits-sdk`, `splits-sdk-evm`, `tabs-sdk`) use Nx Release with conventional commits.

**Prerequisites:**
- Clean working directory (commit all changes first)
- Use [Conventional Commits](https://conventionalcommits.org): `feat(sdk):`, `fix(sdk):`, etc.

**Release workflow:**
```bash
# 1. Preview (always run first)
pnpm nx release --dry-run

# 2. Release (versions, changelogs, npm publish, GitHub releases - all automatic)
pnpm nx release
```

**What happens automatically:**
- Version bump determined from commits (`feat` → minor, `fix` → patch)
- `CHANGELOG.md` generated from commit messages
- `package.json` version updated
- Git commit + tag created
- Pushed to remote
- GitHub release created
- Published to npm

**Packages with no changes are skipped** (idempotent).

### Solana Program Release (Manual)

On-chain program deployment requires manual steps for security.

**Pre-release checklist:**
1. Update version in `programs/cascade-splits/Cargo.toml`
2. Update `programs/cascade-splits/CHANGELOG.md`
3. Update `docs/specification.md` version

**Build & Deploy:**
```bash
VERSION="X.Y.Z"
DEPLOYER="~/.config/solana/deployer.json"

# Pre-flight
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
pnpm check && pnpm test:all
git diff --quiet && git diff --cached --quiet

# Verifiable build
anchor build --verifiable
cp target/verifiable/cascade_splits.so target/deploy/cascade_splits.so
cp target/idl/cascade_splits.json packages/splits-sdk/idl.json

# Test → Deploy devnet → Test → Deploy mainnet → Test
anchor test --skip-build --provider.cluster localnet
anchor upgrade target/verifiable/cascade_splits.so \
  --program-id SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB \
  --provider.cluster devnet --provider.wallet $DEPLOYER
anchor test --skip-build --skip-deploy --provider.cluster devnet

git add -A && git commit -m "chore(solana-program): release v${VERSION}"

anchor upgrade target/verifiable/cascade_splits.so \
  --program-id SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB \
  --provider.cluster mainnet --provider.wallet $DEPLOYER
anchor test --skip-build --skip-deploy --provider.cluster mainnet

# Tag, push, verify
git tag "solana-program@v${VERSION}"
git push origin main --tags

solana-verify verify-from-repo --remote -y \
  --url https://api.mainnet-beta.solana.com \
  --program-id SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB \
  https://github.com/cascade-protocol/splits \
  --library-name cascade_splits \
  --commit-hash $(git rev-parse HEAD) \
  --keypair $DEPLOYER

# Create GitHub release
gh release create "solana-program@v${VERSION}" \
  --title "solana-program v${VERSION}" \
  --generate-notes
```

Verify at: `https://verify.osec.io/status/SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Testing

| Layer | Command | Description |
|-------|---------|-------------|
| Rust | `pnpm test:rust` | Mollusk instruction tests |
| splits-sdk (Solana) | `pnpm test:sdk` | Vitest + LiteSVM |
| splits-sdk-evm | `pnpm --filter @cascade-fyi/splits-sdk-evm test` | Vitest + mocked viem |
| EVM Contracts | `cd contracts && forge test` | Foundry tests |
| EVM Fork Tests | `cd contracts && forge test --fork-url base_sepolia` | Fork tests against deployed contracts |
| Integration | `pnpm test` | Anchor + localnet |
| All | `pnpm test:all` | Everything |

**Principle:** Mollusk tests all errors. Smoke tests only Token-2022 CPI and real network behavior.

# Nx Monorepo

## Nx Commands

| Command | Description |
|---------|-------------|
| `pnpm nx run-many -t build` | Build all projects |
| `pnpm nx run-many -t test` | Test all projects |
| `pnpm nx run-many -t check` | Type-check + lint all projects |
| `pnpm nx release --dry-run` | Preview SDK releases |
| `pnpm nx release` | Release SDKs (version, changelog, publish) |
| `pnpm nx show projects` | List all projects |
| `pnpm nx graph` | Visualize project graph |
