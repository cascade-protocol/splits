# SDK Idempotent Client API

**Date:** 2025-12-02
**Status:** Accepted
**Goal:** Add high-level idempotent operations to SDK for x402 facilitator integration and general usability

---

## Executive Summary

This ADR defines the architecture for adding idempotent, high-level operations to `@cascade-fyi/splits-sdk`. These operations handle the full transaction lifecycle (check state → build → sign → send → confirm) and provide declarative interfaces for managing split configurations.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API Architecture | Layered in same subpath | Tree-shaking, ecosystem alignment, IDE ergonomics |
| Naming Convention | `*SplitConfig` (instruction) vs `*Split` (idempotent) | Clear distinction without separate subpaths |
| Unique ID Strategy | Optional seed with fixed default | One vault per authority/mint by default, explicit seed for multiple |
| Recipient Comparison | Set equality (ignore order) | Semantic equivalence, not implementation detail |
| Rent Receiver | Auto-read from config | Simplest correct behavior |
| Token Program | Auto-detect from mint account | Token-agnostic, zero-config Token-2022 |

**New Functions:**
- `ensureSplitConfig()` - Idempotent create/update/no-op
- `closeSplit()` - Idempotent close with rent recovery
- `updateSplit()` - Idempotent update with pre-validation
- `estimateSplitRent()` - Pure rent calculation

**Total new code:** ~400 lines
**Breaking changes:** None (all additive)

---

## Part 1: Context & Goals

### 1.1 The Problem

Current SDK provides low-level instruction builders:
```typescript
// Current: User must handle everything
const { instruction, vault } = await createSplitConfig({ ... });
const tx = buildTransaction(instruction);
const signed = await signTransaction(tx);
const sig = await sendTransaction(signed);
await confirmTransaction(sig);
```

For x402 facilitator integration and general usability, users need:
```typescript
// Desired: Declarative, idempotent
const result = await ensureSplitConfig({ ... });
// result.action = 'CREATED' | 'UPDATED' | 'NO_CHANGE'
```

### 1.2 Design Goals

1. **Idempotent operations** - Safe to retry, declare desired state
2. **Transparent economics** - Show rent costs upfront, make recovery easy
3. **Token-agnostic** - Auto-detect SPL Token vs Token-2022
4. **Minimal RPC calls** - Leverage existing caching infrastructure
5. **Type-safe results** - Discriminated unions for all outcomes

### 1.3 Target Users

| User | Use Case | Functions |
|------|----------|-----------|
| Resource servers (Switchboard, Helius) | Set up splits for API payouts | `ensureSplitConfig`, `estimateSplitRent` |
| Facilitators | Auto-execute splits after settlement | `executeAndConfirmSplit` (existing) |
| Protocol operators | Manage and close configurations | `closeSplit`, `updateSplit` |

---

## Part 2: Architecture Decision

### 2.1 Options Considered

**Option A: Layered API in Same Subpath**
```typescript
import { ensureSplitConfig, createSplitConfig } from "@cascade-fyi/splits-sdk/solana";
```

**Option B: Dedicated Client Subpath**
```typescript
import { ensureSplitConfig } from "@cascade-fyi/splits-sdk/solana/client";
import { createSplitConfig } from "@cascade-fyi/splits-sdk/solana";
```

**Option C: Service Class Pattern**
```typescript
const splits = new SplitsService(rpc);
await splits.ensure({ ... });
```

**Option D: Functional Namespace Object**
```typescript
import { splits } from "@cascade-fyi/splits-sdk/solana";
await splits.ensure({ ... });
```

### 2.2 Decision: Option A (Layered API)

**Rationale:**

| Criterion | A | B | C | D |
|-----------|---|---|---|---|
| Tree-shaking | ✅ Guaranteed | ✅ | ⚠️ Class | ⚠️ Namespace |
| IDE autocomplete | ✅ Immediate | ✅ | ✅ | ⚠️ Two-step |
| Testing/mocking | ✅ Standard | ✅ | ⚠️ Instance | ⚠️ Nested |
| Ecosystem fit | ✅ Kit/viem | ✅ | ❌ | ❌ DSL pattern |
| Import simplicity | ✅ One path | ⚠️ Two paths | ✅ | ✅ |
| Bundle size | ✅ Optimal | ✅ | ⚠️ | ⚠️ May pull unused |

**Key factors:**
- Named exports guarantee tree-shaking with all bundlers
- Matches @solana/kit patterns (`createTransactionMessage`, not `kit.tx.create`)
- IDE autocomplete works immediately on typing
- Standard Vitest/Jest mocking patterns apply

### 2.3 Naming Convention

Distinguish levels by name pattern:

| Pattern | Level | Returns | Example |
|---------|-------|---------|---------|
| `*SplitConfig` | Low-level | `Instruction` or `{ instruction }` | `createSplitConfig`, `closeSplitConfig` |
| `*Split` | High-level | `*Result` (sends tx) | `closeSplit`, `updateSplit` |
| `ensure*` | High-level | `EnsureResult` (idempotent) | `ensureSplitConfig` |
| `estimate*` | Pure | `EstimateResult` (no tx) | `estimateSplitRent` |

**Exception:** `ensureSplitConfig` keeps "Config" because you're "ensuring the config exists."

**Mental model:**
- `*SplitConfig` = work with the account/instruction
- `*Split` = work with the split as a concept

---

## Part 3: API Specification

### 3.1 `ensureSplitConfig()` - Primary Idempotent Creation

**Purpose:** Declare desired split configuration; SDK handles create/update/no-op.

```typescript
async function ensureSplitConfig(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>,
  signer: KeyPairSigner,
  params: {
    recipients: Recipient[];
    mint?: Address;              // defaults to USDC
    seed?: Address;              // defaults to fixed value (one vault per authority/mint)
    payer?: KeyPairSigner;       // defaults to signer (for sponsored rent)
  },
  options?: EnsureOptions,
): Promise<EnsureResult>;

interface EnsureOptions {
  commitment?: 'processed' | 'confirmed' | 'finalized';
  computeUnitPrice?: bigint;
}

type EnsureResult =
  | { status: 'CREATED'; vault: Address; splitConfig: Address; rentPaid: bigint; signature: string }
  | { status: 'UPDATED'; vault: Address; splitConfig: Address; signature: string }
  | { status: 'NO_CHANGE'; vault: Address; splitConfig: Address }
  | { status: 'BLOCKED'; reason: EnsureBlockedReason; vault: Address; splitConfig: Address };

type EnsureBlockedReason =
  | 'vault_not_empty'           // Cannot update, must execute first
  | 'unclaimed_pending'         // Cannot update, unclaimed amounts exist
  | 'recipient_atas_missing';   // Recipients must create ATAs first
```

**Behavior:**
1. Derive `splitConfig` address from `(signer.address, mint, seed)`
2. Fetch account (1 RPC call)
3. If not exists → create (validates recipient ATAs exist)
4. If exists and recipients match (set equality) → `NO_CHANGE`
5. If exists and recipients differ:
   - Check vault empty, no unclaimed → update
   - Otherwise → `BLOCKED` with reason

**Unique ID Strategy:**

```typescript
// Default: One vault per authority/mint
const { vault } = await ensureSplitConfig(rpc, rpcSub, signer, {
  recipients: [{ address: alice, share: 99 }],
});

// Explicit seed: Multiple vaults for same authority/mint
const { vault: vault1 } = await ensureSplitConfig(rpc, rpcSub, signer, {
  recipients: [...],
  seed: "product-a-seed-pubkey" as Address,
});
const { vault: vault2 } = await ensureSplitConfig(rpc, rpcSub, signer, {
  recipients: [...],
  seed: "product-b-seed-pubkey" as Address,
});
```

**Default seed derivation:**
```typescript
const DEFAULT_SEED = "11111111111111111111111111111111" as Address; // System program = predictable
```

---

### 3.2 `estimateSplitRent()` - Cost Estimation

**Purpose:** Show rent costs before committing. Pure function, no transactions.

```typescript
async function estimateSplitRent(
  rpc: Rpc<SolanaRpcApi>,
  params: {
    authority: Address;
    recipients: Recipient[];
    mint?: Address;
    seed?: Address;
  },
): Promise<EstimateResult>;

interface EstimateResult {
  rentRequired: bigint;       // lamports (~0.017 SOL total)
  splitConfigRent: bigint;    // ~0.015 SOL (1,832 bytes)
  vaultRent: bigint;          // ~0.002 SOL (165 bytes)
  vault: Address;             // derived address (deterministic)
  splitConfig: Address;       // derived address
  existsOnChain: boolean;     // true if already created
  currentRecipients?: SplitRecipient[];  // if exists, current config
}
```

**Behavior:**
1. Derive addresses from params
2. Check if account exists (1 RPC call, uses cache)
3. If exists, fetch current config for comparison
4. Return rent amounts (can be calculated offline, but we fetch for accuracy)

---

### 3.3 `closeSplit()` - Idempotent Close

**Purpose:** Close split config and recover rent with pre-validation.

```typescript
async function closeSplit(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>,
  signer: KeyPairSigner,
  vault: Address,
  options?: CloseOptions,
): Promise<CloseResult>;

interface CloseOptions {
  commitment?: 'processed' | 'confirmed' | 'finalized';
  computeUnitPrice?: bigint;
}

type CloseResult =
  | { status: 'CLOSED'; rentRecovered: bigint; signature: string }
  | { status: 'ALREADY_CLOSED' }
  | { status: 'BLOCKED'; reason: CloseBlockedReason };

type CloseBlockedReason =
  | 'vault_not_empty'
  | 'unclaimed_pending'    // includes protocol_unclaimed - both cleared by execute_split
  | 'not_authority';
```

**Behavior:**
1. Check if account exists; if not → `ALREADY_CLOSED`
2. Fetch config, validate signer is authority
3. Check vault empty, no unclaimed amounts
4. If blocked → return reason, no transaction
5. If closeable → close and return recovered rent
6. Auto-reads `rentPayer` from config for `rent_destination`

---

### 3.4 `updateSplit()` - Idempotent Update

**Purpose:** Update recipients with pre-validation and set equality check.

```typescript
async function updateSplit(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>,
  signer: KeyPairSigner,
  vault: Address,
  params: {
    recipients: Recipient[];
  },
  options?: UpdateOptions,
): Promise<UpdateResult>;

interface UpdateOptions {
  commitment?: 'processed' | 'confirmed' | 'finalized';
  computeUnitPrice?: bigint;
}

type UpdateResult =
  | { status: 'UPDATED'; signature: string }
  | { status: 'NO_CHANGE' }
  | { status: 'BLOCKED'; reason: UpdateBlockedReason };

type UpdateBlockedReason =
  | 'vault_not_empty'
  | 'unclaimed_pending'
  | 'not_authority'
  | 'config_not_found'
  | 'recipient_atas_missing';
```

**Behavior:**
1. Fetch config from vault
2. Compare recipients using set equality (addresses + shares, ignore order)
3. If match → `NO_CHANGE`
4. Validate: vault empty, no unclaimed, signer is authority, ATAs exist
5. If blocked → return reason
6. Otherwise → update and return signature

---

### 3.5 Recipient Comparison Logic

**Decision: Set Equality**

Recipients match if same addresses with same shares, regardless of order.

```typescript
function recipientsEqual(a: Recipient[], b: Recipient[]): boolean {
  if (a.length !== b.length) return false;

  // Normalize to comparable format
  const normalize = (recipients: Recipient[]) =>
    recipients
      .map(r => ({ address: r.address, bps: toPercentageBps(r) }))
      .sort((x, y) => x.address.localeCompare(y.address));

  const sortedA = normalize(a);
  const sortedB = normalize(b);

  return sortedA.every((r, i) =>
    r.address === sortedB[i].address && r.bps === sortedB[i].bps
  );
}
```

**Rationale:**
- User intent: "these recipients get these shares" — order is implementation detail
- `[alice: 50, bob: 49]` and `[bob: 49, alice: 50]` are semantically identical
- Matches Terraform's set comparison for resources
- On-chain order handled by SDK when building instruction

---

## Part 4: Token Program Detection

### 4.1 Decision: Auto-Detect

All high-level functions auto-detect the token program from the mint account.

```typescript
async function detectTokenProgram(
  rpc: Rpc<SolanaRpcApi>,
  mint: Address,
): Promise<Address> {
  const accountInfo = await rpc.getAccountInfo(mint, { encoding: "base64" }).send();
  if (!accountInfo.value) {
    throw new MintNotFoundError(mint);
  }
  return accountInfo.value.owner as Address;  // TokenkegQ... or Tokenz...
}
```

**Rationale:**
- Zero-config Token-2022 support
- Mint account owner IS the token program
- Single RPC call, cacheable
- Matches `executeAndConfirmSplit` pattern

### 4.2 Caching Strategy

Token program detection is cached per mint (program never changes for a mint):

```typescript
const mintProgramCache = new Map<string, Address>();

async function getTokenProgram(rpc: Rpc<SolanaRpcApi>, mint: Address): Promise<Address> {
  const cached = mintProgramCache.get(mint);
  if (cached) return cached;

  const program = await detectTokenProgram(rpc, mint);
  mintProgramCache.set(mint, program);
  return program;
}
```

---

## Part 5: x402 Facilitator Integration

### 5.1 Integration Pattern

x402 facilitators can integrate Cascade Splits as a post-settlement hook. The pattern:

1. Facilitator settles payment to `payTo` address
2. Check if `payTo` is a Cascade Split vault using `isCascadeSplit()`
3. If yes, call `executeAndConfirmSplit()` to distribute funds

### 5.2 Wrapper Pattern

Facilitators can wrap their settlement handler to auto-execute splits:

```typescript
import { isCascadeSplit, executeAndConfirmSplit } from "@cascade-fyi/splits-sdk/solana";

// Wrap any settlement handler with splits execution
function withSplits(
  handleSettle: (requirements, payment) => Promise<SettleResponse>,
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<...>,
  signer: KeyPairSigner,
  options?: { minBalance?: bigint; computeUnitPrice?: bigint },
) {
  return async (requirements, payment) => {
    // 1. Call original handler
    const result = await handleSettle(requirements, payment);

    if (!result?.success) {
      return result;
    }

    // 2. Check if payTo is a split vault (cached)
    const payTo = requirements.payTo as Address;
    const isSplit = await isCascadeSplit(rpc, payTo);

    if (!isSplit) {
      return result;  // Not a split, return original result
    }

    // 3. Execute split
    const splitResult = await executeAndConfirmSplit(
      rpc,
      rpcSubscriptions,
      payTo,
      signer,
      {
        minBalance: options?.minBalance,
        computeUnitPrice: options?.computeUnitPrice,
      },
    );

    // 4. Augment response
    return {
      ...result,
      splitTxHash: splitResult.ok ? splitResult.signature : null,
    };
  };
}
```

### 5.3 Key SDK Functions for Facilitators

| Function | Purpose |
|----------|---------|
| `isCascadeSplit(rpc, vault)` | Check if address is a split vault (cached) |
| `executeAndConfirmSplit(...)` | Execute split with confirmation |
| `ensureSplitConfig(...)` | Idempotent setup for merchants |
| `checkRecipientAtas(...)` | Verify recipients can receive funds |

---

## Part 6: Error Types

### 6.1 New Error Classes

```typescript
// src/errors.ts additions

export type SplitsErrorCode =
  | "VAULT_NOT_FOUND"
  | "SPLIT_NOT_FOUND"
  | "PROTOCOL_NOT_INITIALIZED"
  | "INVALID_RECIPIENTS"
  | "INVALID_TOKEN_ACCOUNT"
  // New
  | "MINT_NOT_FOUND"
  | "RECIPIENT_ATAS_MISSING";

/** Mint account not found */
export class MintNotFoundError extends SplitsError {
  constructor(public readonly mint: string, options?: ErrorOptions) {
    super("MINT_NOT_FOUND", `Mint not found: ${mint}`, options);
  }
}

/** One or more recipient ATAs don't exist */
export class RecipientAtasMissingError extends SplitsError {
  constructor(
    public readonly missing: Array<{ recipient: string; ata: string }>,
    options?: ErrorOptions,
  ) {
    super(
      "RECIPIENT_ATAS_MISSING",
      `Recipient ATAs missing: ${missing.map(m => m.recipient).join(", ")}`,
      options,
    );
    this.missing = missing;
  }
}

```

---

## Part 7: File Structure

### 7.1 New Files

```
packages/sdk/src/
├── index.ts                        # Types, constants (unchanged)
├── errors.ts                       # Error classes (add new errors)
└── solana/
    ├── index.ts                    # Re-exports (add new functions)
    ├── instructions.ts             # Instruction builders (unchanged)
    ├── helpers.ts                  # Read functions, caching, utilities (add new helpers)
    ├── executeAndConfirmSplit.ts   # executeAndConfirmSplit (rename from execute.ts)
    ├── ensureSplitConfig.ts        # NEW: ensureSplitConfig
    ├── closeSplit.ts               # NEW: closeSplit
    ├── updateSplit.ts              # NEW: updateSplit
    ├── estimateSplitRent.ts        # NEW: estimateSplitRent
    ├── generated/                  # Codama-generated code
    └── web3-compat/
        └── index.ts                # @solana/web3.js bridge
```

**File naming principle:** Single-export files named after their export. Multi-export files use descriptive nouns.

### 7.2 Export Structure

```typescript
// src/solana/index.ts

// =============================================================================
// HIGH-LEVEL (Idempotent, sends transactions)
// =============================================================================

export {
  ensureSplitConfig,
  type EnsureResult,
  type EnsureBlockedReason,
  type EnsureOptions,
} from "./ensureSplitConfig.js";

export {
  closeSplit,
  type CloseResult,
  type CloseBlockedReason,
  type CloseOptions,
} from "./closeSplit.js";

export {
  updateSplit,
  type UpdateResult,
  type UpdateBlockedReason,
  type UpdateOptions,
} from "./updateSplit.js";

// =============================================================================
// ESTIMATION (Pure, no transactions)
// =============================================================================

export {
  estimateSplitRent,
  type EstimateResult,
} from "./estimateSplitRent.js";

// =============================================================================
// EXECUTE (High-level, existing)
// =============================================================================

export {
  executeAndConfirmSplit,
  type ExecuteAndConfirmOptions,
  type ExecuteAndConfirmResult,
} from "./executeAndConfirmSplit.js";

// =============================================================================
// INSTRUCTIONS (Low-level, returns Instruction)
// =============================================================================

export {
  createSplitConfig,
  executeSplit,
  updateSplitConfig,
  closeSplitConfig,
  type CreateSplitConfigResult,
  type ExecuteSplitResult,
} from "./instructions.js";

// =============================================================================
// READ & HELPERS (Existing + New)
// =============================================================================

export {
  getSplitConfigFromVault,
  getProtocolConfig,
  getVaultBalance,
  isCascadeSplit,
  invalidateSplitCache,
  clearSplitCache,
  invalidateProtocolConfigCache,
  deriveSplitConfig,
  deriveVault,
  deriveAta,
  deriveProtocolConfig,
  generateUniqueId,
  // New
  checkRecipientAtas,
  type MissingAta,
  type SplitConfig,
  type SplitRecipient,
  type ProtocolConfig,
  type UnclaimedAmount,
} from "./helpers.js";
```

---

## Part 8: Implementation Details

### 8.1 `ensureSplitConfig` Implementation

```typescript
// src/solana/ensureSplitConfig.ts

import {
  type Address,
  type Rpc,
  type SolanaRpcApi,
  type KeyPairSigner,
  type RpcSubscriptions,
  type SignatureNotificationsApi,
  type SlotNotificationsApi,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import {
  USDC_MINT,
  SYSTEM_PROGRAM_ID,
  type Recipient,
} from "../index.js";
import {
  deriveSplitConfig,
  deriveVault,
  getSplitConfigFromVault,
  getVaultBalance,
  recipientsEqual,
  checkRecipientAtas,
  sendTransaction,
} from "./helpers.js";
import { createSplitConfig, updateSplitConfig } from "./instructions.js";
import { VaultNotFoundError, RecipientAtasMissingError } from "../errors.js";

const DEFAULT_SEED = SYSTEM_PROGRAM_ID;  // Predictable default

export interface EnsureOptions {
  commitment?: "processed" | "confirmed" | "finalized";
  computeUnitPrice?: bigint;
}

export type EnsureResult =
  | { status: "CREATED"; vault: Address; splitConfig: Address; rentPaid: bigint; signature: string }
  | { status: "UPDATED"; vault: Address; splitConfig: Address; signature: string }
  | { status: "NO_CHANGE"; vault: Address; splitConfig: Address }
  | { status: "BLOCKED"; reason: EnsureBlockedReason; vault: Address; splitConfig: Address };

export type EnsureBlockedReason =
  | "vault_not_empty"
  | "unclaimed_pending"
  | "recipient_atas_missing";

export async function ensureSplitConfig(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>,
  signer: KeyPairSigner,
  params: {
    recipients: Recipient[];
    mint?: Address;
    seed?: Address;
    payer?: KeyPairSigner;
  },
  options: EnsureOptions = {},
): Promise<EnsureResult> {
  const {
    recipients,
    mint = USDC_MINT,
    seed = DEFAULT_SEED,
    payer = signer,
  } = params;
  const { commitment = "confirmed", computeUnitPrice } = options;

  // 1. Derive addresses
  const splitConfigAddress = await deriveSplitConfig(signer.address, mint, seed);
  const tokenProgram = await detectTokenProgram(rpc, mint);
  const vaultAddress = await deriveVault(splitConfigAddress, mint, tokenProgram);

  // 2. Check if config exists
  let existingConfig;
  try {
    existingConfig = await getSplitConfigFromVault(rpc, vaultAddress);
  } catch (e) {
    if (!(e instanceof VaultNotFoundError)) throw e;
    existingConfig = null;
  }

  // 3. Validate recipient ATAs exist
  const missingAtas = await checkRecipientAtas(rpc, recipients, mint);
  if (missingAtas.length > 0) {
    if (existingConfig) {
      return {
        status: "BLOCKED",
        reason: "recipient_atas_missing",
        vault: vaultAddress,
        splitConfig: splitConfigAddress,
      };
    }
    throw new RecipientAtasMissingError(missingAtas);
  }

  // 4. If exists, check for NO_CHANGE or UPDATE
  if (existingConfig) {
    // Check set equality
    if (recipientsEqual(recipients, existingConfig.recipients)) {
      return {
        status: "NO_CHANGE",
        vault: vaultAddress,
        splitConfig: splitConfigAddress,
      };
    }

    // Check if update is possible
    const vaultBalance = await getVaultBalance(rpc, vaultAddress);
    if (vaultBalance > 0n) {
      return {
        status: "BLOCKED",
        reason: "vault_not_empty",
        vault: vaultAddress,
        splitConfig: splitConfigAddress,
      };
    }
    const hasUnclaimed = existingConfig.unclaimedAmounts.some(u => u.amount > 0n)
      || existingConfig.protocolUnclaimed > 0n;
    if (hasUnclaimed) {
      return {
        status: "BLOCKED",
        reason: "unclaimed_pending",
        vault: vaultAddress,
        splitConfig: splitConfigAddress,
      };
    }

    // Build and send update
    const instruction = await updateSplitConfig(rpc, {
      vault: vaultAddress,
      authority: signer.address,
      recipients,
      tokenProgram,
    });

    const signature = await sendTransaction(
      rpc,
      rpcSubscriptions,
      signer,
      [instruction],
      { commitment, computeUnitPrice },
    );

    return {
      status: "UPDATED",
      vault: vaultAddress,
      splitConfig: splitConfigAddress,
      signature,
    };
  }

  // 5. Create new config
  const { instruction } = await createSplitConfig({
    authority: signer.address,
    recipients,
    mint,
    uniqueId: seed,
    tokenProgram,
    payer: payer.address,
  });

  // Get rent amount for result
  const rentExemption = await rpc
    .getMinimumBalanceForRentExemption(BigInt(1832 + 165))
    .send();

  const signature = await sendTransaction(
    rpc,
    rpcSubscriptions,
    payer,
    [instruction],
    { commitment, computeUnitPrice },
  );

  return {
    status: "CREATED",
    vault: vaultAddress,
    splitConfig: splitConfigAddress,
    rentPaid: rentExemption,
    signature,
  };
}

```

### 8.2 `closeSplit` Implementation

```typescript
// src/solana/closeSplit.ts

import type { Address, Rpc, SolanaRpcApi, KeyPairSigner, RpcSubscriptions } from "@solana/kit";
import { getSplitConfigFromVault, getVaultBalance, sendTransaction } from "./helpers.js";
import { closeSplitConfig } from "./instructions.js";
import { VaultNotFoundError } from "../errors.js";

export type CloseResult =
  | { status: "CLOSED"; rentRecovered: bigint; signature: string }
  | { status: "ALREADY_CLOSED" }
  | { status: "BLOCKED"; reason: CloseBlockedReason };

export type CloseBlockedReason =
  | "vault_not_empty"
  | "unclaimed_pending"
  | "not_authority";

export async function closeSplit(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<...>,
  signer: KeyPairSigner,
  vault: Address,
  options: CloseOptions = {},
): Promise<CloseResult> {
  const { commitment = "confirmed", computeUnitPrice } = options;

  // 1. Check if config exists
  let config;
  try {
    config = await getSplitConfigFromVault(rpc, vault);
  } catch (e) {
    if (e instanceof VaultNotFoundError) {
      return { status: "ALREADY_CLOSED" };
    }
    throw e;
  }

  // 2. Validate authority
  if (config.authority !== signer.address) {
    return { status: "BLOCKED", reason: "not_authority" };
  }

  // 3. Check vault empty
  const vaultBalance = await getVaultBalance(rpc, vault);
  if (vaultBalance > 0n) {
    return { status: "BLOCKED", reason: "vault_not_empty" };
  }

  // 4. Check no unclaimed
  const hasUnclaimed = config.unclaimedAmounts.some(u => u.amount > 0n)
    || config.protocolUnclaimed > 0n;
  if (hasUnclaimed) {
    return { status: "BLOCKED", reason: "unclaimed_pending" };
  }

  // 5. Build and send close instruction
  const instruction = closeSplitConfig({
    vault,
    authority: signer.address,
    rentDestination: config.rentPayer,  // Auto-read from config
  });

  // Calculate rent to report
  const splitConfigRent = await rpc.getMinimumBalanceForRentExemption(BigInt(1832)).send();
  const vaultRent = await rpc.getMinimumBalanceForRentExemption(BigInt(165)).send();
  const rentRecovered = splitConfigRent + vaultRent;

  const signature = await sendTransaction(
    rpc,
    rpcSubscriptions,
    signer,
    [instruction],
    { commitment, computeUnitPrice },
  );

  return { status: "CLOSED", rentRecovered, signature };
}
```

### 8.3 `estimateSplitRent` Implementation

```typescript
// src/solana/estimateSplitRent.ts

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { USDC_MINT, SYSTEM_PROGRAM_ID, type Recipient } from "../index.js";
import {
  deriveSplitConfig,
  deriveVault,
  getSplitConfigFromVault,
  detectTokenProgram,
  type SplitRecipient,
} from "./helpers.js";
import { VaultNotFoundError } from "../errors.js";

const DEFAULT_SEED = SYSTEM_PROGRAM_ID;

export interface EstimateResult {
  rentRequired: bigint;
  splitConfigRent: bigint;
  vaultRent: bigint;
  vault: Address;
  splitConfig: Address;
  existsOnChain: boolean;
  currentRecipients?: SplitRecipient[];
}

export async function estimateSplitRent(
  rpc: Rpc<SolanaRpcApi>,
  params: {
    authority: Address;
    recipients: Recipient[];
    mint?: Address;
    seed?: Address;
  },
): Promise<EstimateResult> {
  const { authority, mint = USDC_MINT, seed = DEFAULT_SEED } = params;

  // 1. Derive addresses
  const splitConfigAddress = await deriveSplitConfig(authority, mint, seed);
  const tokenProgram = await detectTokenProgram(rpc, mint);
  const vaultAddress = await deriveVault(splitConfigAddress, mint, tokenProgram);

  // 2. Get rent amounts
  const splitConfigRent = await rpc.getMinimumBalanceForRentExemption(BigInt(1832)).send();
  const vaultRent = await rpc.getMinimumBalanceForRentExemption(BigInt(165)).send();
  const rentRequired = splitConfigRent + vaultRent;

  // 3. Check if exists
  let existsOnChain = false;
  let currentRecipients: SplitRecipient[] | undefined;
  try {
    const config = await getSplitConfigFromVault(rpc, vaultAddress);
    existsOnChain = true;
    currentRecipients = config.recipients;
  } catch (e) {
    if (!(e instanceof VaultNotFoundError)) throw e;
  }

  return {
    rentRequired,
    splitConfigRent,
    vaultRent,
    vault: vaultAddress,
    splitConfig: splitConfigAddress,
    existsOnChain,
    currentRecipients,
  };
}
```

### 8.4 `updateSplit` Implementation

```typescript
// src/solana/updateSplit.ts

import type { Address, Rpc, SolanaRpcApi, KeyPairSigner, RpcSubscriptions } from "@solana/kit";
import type { Recipient } from "../index.js";
import {
  getSplitConfigFromVault,
  getVaultBalance,
  recipientsEqual,
  checkRecipientAtas,
  sendTransaction,
} from "./helpers.js";
import { updateSplitConfig } from "./instructions.js";
import { VaultNotFoundError } from "../errors.js";

export type UpdateResult =
  | { status: "UPDATED"; signature: string }
  | { status: "NO_CHANGE" }
  | { status: "BLOCKED"; reason: UpdateBlockedReason };

export type UpdateBlockedReason =
  | "vault_not_empty"
  | "unclaimed_pending"
  | "not_authority"
  | "config_not_found"
  | "recipient_atas_missing";

export async function updateSplit(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<...>,
  signer: KeyPairSigner,
  vault: Address,
  params: { recipients: Recipient[] },
  options: UpdateOptions = {},
): Promise<UpdateResult> {
  const { recipients } = params;
  const { commitment = "confirmed", computeUnitPrice } = options;

  // 1. Get existing config
  let config;
  try {
    config = await getSplitConfigFromVault(rpc, vault);
  } catch (e) {
    if (e instanceof VaultNotFoundError) {
      return { status: "BLOCKED", reason: "config_not_found" };
    }
    throw e;
  }

  // 2. Validate authority
  if (config.authority !== signer.address) {
    return { status: "BLOCKED", reason: "not_authority" };
  }

  // 3. Check set equality
  if (recipientsEqual(recipients, config.recipients)) {
    return { status: "NO_CHANGE" };
  }

  // 4. Check vault empty
  const vaultBalance = await getVaultBalance(rpc, vault);
  if (vaultBalance > 0n) {
    return { status: "BLOCKED", reason: "vault_not_empty" };
  }

  // 5. Check no unclaimed
  const hasUnclaimed = config.unclaimedAmounts.some(u => u.amount > 0n)
    || config.protocolUnclaimed > 0n;
  if (hasUnclaimed) {
    return { status: "BLOCKED", reason: "unclaimed_pending" };
  }

  // 6. Validate recipient ATAs
  const missingAtas = await checkRecipientAtas(rpc, recipients, config.mint);
  if (missingAtas.length > 0) {
    return { status: "BLOCKED", reason: "recipient_atas_missing" };
  }

  // 7. Build and send update
  const instruction = await updateSplitConfig(rpc, {
    vault,
    authority: signer.address,
    recipients,
    tokenProgram,
  });

  const signature = await sendTransaction(
    rpc,
    rpcSubscriptions,
    signer,
    [instruction],
    { commitment, computeUnitPrice },
  );

  return { status: "UPDATED", signature };
}
```

### 8.5 New Helpers (additions to `helpers.ts`)

```typescript
// src/solana/helpers.ts - NEW ADDITIONS

import type {
  Address,
  Rpc,
  SolanaRpcApi,
  KeyPairSigner,
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
  IInstruction,
} from "@solana/kit";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import type { Recipient } from "../index.js";
import { toPercentageBps } from "../index.js";
import { MintNotFoundError } from "../errors.js";

// =============================================================================
// Transaction Helper
// =============================================================================

export async function sendTransaction(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>,
  signer: KeyPairSigner,
  instructions: IInstruction[],
  options: { commitment?: string; computeUnitPrice?: bigint },
): Promise<string> {
  const { commitment = "confirmed", computeUnitPrice } = options;

  const ixs = computeUnitPrice
    ? [getSetComputeUnitPriceInstruction({ microLamports: computeUnitPrice }), ...instructions]
    : instructions;

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayerSigner(signer, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(ixs, msg),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  const signature = getSignatureFromTransaction(signedTransaction);

  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTransaction, { commitment });

  return signature;
}

// =============================================================================
// Token Program Detection
// =============================================================================

const mintProgramCache = new Map<string, Address>();

export async function detectTokenProgram(
  rpc: Rpc<SolanaRpcApi>,
  mint: Address,
): Promise<Address> {
  const cached = mintProgramCache.get(mint);
  if (cached) return cached;

  const accountInfo = await rpc.getAccountInfo(mint, { encoding: "base64" }).send();
  if (!accountInfo.value) {
    throw new MintNotFoundError(mint);
  }

  const program = accountInfo.value.owner as Address;
  mintProgramCache.set(mint, program);
  return program;
}

// =============================================================================
// Recipient Comparison (Set Equality)
// =============================================================================

export function recipientsEqual(
  a: Recipient[],
  b: SplitRecipient[],
): boolean {
  if (a.length !== b.length) return false;

  const normalizeA = a
    .map((r) => ({ address: r.address, bps: toPercentageBps(r) }))
    .sort((x, y) => x.address.localeCompare(y.address));

  const normalizeB = b
    .map((r) => ({ address: r.address as string, bps: r.percentageBps }))
    .sort((x, y) => x.address.localeCompare(y.address));

  return normalizeA.every(
    (r, i) => r.address === normalizeB[i].address && r.bps === normalizeB[i].bps,
  );
}

// =============================================================================
// ATA Checking (Public Helper)
// =============================================================================

export interface MissingAta {
  recipient: Address;
  ata: Address;
}

/**
 * Check which recipient ATAs are missing.
 * Use with @solana-program/token to create missing ATAs before calling ensureSplitConfig.
 *
 * @example
 * ```typescript
 * import { checkRecipientAtas } from "@cascade-fyi/splits-sdk/solana";
 * import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
 *
 * const missing = await checkRecipientAtas(rpc, recipients, mint);
 *
 * if (missing.length > 0) {
 *   const instructions = missing.map(m =>
 *     getCreateAssociatedTokenIdempotentInstruction({
 *       payer: payer.address,
 *       owner: m.recipient,
 *       mint,
 *       ata: m.ata,
 *     })
 *   );
 *   await sendTransaction(rpc, rpcSub, payer, instructions, {});
 * }
 *
 * // Now safe to create split config
 * await ensureSplitConfig(...);
 * ```
 */
export async function checkRecipientAtas(
  rpc: Rpc<SolanaRpcApi>,
  recipients: Recipient[],
  mint: Address,
): Promise<MissingAta[]> {
  const tokenProgram = await detectTokenProgram(rpc, mint);

  const atas = await Promise.all(
    recipients.map(async (r) => ({
      recipient: r.address as Address,
      ata: await deriveAta(r.address as Address, mint, tokenProgram),
    })),
  );

  const accounts = await rpc
    .getMultipleAccounts(atas.map((a) => a.ata), { encoding: "base64" })
    .send();

  const missing: MissingAta[] = [];
  for (let i = 0; i < atas.length; i++) {
    if (!accounts.value[i]) {
      missing.push(atas[i]);
    }
  }

  return missing;
}
```

---

## Part 9: RPC Call Analysis

### 9.1 `ensureSplitConfig` RPC Calls

| Step | Calls | Cacheable |
|------|-------|-----------|
| Derive token program | 1 | ✅ Yes (per mint) |
| Check config exists | 1 | ❌ No (state check) |
| Validate ATAs | 1 (getMultipleAccounts) | ❌ No |
| Get vault balance (if update) | 1 | ❌ No |
| Get blockhash | 1 | ❌ No |
| Send + confirm | 1 + WebSocket | ❌ No |
| **Total (create)** | **5** | |
| **Total (update)** | **6** | |
| **Total (no-change)** | **3** | |

### 9.2 `closeSplit` RPC Calls

| Step | Calls |
|------|-------|
| Get config from vault | 2 |
| Get vault balance | 1 |
| Get blockhash | 1 |
| Send + confirm | 1 + WebSocket |
| **Total** | **5** |

### 9.3 `estimateSplitRent` RPC Calls

| Step | Calls | Cacheable |
|------|-------|-----------|
| Derive token program | 1 | ✅ Yes |
| Check if exists | 1 | Partial |
| Get rent exemption | 1 | ✅ Yes |
| **Total** | **3** (1-2 if cached) | |

---

## Part 10: Version & Changelog

### 10.1 Version Bump

```json
{
  "version": "0.9.0"
}
```

### 10.2 CHANGELOG Entry

```markdown
## [0.9.0] - 2025-12-XX

### Added

- **High-Level Idempotent Operations**
  - `ensureSplitConfig()` - Declarative create/update with `CREATED`, `UPDATED`, `NO_CHANGE`, or `BLOCKED` results
  - `closeSplit()` - Idempotent close with pre-validation and rent recovery
  - `updateSplit()` - Idempotent update with recipient set equality comparison
  - `estimateSplitRent()` - Pure rent estimation before committing

- **Unique ID Strategy**
  - Optional `seed` parameter for multiple vaults per authority/mint
  - Default seed provides one vault per authority/mint (simplest case)

- **Token-Agnostic Detection**
  - Auto-detect SPL Token vs Token-2022 from mint account
  - Cached per mint for efficiency

- **Recipient Comparison**
  - Set equality comparison (addresses + shares, order-independent)
  - `NO_CHANGE` result when semantically identical

- **New Error Types**
  - `MintNotFoundError` - Mint account doesn't exist
  - `RecipientAtasMissingError` - Lists missing recipient ATAs

- **New Helper**
  - `checkRecipientAtas()` - Check which recipient ATAs are missing (use with `@solana-program/token` to create them)

### Internal

- New high-level operation files: `ensureSplitConfig.ts`, `closeSplit.ts`, `updateSplit.ts`, `estimateSplitRent.ts`
- New helpers in `helpers.ts`: `sendTransaction`, `recipientsEqual`, `detectTokenProgram`, `checkRecipientAtas`
- Mint program cache for Token-2022 detection
```

---

## Part 11: Testing Requirements

### 11.1 Unit Tests

```typescript
describe("ensureSplitConfig", () => {
  it("returns CREATED for new config");
  it("returns NO_CHANGE when recipients match (same order)");
  it("returns NO_CHANGE when recipients match (different order)");
  it("returns UPDATED when recipients differ and vault empty");
  it("returns BLOCKED vault_not_empty when vault has balance");
  it("returns BLOCKED unclaimed_pending when unclaimed exists");
  it("throws RecipientAtasMissingError on create with missing ATAs");
  it("returns BLOCKED recipient_atas_missing on update with missing ATAs");
  it("uses default seed when not provided");
  it("uses custom seed when provided");
  it("auto-detects Token-2022 from mint");
});

describe("closeSplit", () => {
  it("returns CLOSED with rent recovered");
  it("returns ALREADY_CLOSED for non-existent vault");
  it("returns BLOCKED vault_not_empty");
  it("returns BLOCKED unclaimed_pending");
  it("returns BLOCKED not_authority when signer != authority");
  it("uses rentPayer from config as rent_destination");
});

describe("updateSplit", () => {
  it("returns UPDATED when recipients differ");
  it("returns NO_CHANGE when recipients match");
  it("returns BLOCKED vault_not_empty");
  it("returns BLOCKED config_not_found for non-existent");
});

describe("estimateSplitRent", () => {
  it("returns correct rent amounts");
  it("returns existsOnChain: true for existing config");
  it("returns currentRecipients when exists");
  it("derives correct addresses");
});

describe("recipientsEqual", () => {
  it("returns true for identical recipients");
  it("returns true for same recipients different order");
  it("returns false for different addresses");
  it("returns false for same addresses different shares");
  it("returns false for different lengths");
  it("handles share vs percentageBps input");
});
```

### 11.2 Integration Tests

```typescript
describe("ensureSplitConfig integration", () => {
  it("creates split config on devnet");
  it("updates split config after emptying vault");
  it("returns NO_CHANGE on second call with same recipients");
});
```

---

## Part 12: Usage Examples

### 12.1 Basic: Resource Server Setup

```typescript
import { ensureSplitConfig, estimateSplitRent } from "@cascade-fyi/splits-sdk/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");

// 1. Estimate costs first
const estimate = await estimateSplitRent(rpc, {
  authority: wallet.address,
  recipients: [
    { address: nodeOperator, share: 70 },
    { address: treasury, share: 29 },
  ],
});

console.log(`Rent required: ${estimate.rentRequired} lamports`);
console.log(`Vault will be: ${estimate.vault}`);

// 2. Create or update idempotently
const result = await ensureSplitConfig(rpc, rpcSubscriptions, wallet, {
  recipients: [
    { address: nodeOperator, share: 70 },
    { address: treasury, share: 29 },
  ],
});

switch (result.status) {
  case "CREATED":
    console.log(`Created! Vault: ${result.vault}, Rent: ${result.rentPaid}`);
    break;
  case "UPDATED":
    console.log(`Updated recipients. Tx: ${result.signature}`);
    break;
  case "NO_CHANGE":
    console.log(`Already configured correctly.`);
    break;
  case "BLOCKED":
    console.log(`Cannot update: ${result.reason}`);
    break;
}
```

### 12.2 Multiple Vaults per Authority

```typescript
// Product A gets its own vault
const productA = await ensureSplitConfig(rpc, rpcSubscriptions, wallet, {
  recipients: [{ address: vendorA, share: 99 }],
  seed: "product-a-unique-seed" as Address,  // Any 32-byte value
});

// Product B gets a different vault
const productB = await ensureSplitConfig(rpc, rpcSubscriptions, wallet, {
  recipients: [{ address: vendorB, share: 99 }],
  seed: "product-b-unique-seed" as Address,
});

console.log(`Product A vault: ${productA.vault}`);
console.log(`Product B vault: ${productB.vault}`);
```

### 12.3 Close and Recover Rent

```typescript
import { closeSplit } from "@cascade-fyi/splits-sdk/solana";

const result = await closeSplit(rpc, rpcSubscriptions, wallet, vault);

switch (result.status) {
  case "CLOSED":
    console.log(`Recovered ${result.rentRecovered} lamports`);
    break;
  case "ALREADY_CLOSED":
    console.log("Already closed (idempotent)");
    break;
  case "BLOCKED":
    console.log(`Cannot close: ${result.reason}`);
    // If vault_not_empty: execute split first
    // If unclaimed_pending: execute split to clear unclaimed
    break;
}
```

### 12.4 x402 Facilitator Integration

```typescript
import {
  ensureSplitConfig,
  isCascadeSplit,
  executeAndConfirmSplit,
} from "@cascade-fyi/splits-sdk/solana";

// 1. Set up split vault for merchant
const { vault } = await ensureSplitConfig(rpc, rpcSubscriptions, deployerWallet, {
  recipients: [
    { address: merchant, share: 70 },
    { address: platform, share: 29 },
  ],
});

// 2. In your settlement handler, check and execute splits
async function handleSettlement(payTo: Address, amount: bigint) {
  // ... your settlement logic ...

  // After successful settlement, check if it's a split vault
  if (await isCascadeSplit(rpc, payTo)) {
    await executeAndConfirmSplit(
      rpc,
      rpcSubscriptions,
      payTo,
      executorSigner,
      { minBalance: 1_000_000n },  // Batch until 1 USDC
    );
  }
}
```

---

## Summary

| Item | Decision | Rationale |
|------|----------|-----------|
| API Architecture | Layered in same subpath | Tree-shaking, IDE ergonomics, ecosystem fit |
| Naming Convention | `*SplitConfig` (ix) vs `*Split` (idempotent) | Clear level distinction |
| Unique ID | Optional seed, default fixed | One vault by default, explicit for multiple |
| Recipient Comparison | Set equality | Semantic equivalence, order-independent |
| Rent Receiver | Auto-read from config | Simplest correct behavior |
| Token Program | Auto-detect from mint | Zero-config Token-2022 |
| Facilitator Integration | Wrapper pattern, SDK owns logic | Clean separation of concerns |
| Error Handling | Discriminated unions + error classes | Type-safe, debuggable |
| Breaking Changes | None | All additive |

**New Functions:** 4 (`ensureSplitConfig`, `closeSplit`, `updateSplit`, `estimateSplitRent`)
**New Error Types:** 2 (`MintNotFoundError`, `RecipientAtasMissingError`)
**Total New Code:** ~400 lines
**SDK Version:** 0.9.0
