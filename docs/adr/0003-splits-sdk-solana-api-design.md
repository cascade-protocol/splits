# ADR-0003: Splits SDK Solana API Design

**Date:** 2025-12-09
**Status:** Accepted
**Goal:** Define consistent API patterns for @cascade-fyi/splits-sdk Solana module

---

## Problem

The SDK has evolved organically, resulting in inconsistent patterns:

1. **Mixed parameter styles** — Positional args, object params, varying structures
2. **Different result discriminants** — `ok`/`reason` at instruction level vs `status` at client level
3. **Inconsistent casing** — `"CREATED"` (UPPER) vs `"not_found"` (lower_snake)
4. **Manual Token 2022 handling** — Requires explicit `tokenProgram` parameter
5. **Cache management exposed** — Users must manage SDK internals
6. **Vault-centric API** — Functions expect vault address, but users work with SplitConfig PDA
7. **ATA complexity exposed** — Missing ATAs cause unclaimed amounts, blocking updates/closes

---

## 1. API Conventions

### 1.1 Flat Object Parameters

**Principle:** All functions use a single flat object parameter. Simple and consistent.

```typescript
// Core — flat object
const result = await executeSplit({
  rpc,
  splitConfig,
  executor: wallet.address,
});

// Client — flat object (includes optional config)
const result = await executeAndConfirmSplit({
  rpc,
  rpcSubscriptions,
  splitConfig,
  signer,
  minBalance: 1_000_000n,      // Optional
  commitment: 'confirmed',      // Optional
});

// Factory — captures connection, methods take flat object
const client = createSplitsClient({ rpc, rpcSubscriptions, signer });
const result = await client.execute({
  splitConfig,
  minBalance: 1_000_000n,      // Optional
});
```

**Rationale:** Matches `@solana/kit` patterns. One pattern to learn. TypeScript provides autocomplete for required vs optional fields.

---

### 1.2 Result Types — Lowercase `status` Discriminant

**Principle:** Use lowercase `status` discriminant consistently across all layers.

**Before (inconsistent):**
```typescript
// Instruction level
{ ok: true; instruction } | { ok: false; reason: "not_found" }

// Client level
{ status: "CREATED" } | { status: "BLOCKED" }
```

**After (consistent):**
```typescript
// Instruction level
type ExecuteSplitResult =
  | { status: "success"; instruction: IInstruction }
  | { status: "not_found"; splitConfig: Address }
  | { status: "not_a_split"; splitConfig: Address }

// Client level
type EnsureResult =
  | { status: "created"; splitConfig; vault; signature; rentPaid }
  | { status: "no_change"; splitConfig; vault }
  | { status: "updated"; splitConfig; vault; signature }
  | { status: "blocked"; reason; message }
  | { status: "failed"; reason; message; error? }
```

**Rationale:** Lowercase matches modern TypeScript conventions (TanStack Query, tRPC). UPPER_CASE feels like Go/Rust enums.

---

### 1.3 Token Program Auto-Detection

**Principle:** Token 2022 should "just work" without manual intervention.

**Before:**
```typescript
const tokenProgram = await detectTokenProgram(rpc, mint);
const result = await executeSplit({
  rpc,
  splitConfig,
  executor,
  tokenProgram,  // Manual
});
```

**After:**
```typescript
// Auto-detects from mint internally
const result = await executeSplit({
  rpc,
  splitConfig,
  executor,
});

// Override only when needed (rare)
const result = await executeSplit({
  rpc,
  splitConfig,
  executor,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
});
```

**Implementation:** All instruction builders fetch mint info and detect token program if not explicitly provided.

---

### 1.4 Naming Conventions

**Principle:** One source of truth: program IDL → Codama → SDK. No naming divergence.

#### Parameter Names

The `unique_id` field in the on-chain account becomes `uniqueId` in the SDK (camelCase per TypeScript convention), not renamed to `seed` or other alternatives.

```typescript
ensureSplitConfig({
  recipients,
  mint,
  uniqueId: labelToSeed("Revenue Split"),
})

// Or random
ensureSplitConfig({
  recipients,
  mint,
  uniqueId: generateUniqueId(),
})
```

**Utilities:**
- `labelToSeed(label)` — Convert human-readable label to Address (general-purpose)
- `generateUniqueId()` — Generate random 32-byte Address

#### Function Names

Function names align with on-chain program instructions:

| Function | Matches Instruction |
|----------|---------------------|
| `createSplitConfig` | `create_split_config` |
| `executeSplit` | `execute_split` |
| `updateSplitConfig` | `update_split_config` |
| `closeSplitConfig` | `close_split_config` |

Not `createSplit`, `updateSplit`, etc. — the "Config" suffix reflects what's actually being created/updated on-chain.

---

### 1.5 Cache — Internal Only

**Principle:** Users shouldn't manage SDK internals.

**Remove from public API:**
```typescript
// Remove these exports
invalidateSplitCache(splitConfig)
clearSplitCache()
invalidateProtocolConfigCache()
```

**Internal behavior:**
- Positive results (is a split): cached indefinitely
- Negative results (exists, not a split): cached indefinitely
- Non-existent accounts: NOT cached (may be created later)
- Auto-invalidate when `closeSplitConfig()` succeeds

**No TTL needed** — the smart caching logic handles all cases. Closed splits are auto-invalidated.

---

## 2. SplitConfig as Primary Identifier

### Problem

The SDK uses a vault-centric API where all functions expect the vault address:

```typescript
executeSplit(rpc, vault, executor)
updateSplitConfig(rpc, { vault, ... })
closeSplitConfig(rpc, { vault, ... })
```

However, the natural flow creates cognitive dissonance:

1. `createSplitConfig()` returns the SplitConfig PDA as the primary identifier
2. x402 `payTo` uses the SplitConfig PDA
3. `executeSplit()` suddenly requires the vault address

**User impact:** Integrators naturally try passing the SplitConfig PDA to `executeSplit()` and get a confusing `not_a_split` error because the SDK tries to parse it as a token account.

---

### Analysis

#### The Vault is an Implementation Detail

Every operation that currently requires a vault can derive it from the SplitConfig:

| Operation | Needs Vault For | Can Derive? |
|-----------|-----------------|-------------|
| `executeSplit` | Transfer tokens FROM vault | Yes - `config.vault` |
| `updateSplitConfig` | Verify vault empty | Yes - `config.vault` |
| `closeSplitConfig` | Close vault ATA | Yes - `config.vault` |
| `getVaultBalance` | Read token balance | Yes - `config.vault` |
| `isCascadeSplit` | Check if address is a split | Yes - check program ownership |

The 1:1 relationship between SplitConfig and vault means the vault address is always recoverable from the SplitConfig.

#### Why Not Accept Both?

An alternative approach would be to accept either vault or SplitConfig PDA and auto-detect. This creates problems:

| Aspect | Accept Both | SplitConfig-Only |
|--------|-------------|------------------|
| API clarity | Ambiguous - "what should I pass?" | Unambiguous |
| Error messages | "Invalid account" - which type? | "SplitConfig not found" |
| Cache strategy | Dual-key or normalization needed | Single key |
| Code complexity | Polymorphic resolution logic | Direct fetch |
| Type safety | Parameter name lies about what it accepts | Accurate |
| Testing burden | Must test both paths | Single path |

Polymorphism adds complexity; standardizing removes it.

---

### x402 Protocol Alignment

The x402 payment protocol validates this design choice. In x402:

1. **`payTo` is the owner address** — merchants set `payTo` to their SplitConfig PDA
2. **Vault is derived** — x402 derives the payment destination as `ATA(owner: payTo, mint: asset)`
3. **Facilitators work with `payTo`** — when validating and settling payments, facilitators have the `payTo` address directly from payment requirements

From the x402 SVM spec:
> "Destination MUST equal the Associated Token Account PDA for `(owner = payTo, mint = asset)` under the selected token program."

This means facilitators who want to execute splits after payment settlement already have the SplitConfig address (`payTo`) — not the vault. A splitConfig-centric SDK API aligns perfectly with this flow:

```typescript
// Facilitator flow
const payTo = paymentRequirements.payTo;  // This IS the splitConfig
await executeSplit({ rpc, splitConfig: payTo, executor });  // Direct — no conversion
```

If the SDK required vault addresses, facilitators would need an extra step to derive the vault from `payTo`, adding unnecessary friction.

---

### API Changes

```typescript
// Create - returns both, splitConfig is the primary handle
const { splitConfig, vault } = await createSplitConfig({ ... });

// All operations - accept splitConfig only
await executeSplit({ rpc, splitConfig, executor });
await updateSplitConfig({ rpc, splitConfig, authority, recipients });
await closeSplitConfig({ rpc, splitConfig, authority });

// Read functions - accept splitConfig only
const config = await getSplitConfig({ rpc, splitConfig });
const balance = await getVaultBalance({ rpc, splitConfig });

// Detection - accept splitConfig only
const isSplit = await isCascadeSplit({ rpc, splitConfig });
```

---

### Edge Case Utility

For rare cases where only the vault address is available (e.g., parsing on-chain events, legacy integrations), provide an explicit utility:

```typescript
// Dedicated conversion function - not polymorphic parameter
export async function getSplitConfigAddressFromVault(
  input: { rpc: Rpc<SolanaRpcApi>; vault: Address }
): Promise<Address> {
  const vaultInfo = await input.rpc.getAccountInfo(input.vault, { encoding: "base64" }).send();

  if (!vaultInfo.value) {
    throw new VaultNotFoundError(input.vault);
  }

  const vaultData = decodeBase64(vaultInfo.value.data[0]);

  // Token account layout: mint (32) + owner (32) + ...
  // Owner is the SplitConfig PDA
  return decodeAddress(vaultData.subarray(32, 64));
}
```

---

### Affected Functions

| Function | Current Parameter | New Parameter |
|----------|-------------------|---------------|
| `executeSplit` | `vault` | `splitConfig` |
| `updateSplitConfig` | `vault` | `splitConfig` |
| `closeSplitConfig` | `vault` | `splitConfig` |
| `getSplitConfigFromVault` | `vault` | Rename to `getSplitConfig(splitConfig)` |
| `isCascadeSplit` | `vault` | `splitConfig` |
| `getVaultBalance` | `vault` | `splitConfig` |

**New utility:** `getSplitConfigAddressFromVault({ rpc, vault })` for edge cases.

---

## 3. ATA Management

### Problem

The Cascade Splits protocol gracefully handles missing ATAs by storing amounts in `unclaimed_amounts` (recipients) and `protocol_unclaimed` (protocol fee). While this prevents transaction failures, it creates DX friction:

1. **"Funds stuck" confusion** — User creates split, sends funds, but recipients don't receive tokens (held in unclaimed)
2. **Blocked operations** — Cannot update/close split until all unclaimed amounts are cleared
3. **Manual workaround required** — User must understand the unclaimed mechanism, create ATAs manually, and re-execute

Current SDK exposes this complexity to every developer, requiring manual handling.

---

### Design Philosophy

**Core principle:** Minimal friction by default. Advanced users can opt-out for cost control.

The protocol's unclaimed mechanism exists as a safety net, but most users want "it just works" behavior. ATAs are created automatically (~0.002 SOL each) to ensure splits distribute immediately without blocked operations or manual ATA management.

**Opt-out available:** Power users who want explicit control over ATA costs can set `createMissingAtas: false` to receive `blocked` status instead of automatic creation.

---

### Solution: Automatic ATA Creation

#### Default Behavior

By default, operations automatically create missing ATAs:

```typescript
const client = createSplitsClient({ rpc, rpcSubscriptions, signer });

// Default: just works (creates ATAs automatically)
const result = await client.ensureSplitConfig({ recipients, mint });

// Full flow handled in single transaction: create ATAs + create split
console.log('ATAs created:', result.atasCreated);

// Same for update/close — ATAs auto-created, then execute + update
const updateResult = await client.updateSplitConfig({ splitConfig, recipients });
```

#### Opt-Out for Advanced Users

```typescript
// Disable auto-creation when you need explicit control
const result = await client.ensureSplitConfig({
  recipients,
  mint,
  createMissingAtas: false,  // Opt-out: returns blocked instead
});

// Returns blocked with details instead of auto-creating
if (result.status === "blocked" && result.reason === "recipient_atas_missing") {
  console.log('Missing ATAs:', result.missingAtas);
  // Handle manually
}
```

---

### Operation Flows

By default, operations bundle everything into a **single transaction** for the common case (≤10 ATAs):

#### ensureSplitConfig (create)

```
1. Check recipient ATAs + protocol ATA
2. Bundle ATA creation instructions for any missing (default behavior)
3. Add create split config instruction
4. Send single transaction
```

```typescript
interface EnsureSplitConfigResult {
  status: "created" | "no_change" | "blocked" | "failed";
  splitConfig: Address;
  vault: Address;
  atasCreated?: Address[];      // Which ATAs were created (if any)
  signature?: Signature;
  error?: string;
  missingAtas?: MissingAta[];   // Only if blocked (when createMissingAtas: false)
}
```

#### updateSplitConfig

```
1. Fetch current config
2. Check if vault has balance OR unclaimed amounts exist
3. Bundle: ATA creation (if needed) + execute + update
4. Send single transaction (or blocked if createMissingAtas: false)
```

```typescript
interface UpdateSplitConfigResult {
  status: "updated" | "blocked" | "failed";
  atasCreated?: Address[];
  signature?: Signature;
  error?: string;
  missingAtas?: MissingAta[];   // Only if blocked
}
```

#### closeSplitConfig

```
1. Fetch current config
2. Check if vault has balance OR unclaimed amounts exist
3. Bundle: ATA creation (if needed) + execute + close
4. Send single transaction (or blocked if createMissingAtas: false)
```

```typescript
interface CloseSplitConfigResult {
  status: "closed" | "blocked" | "failed";
  atasCreated?: Address[];
  signature?: Signature;
  rentReclaimed?: bigint;       // SOL returned to rent payer
  error?: string;
  missingAtas?: MissingAta[];   // Only if blocked
}
```

---

### Transaction Bundling

For typical splits (≤10 recipients), everything fits in **one transaction**:
- ATA creation: ~30k CU per ATA
- Execute split: ~50-100k CU
- Update/Close: ~50k CU
- **Total for 5 recipients: ~250k CU** (well under 1.4M limit)

For edge cases with many recipients (>10-15), the SDK batches into multiple transactions and returns after all complete.

---

### Utility Functions

For users who opt-out or need explicit control:

```typescript
// Check what ATAs are missing
export async function checkMissingAtas(input: {
  rpc: Rpc<SolanaRpcApi>;
  splitConfig: Address;
}): Promise<MissingAta[]>

// Get instructions to create specific ATAs
export function getCreateAtaInstructions(input: {
  payer: TransactionSigner;
  atas: MissingAta[];
}): IInstruction[]

// Check if split can be updated/closed (no unclaimed)
export async function canUpdateOrClose(input: {
  rpc: Rpc<SolanaRpcApi>;
  splitConfig: Address;
}): Promise<{ canProceed: boolean; reason?: string; unclaimed?: UnclaimedInfo }>
```

---

## Migration

**Breaking changes** in minor version (pre-GA).

### Parameter Style

```typescript
// Before
executeSplit(rpc, vault, executor, tokenProgram?)

// After
executeSplit({ rpc, splitConfig, executor, tokenProgram? })
```

### Primary Identifier

```typescript
// Before
const { splitConfig, vault } = await createSplitConfig({ ... });
// User must remember to use vault, not splitConfig
await executeSplit(rpc, vault, executor);

// After
const { splitConfig, vault } = await createSplitConfig({ ... });
// Natural: use the primary identifier returned
await executeSplit({ rpc, splitConfig, executor });
```

### Result Types

```typescript
// Before
if (result.ok) { ... }
if (result.status === "CREATED") { ... }

// After
if (result.status === "success") { ... }
if (result.status === "created") { ... }
```

### Cache Management

```typescript
// Before
invalidateSplitCache(vault);

// After
// Not needed — SDK manages internally
```

---

## Summary

| Aspect | Decision |
|--------|----------|
| Parameter style | Flat object for all functions |
| Result discriminant | `status` everywhere, lowercase |
| Token program | Auto-detect, manual override optional |
| Naming | Match on-chain (IDL → Codama → SDK) |
| Cache | Internal only, auto-invalidate |
| Primary identifier | `splitConfig`, not `vault` |
| ATA management | Default ON, opt-out via `createMissingAtas: false` |

---

## Decision

**Implemented.** (December 2025) This ADR documents the unified API design for the splits-sdk Solana module, consolidating decisions on API conventions, primary identifier standardization, and ATA management strategy.
