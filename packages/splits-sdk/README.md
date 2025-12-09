# @cascade-fyi/splits-sdk

TypeScript SDK for [Cascade Splits](https://github.com/cascade-protocol/splits) — non-custodial payment splitting on Solana.

Split incoming payments to multiple recipients automatically. Built for high-throughput micropayments and x402 payment facilitators.

**Program ID:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Installation

```bash
npm install @cascade-fyi/splits-sdk @solana/kit
```

**Requirements:**
- `@solana/kit` >=2.0.0 (peer dependency)
- `@solana/web3.js` ^1.98.0 (optional, for wallet adapter compatibility)

## Quick Start

```typescript
import { createSplitsClient } from "@cascade-fyi/splits-sdk";
import { createSolanaRpc, createSolanaRpcSubscriptions, createKeyPairSignerFromBytes } from "@solana/kit";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");
const signer = await createKeyPairSignerFromBytes(secretKey);

const splits = createSplitsClient({ rpc, rpcSubscriptions, signer });

const result = await splits.ensureSplit({
  recipients: [
    { address: "AgentWallet...", share: 90 },
    { address: "PlatformWallet...", share: 10 },
  ],
});

if (result.status === "created") {
  console.log(`Split created! Vault: ${result.vault}`);
  // Share vault address to receive payments
}
```

That's it. Payments to the vault are automatically split 90/10.

---

### For Facilitators: Execute a Split

```typescript
import { createSolanaRpc } from "@solana/kit";
import { executeSplit, isCascadeSplit } from "@cascade-fyi/splits-sdk";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

// Check if payment destination is a split (splitConfig is the x402 payTo address)
if (await isCascadeSplit({ rpc, splitConfig })) {
  const result = await executeSplit({ rpc, splitConfig, executor });

  if (result.status === "success") {
    // Build and send transaction using your kit version
    const tx = buildTransaction([result.instruction], signer);
    await sendTransaction(tx);
  } else {
    console.log(`Cannot execute: ${result.status}`);  // "not_found" | "not_a_split"
  }
}
```

> The core module returns instructions — transaction building is your responsibility. For high-level convenience with WebSocket confirmation, use `executeAndConfirmSplit` from the SDK.

### For Merchants: Create a Split

```typescript
import { createSolanaRpc } from "@solana/kit";
import { createSplitConfig, labelToSeed } from "@cascade-fyi/splits-sdk";

const { instruction, splitConfig, vault } = await createSplitConfig({
  authority: myWallet,
  recipients: [
    { address: "Agent111...", share: 90 },
    { address: "Platform111...", share: 10 },
  ],
  uniqueId: labelToSeed("revenue-share"), // Optional: human-readable label → Address
});

// Build and send transaction, then share splitConfig address for x402 payTo
```

> Use the `splitConfig` address as your x402 `payTo` — facilitators derive the vault ATA automatically.

### ⚠️ Critical: Which Address to Use

When integrating with x402 payment systems:

| Address | Use For | What Happens |
|---------|---------|--------------|
| `splitConfig` | x402 `payTo` ✅ | Facilitator derives vault correctly |
| `vault` | Direct transfers only | If used as `payTo`, creates nested ATA (funds stuck!) |

```typescript
const { splitConfig, vault } = await createSplitConfig({ ... });

// ✅ CORRECT: x402 facilitators derive vault from this
const payTo = splitConfig;

// ❌ WRONG: Creates unrecoverable nested ATA
const payTo = vault;
```

Facilitators call `ATA(owner=payTo, mint)` to find the deposit address. If `payTo` is already an ATA, this creates a nested ATA that no one can sign for.

### For Browser Apps: Client Factory

```typescript
import { createSplitsClient } from "@cascade-fyi/splits-sdk";
import { fromWalletAdapter } from "@cascade-fyi/splits-sdk/web3-compat";
import { USDC_MINT, generateUniqueId } from "@cascade-fyi/splits-sdk";

const splits = createSplitsClient(rpc, fromWalletAdapter(wallet, connection));

const result = await splits.ensureSplit({
  recipients: [{ address: alice, share: 70 }, { address: bob, share: 29 }],
  mint: USDC_MINT,
  uniqueId: generateUniqueId(),  // Or use labelToSeed("my-split") for deterministic address
});

// Handle all possible outcomes
switch (result.status) {
  case "created":
    console.log(`Created! Vault: ${result.vault}`);
    break;
  case "no_change":
    console.log(`Already exists: ${result.vault}`);
    break;
  case "blocked":
    console.log(`Cannot create: ${result.message}`);
    break;
  case "failed":
    console.log(`Transaction failed: ${result.message}`);
    break;
}
```

## Key Concepts

### 100-Share Model

Recipients specify shares from 1-100 that must total exactly 100. Protocol takes 1% fee during distribution.

```typescript
{ address: "Alice...", share: 60 }  // 60% of 99% = 59.4%
{ address: "Bob...", share: 40 }    // 40% of 99% = 39.6%
// Protocol receives 1%
```

### Split Addressing & Idempotency

Split addresses are deterministically derived from `[authority, mint, uniqueId]`. This enables **idempotent operations** — calling `ensureSplitConfig` multiple times with the same inputs returns the same split address.

```typescript
import { labelToSeed, generateUniqueId } from "@cascade-fyi/splits-sdk";

// PATTERN 1: One split per authority (simplest, most common)
// Omit uniqueId — uses deterministic default
await ensureSplitConfig({ rpc, rpcSubscriptions, signer, recipients });
await ensureSplitConfig({ rpc, rpcSubscriptions, signer, recipients }); // Same address, no_change

// PATTERN 2: Multiple named splits (deterministic by label)
// Use labelToSeed() for human-readable identifiers
await ensureSplitConfig({ ..., uniqueId: labelToSeed("product-a") });
await ensureSplitConfig({ ..., uniqueId: labelToSeed("product-b") });
await ensureSplitConfig({ ..., uniqueId: labelToSeed("product-a") }); // Same as first, no_change

// PATTERN 3: Random unique splits (non-idempotent)
// Use generateUniqueId() — caller must store the address
const id = generateUniqueId();
const result = await ensureSplitConfig({ ..., uniqueId: id });
// Must save result.splitConfig — cannot recreate this address
```

| Pattern | Use Case | Idempotent? |
|---------|----------|-------------|
| Omit `uniqueId` | Single split per merchant | ✅ Yes |
| `labelToSeed("name")` | Multiple named splits | ✅ Yes |
| `generateUniqueId()` | Dynamic/programmatic creation | ❌ No (must store) |

### Discriminated Union Results

High-level functions (in the SDK) return typed results with `status` discriminant:

```typescript
// ensureSplit - idempotent create/update
const result = await client.ensureSplit({ recipients });

switch (result.status) {
  case "created":    // result.vault, result.splitConfig, result.signature, result.rentPaid
  case "updated":    // result.vault, result.splitConfig, result.signature
  case "no_change":  // result.vault, result.splitConfig (no transaction)
  case "blocked":    // result.reason, result.message
  case "failed":     // result.reason, result.message, result.error?
}

// execute - distribute funds
const execResult = await client.execute(splitConfig);

switch (execResult.status) {
  case "executed":   // execResult.signature
  case "skipped":    // execResult.reason ("not_found" | "not_a_split" | "below_threshold")
  case "failed":     // execResult.reason, execResult.message
}

// update - change recipients
const updateResult = await client.update(splitConfig, { recipients });
// Returns: updated | no_change | blocked | failed

// close - recover rent
const closeResult = await client.close(splitConfig);
// Returns: closed | already_closed | blocked | failed
```

**Blocked reasons:** `vault_not_empty`, `unclaimed_pending`, `not_authority`, `recipient_atas_missing`

Low-level instruction builders (in the SDK) return `{ status: "success", instruction }` or `{ status: "not_found" | "not_a_split", splitConfig }`.

`blocked` is a valid state, not an error — e.g., "vault has balance, execute first".

### Unclaimed Amounts (Self-Healing)

If a recipient's token account is missing during execution:
- Their share is held as "unclaimed" in the vault
- Next execution auto-delivers when their account exists
- No separate claim instruction needed

```typescript
const config = await getSplitConfig({ rpc, splitConfig });
console.log(config.unclaimedAmounts);  // [{ recipient, amount, timestamp }]
```

## API Reference

### Core Module

Kit-version-agnostic instructions and helpers. Works with any `@solana/kit` version >=2.0.0.

```typescript
import {
  // Instruction builders
  createSplitConfig,     // Create a new split
  executeSplit,          // Distribute vault funds
  updateSplitConfig,     // Update recipients
  closeSplitConfig,      // Close and recover rent

  // Read functions
  getSplitConfig,        // Get config from splitConfig address
  getProtocolConfig,
  getVaultBalance,
  isCascadeSplit,

  // Edge case utility (when you only have the vault address)
  getSplitConfigAddressFromVault,

  // PDA derivation
  deriveSplitConfig,
  deriveVault,
  deriveAta,
  deriveProtocolConfig,
  generateUniqueId,

  // Label-based seeds (cross-chain compatible)
  labelToSeed,           // "my-split" → deterministic Address
  seedToLabel,           // Address → "my-split" or null

  // Pre-flight validation
  estimateSplitRent,     // Get rent costs before creating
  checkRecipientAtas,    // Check which recipient ATAs exist
  detectTokenProgram,    // Get token program for a mint (auto-detected internally)
  recipientsEqual,       // Compare recipient lists

  // Types
  type SplitConfig,
  type SplitRecipient,
  type ProtocolConfig,
  type UnclaimedAmount,
  type EstimateResult,
  type MissingAta,
} from "@cascade-fyi/splits-sdk";
```

### High-Level Client

Requires `@solana/kit` ^5.0.0 and WebSocket subscriptions. Uses WebSocket for confirmation.

```typescript
import {
  createSplitsClient,     // Factory function
  ensureSplitConfig,      // Idempotent create/update
  executeAndConfirmSplit, // Distribute vault funds
  updateSplit,            // Update recipients
  closeSplit,             // Close and recover rent
} from "@cascade-fyi/splits-sdk";
import { labelToSeed } from "@cascade-fyi/splits-sdk";

const result = await ensureSplitConfig({
  rpc,
  rpcSubscriptions,
  signer,
  recipients: [{ address: alice, share: 70 }, { address: bob, share: 29 }],
  uniqueId: labelToSeed("my-split"),  // Optional: human-readable → Address
});
```

### Client Factory

Stateful client for persistent use.

```typescript
import { createSplitsClient, createSplitsClientWithWallet } from "@cascade-fyi/splits-sdk";
import { fromWalletAdapter } from "@cascade-fyi/splits-sdk/web3-compat";

// Kit-native (server/backend)
const splits = createSplitsClient({ rpc, rpcSubscriptions, signer });

// With wallet-adapter (browser)
const splits = createSplitsClientWithWallet(rpc, fromWalletAdapter(wallet, connection));

// Methods
await splits.ensureSplit({ recipients, uniqueId? });
await splits.execute(splitConfig, { minBalance? });
await splits.update(splitConfig, { recipients });
await splits.close(splitConfig);
```

### Instruction Builders

For custom transaction building (facilitators with own tx logic):

```typescript
import {
  createSplitConfig,
  executeSplit,
  updateSplitConfig,
  closeSplitConfig,
} from "@cascade-fyi/splits-sdk";

// Returns { instruction, splitConfig, vault }
const { instruction, splitConfig, vault } = await createSplitConfig({
  authority,
  recipients,
  mint?,        // Default: USDC
  uniqueId?,    // Default: random
});

// Returns { status: "success", instruction } or { status: "not_found" | "not_a_split", splitConfig }
const result = await executeSplit({ rpc, splitConfig, executor });
```

### Read Functions

```typescript
import {
  getSplitConfig,
  getProtocolConfig,
  getVaultBalance,
  isCascadeSplit,
  getSplitConfigAddressFromVault,
} from "@cascade-fyi/splits-sdk";

// Get full split configuration from splitConfig address
const config = await getSplitConfig({ rpc, splitConfig });
// Returns: { address, authority, mint, vault, recipients, unclaimedAmounts, ... }

// Get protocol configuration (cached)
const protocol = await getProtocolConfig(rpc);
// Returns: { address, authority, feeWallet, bump }

// Get vault token balance
const balance = await getVaultBalance({ rpc, splitConfig });  // bigint

// Check if address is a Cascade Split (cached)
const isSplit = await isCascadeSplit({ rpc, splitConfig });   // boolean

// Edge case: convert vault address to splitConfig (when you only have the vault)
const splitConfig = await getSplitConfigAddressFromVault({ rpc, vault });
```

### Caching Behavior

The SDK automatically caches results to reduce RPC calls. Cache is managed internally — no manual intervention needed.

- `isCascadeSplit()`: Caches positive (is split) and definitive negative (exists but not split) results. Non-existent accounts are NOT cached (may be created later).
- `getProtocolConfig()`: Cached indefinitely, auto-invalidates on `InvalidProtocolFeeRecipient` error.
- `closeSplitConfig()`: Auto-invalidates the cache entry when a split is closed.

### PDA Derivation

```typescript
import {
  deriveSplitConfig,
  deriveVault,
  deriveAta,
  deriveProtocolConfig,
  generateUniqueId,
} from "@cascade-fyi/splits-sdk";

const splitConfig = await deriveSplitConfig(authority, mint, uniqueId);  // Address
const vault = await deriveVault(splitConfig, mint, tokenProgram?);       // Address
const ata = await deriveAta(owner, mint, tokenProgram?);                 // Address
const protocolConfig = await deriveProtocolConfig();                     // Address

const uniqueId = generateUniqueId();  // Random 32-byte Address
```

### Types & Constants

```typescript
import {
  // Program & Protocol
  PROGRAM_ID,
  PROTOCOL_FEE_BPS,          // 100 (1%)
  TOTAL_RECIPIENT_BPS,       // 9900 (99%)
  MAX_RECIPIENTS,            // 20

  // Token addresses
  USDC_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,

  // PDA seeds
  PROTOCOL_CONFIG_SEED,      // "protocol_config"
  SPLIT_CONFIG_SEED,         // "split_config"

  // Types
  type Recipient,

  // Conversion helpers
  shareToPercentageBps,      // share * 99
  percentageBpsToShares,     // Math.round(bps / 99)
  toPercentageBps,           // Get bps from Recipient
  generateUniqueId,          // Random 32-byte Address
} from "@cascade-fyi/splits-sdk";
```

### Web3.js Bridge (`/web3-compat`)

For wallet adapter integration:

```typescript
import {
  // Wallet adapters
  fromWalletAdapter,         // Wallet adapter → SplitsWallet
  WalletDisconnectedError,
  WalletRejectedError,

  // Type conversions
  toAddress,                 // PublicKey → Address
  toPublicKey,               // Address → PublicKey
  toKitSigner,               // Keypair → KeyPairSigner

  // Instruction conversions
  toWeb3Instruction,         // Kit instruction → web3.js instruction
  fromWeb3Instruction,       // web3.js instruction → Kit instruction

  // Transaction conversion
  toWeb3Transaction,         // Kit message → web3.js transaction
} from "@cascade-fyi/splits-sdk/web3-compat";

// Convert @solana/kit instruction to @solana/web3.js
const web3Ix = toWeb3Instruction(kitInstruction);
transaction.add(web3Ix);

// Convert between address types
const address = toAddress(publicKey);    // PublicKey → Address
const pubkey = toPublicKey(address);     // Address → PublicKey

// Convert Keypair to kit signer
const signer = await toKitSigner(keypair);
```

## Error Handling

### SDK Errors

```typescript
import {
  // Base class
  SplitsError,
  type SplitsErrorCode,

  // Specific errors
  VaultNotFoundError,
  SplitConfigNotFoundError,
  InvalidRecipientsError,
  ProtocolNotInitializedError,
  InvalidTokenAccountError,
  MintNotFoundError,
  RecipientAtasMissingError,
} from "@cascade-fyi/splits-sdk";

try {
  const config = await getSplitConfig(rpc, splitConfig);
} catch (e) {
  if (e instanceof SplitConfigNotFoundError) {
    console.log("Split doesn't exist:", e.address);
  } else if (e instanceof MintNotFoundError) {
    console.log("Mint not found:", e.mint);
  } else if (e instanceof RecipientAtasMissingError) {
    console.log("Missing ATAs:", e.missing);  // [{ recipient, ata }]
  }
}
```

### Program Error Codes

```typescript
import {
  CASCADE_SPLITS_ERROR__VAULT_NOT_EMPTY,
  CASCADE_SPLITS_ERROR__UNCLAIMED_NOT_EMPTY,
  getCascadeSplitsErrorMessage,
} from "@cascade-fyi/splits-sdk";

// Get human-readable message
const message = getCascadeSplitsErrorMessage(errorCode);
```

## Token-2022 Support

The SDK auto-detects Token-2022 tokens — no manual `tokenProgram` parameter needed:

- All functions internally detect the token program from the mint
- Transfer fees, frozen accounts (sRFC-37), and transfer hooks are supported
- Frozen recipient accounts trigger unclaimed flow (auto-delivers when thawed)

```typescript
// Works automatically for Token-2022 tokens like PYUSD
const result = await executeAndConfirmSplit({ rpc, rpcSubscriptions, splitConfig, signer });
```

## Performance Notes

### Compute Budget

Set compute limits based on recipient count:

```typescript
// ~30,000 base + 3,500 per recipient
const computeUnits = 30_000 + (recipientCount * 3_500);

await executeAndConfirmSplit({
  rpc,
  rpcSubscriptions,
  splitConfig,
  signer,
  computeUnitLimit: computeUnits,
  computeUnitPrice: 50_000n,  // Add priority fee during congestion
});
```

### Caching for High Volume

For facilitators processing many payments:

```typescript
// isCascadeSplit() caches results (~75% RPC reduction)
// - Positive results: cached indefinitely
// - Definitive negatives: cached indefinitely
// - Non-existent accounts: NOT cached (may be created later)

// Protocol config cached (rarely changes)
// Auto-retries on stale fee_wallet with cache invalidation
```

## Pre-flight Validation

### Rent Estimation

Show users the cost before they commit:

```typescript
import { estimateSplitRent } from "@cascade-fyi/splits-sdk";

const estimate = await estimateSplitRent(rpc, {
  authority: wallet.address,
  recipients: [
    { address: alice, share: 70 },
    { address: bob, share: 29 },
  ],
});

console.log(`Rent required: ${estimate.rentRequired} lamports`);  // ~0.017 SOL
console.log(`Vault will be: ${estimate.vault}`);
console.log(`Already exists: ${estimate.existsOnChain}`);

if (estimate.existsOnChain) {
  console.log(`Current recipients: ${estimate.currentRecipients?.length}`);
}
```

### Label-based Seeds

Convert human-readable labels to deterministic `Address` values:

```typescript
import { labelToSeed, seedToLabel, generateUniqueId } from "@cascade-fyi/splits-sdk";

// labelToSeed: human-readable → Address (max 27 chars, padded to 32 bytes)
const seed = labelToSeed("revenue-share");
// Same label always produces same Address — enables idempotency

// generateUniqueId: random 32-byte Address
const randomId = generateUniqueId();
// Different each call — use when you need unique splits and will store the address

// seedToLabel: Address → human-readable (if it was created with labelToSeed)
const label = seedToLabel(split.uniqueId);
// Returns string if recoverable, null if random/binary

// Display logic example
function getSplitName(split: SplitConfig): string {
  const label = seedToLabel(split.uniqueId);
  return label ?? `Split ${split.address.slice(0, 8)}...`;
}
```

**Cross-chain compatible**: `labelToSeed("name")` produces identical bytes on Solana and EVM.

### ATA Pre-checking

Validate recipient token accounts before creating splits:

```typescript
import { checkRecipientAtas } from "@cascade-fyi/splits-sdk";
import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";

const missing = await checkRecipientAtas(rpc, recipients, mint);

if (missing.length > 0) {
  // Create missing ATAs before split creation
  const instructions = missing.map(m =>
    getCreateAssociatedTokenIdempotentInstruction({
      payer: payer.address,
      owner: m.recipient as Address,
      mint,
      ata: m.ata as Address,
    })
  );
  // Send transaction with ATA creation instructions...
}

// Now safe to create split
await splits.ensureSplit({ recipients, mint });
```

## Resources

- **Architecture:** [ARCHITECTURE.md](https://github.com/cascade-protocol/splits/blob/main/packages/splits-sdk/ARCHITECTURE.md) — why the SDK is structured this way
- **Specification:** [docs/specification.md](https://github.com/cascade-protocol/splits/blob/main/docs/specification.md)
- **Changelog:** [CHANGELOG.md](https://github.com/cascade-protocol/splits/blob/main/packages/splits-sdk/CHANGELOG.md)
- **Issues:** [GitHub Issues](https://github.com/cascade-protocol/splits/issues)
- **Contact:** hello@cascade.fyi

## License

Apache-2.0
