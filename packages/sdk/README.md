# @cascade-fyi/splits-sdk

TypeScript SDK for [Cascade Splits](https://github.com/cascade-protocol/splits) — non-custodial payment splitting on Solana.

Split incoming payments to multiple recipients automatically. Built for high-throughput micropayments and x402 payment facilitators.

**Program ID:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Installation

```bash
npm install @cascade-fyi/splits-sdk @solana/kit
```

**Requirements:**
- `@solana/kit` ^5.0.0 (peer dependency)
- `@solana/web3.js` ^1.98.0 (optional, for wallet adapter compatibility)

## Quick Start

### For Facilitators: Execute a Split (HTTP-only)

```typescript
import { createSolanaRpc } from "@solana/kit";
import { sendExecuteSplit, isCascadeSplit } from "@cascade-fyi/splits-sdk/solana";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

// Check if payment destination is a split vault
if (await isCascadeSplit(rpc, vault)) {
  const result = await sendExecuteSplit(rpc, vault, signer, {
    minBalance: 1_000_000n, // Skip if < 1 USDC
  });

  if (result.status === "EXECUTED") {
    console.log(`Split executed: ${result.signature}`);
  } else if (result.status === "SKIPPED") {
    console.log(`Skipped: ${result.reason}`);
  }
}
```

> Uses HTTP polling — no WebSocket required. For WebSocket confirmation, use `executeAndConfirmSplit`.

### For Merchants: Create a Split (Idempotent)

```typescript
import { createSolanaRpc } from "@solana/kit";
import { sendEnsureSplit } from "@cascade-fyi/splits-sdk/solana";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

const result = await sendEnsureSplit(rpc, signer, {
  recipients: [
    { address: "Agent111...", share: 90 },
    { address: "Platform111...", share: 10 },
  ],
  seed: "revenue-share", // Optional: human-readable label
});

if (result.status === "CREATED") {
  console.log(`Share this address: ${result.splitConfig}`);  // Use for x402 payTo
} else if (result.status === "NO_CHANGE") {
  console.log(`Already exists: ${result.splitConfig}`);
}
```

> `ensure` is idempotent — safe to call repeatedly. Returns `NO_CHANGE` if split already matches.

### For Browser Apps: Client Factory

```typescript
import { createSplitsClient } from "@cascade-fyi/splits-sdk/solana/client";
import { fromWalletAdapter } from "@cascade-fyi/splits-sdk/solana/web3-compat";

const splits = createSplitsClient(rpc, fromWalletAdapter(wallet, connection));

const result = await splits.ensureSplit({
  recipients: [{ address: alice, share: 70 }, { address: bob, share: 29 }],
});
```

## Key Concepts

### 100-Share Model

Recipients specify shares from 1-100 that must total exactly 100. Protocol takes 1% fee during distribution.

```typescript
{ address: "Alice...", share: 60 }  // 60% of 99% = 59.4%
{ address: "Bob...", share: 40 }    // 40% of 99% = 39.6%
// Protocol receives 1%
```

### Discriminated Union Results

All operations return typed results with `status` discriminant:

```typescript
const result = await sendEnsureSplit(rpc, signer, { recipients });

switch (result.status) {
  case "CREATED":    // result.vault, result.signature, result.rentPaid
  case "UPDATED":    // result.vault, result.signature
  case "NO_CHANGE":  // result.vault (no transaction sent)
  case "BLOCKED":    // result.reason, result.message (e.g., vault not empty)
  case "FAILED":     // result.reason, result.message, result.error
}
```

`BLOCKED` is a valid state, not an error — e.g., "vault has balance, execute first".

### Unclaimed Amounts (Self-Healing)

If a recipient's token account is missing during execution:
- Their share is held as "unclaimed" in the vault
- Next execution auto-delivers when their account exists
- No separate claim instruction needed

```typescript
const config = await getSplitConfigFromVault(rpc, vault);
console.log(config.unclaimedAmounts);  // [{ recipient, amount, timestamp }]
```

## API Reference

### HTTP-Only Functions (`/solana`)

For servers without WebSocket. Uses HTTP polling for confirmation.

```typescript
import {
  sendEnsureSplit,    // Idempotent create/update
  sendExecuteSplit,   // Distribute vault funds
  sendUpdateSplit,    // Update recipients
  sendCloseSplit,     // Close and recover rent
} from "@cascade-fyi/splits-sdk/solana";

// All accept options:
{
  computeUnitPrice?: bigint,     // Priority fee
  computeUnitLimit?: number,
  commitment?: "confirmed" | "finalized",
  confirm?: boolean | { maxRetries, retryDelayMs },  // false = fire-and-forget
}
```

### WebSocket Functions (`/solana`)

Requires `rpcSubscriptions`. Uses WebSocket for confirmation.

```typescript
import {
  ensureSplitConfig,      // Idempotent create/update
  executeAndConfirmSplit, // Distribute vault funds
  updateSplit,            // Update recipients
  closeSplit,             // Close and recover rent
} from "@cascade-fyi/splits-sdk/solana";

const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
  recipients: [{ address: alice, share: 70 }, { address: bob, share: 29 }],
  seed: "my-split",  // Optional label
});
```

### Client Factory (`/solana/client`)

Stateful client for browser apps with persistent wallet.

```typescript
import { createSplitsClient, fromKitSigner } from "@cascade-fyi/splits-sdk/solana/client";
import { fromWalletAdapter } from "@cascade-fyi/splits-sdk/solana/web3-compat";

// With wallet-adapter (browser)
const splits = createSplitsClient(rpc, fromWalletAdapter(wallet, connection));

// With kit signer (requires WebSocket)
const splits = createSplitsClient(rpc, fromKitSigner(signer, rpc, rpcSubscriptions));

// Methods
await splits.ensureSplit({ recipients, seed? });
await splits.execute(vault, { minBalance? });
await splits.update(vault, { recipients });
await splits.close(vault);
```

### Instruction Builders (`/solana`)

For custom transaction building (facilitators with own tx logic):

```typescript
import {
  createSplitConfig,
  executeSplit,
  updateSplitConfig,
  closeSplitConfig,
} from "@cascade-fyi/splits-sdk/solana";

// Returns { instruction, splitConfig, vault }
const { instruction, vault } = await createSplitConfig({
  authority,
  recipients,
  mint?,        // Default: USDC
  uniqueId?,    // Default: random
});

// Returns { ok, instruction } or { ok: false, reason }
const result = await executeSplit(rpc, vault, executor);
```

### Read Functions (`/solana`)

```typescript
import {
  getSplitConfigFromVault,
  getProtocolConfig,
  getVaultBalance,
  isCascadeSplit,
} from "@cascade-fyi/splits-sdk/solana";

// Get full split configuration from vault address
const config = await getSplitConfigFromVault(rpc, vault);
// Returns: { address, authority, mint, vault, recipients, unclaimedAmounts, ... }

// Get protocol configuration (cached)
const protocol = await getProtocolConfig(rpc);
// Returns: { address, authority, feeWallet, bump }

// Get vault token balance
const balance = await getVaultBalance(rpc, vault);  // bigint

// Check if address is a Cascade Split (cached)
const isSplit = await isCascadeSplit(rpc, vault);   // boolean
```

### Cache Control (`/solana`)

For high-volume facilitators, results are cached to reduce RPC calls:

```typescript
import {
  invalidateSplitCache,
  clearSplitCache,
  invalidateProtocolConfigCache,
} from "@cascade-fyi/splits-sdk/solana";

// Clear cache for specific vault (after closing a split)
invalidateSplitCache(vault);

// Clear all split detection cache
clearSplitCache();

// Clear protocol config cache (auto-cleared on fee_wallet change)
invalidateProtocolConfigCache();
```

**Caching behavior:**
- `isCascadeSplit()`: Caches positive (is split) and definitive negative (exists but not split) results. Non-existent accounts are NOT cached.
- `getProtocolConfig()`: Cached indefinitely, auto-invalidates on `InvalidProtocolFeeRecipient` error.

### PDA Derivation (`/solana`)

```typescript
import {
  deriveSplitConfig,
  deriveVault,
  deriveAta,
  deriveProtocolConfig,
  generateUniqueId,
} from "@cascade-fyi/splits-sdk/solana";

const splitConfig = await deriveSplitConfig(authority, mint, uniqueId);  // Address
const vault = await deriveVault(splitConfig, mint, tokenProgram?);       // Address
const ata = await deriveAta(owner, mint, tokenProgram?);                 // Address
const protocolConfig = await deriveProtocolConfig();                     // Address

const uniqueId = generateUniqueId();  // Random 32-byte Address
```

### Types & Constants (`/`)

```typescript
import {
  PROGRAM_ID,
  PROTOCOL_FEE_BPS,      // 100 (1%)
  MAX_RECIPIENTS,        // 20
  USDC_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  type Recipient,
  sharesToBps,           // share * 99
  bpsToShares,           // Math.round(bps / 99)
  toPercentageBps,       // Get bps from Recipient
} from "@cascade-fyi/splits-sdk";
```

### Web3.js Bridge (`/solana/web3-compat`)

For wallet adapter integration:

```typescript
import { toWeb3Instruction, toAddress, toPublicKey } from "@cascade-fyi/splits-sdk/solana/web3-compat";

// Convert @solana/kit instruction to @solana/web3.js
const web3Ix = toWeb3Instruction(kitInstruction);
transaction.add(web3Ix);

// Convert between address types
const address = toAddress(publicKey);    // PublicKey → Address
const pubkey = toPublicKey(address);     // Address → PublicKey
```

## Error Handling

### SDK Errors

```typescript
import {
  VaultNotFoundError,
  SplitConfigNotFoundError,
  InvalidRecipientsError,
  ProtocolNotInitializedError,
  InvalidTokenAccountError,
} from "@cascade-fyi/splits-sdk";

try {
  const config = await getSplitConfigFromVault(rpc, vault);
} catch (e) {
  if (e instanceof VaultNotFoundError) {
    console.log("Vault doesn't exist:", e.vault);
  } else if (e instanceof SplitConfigNotFoundError) {
    console.log("Not a Cascade Split:", e.address);
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

The SDK auto-detects Token-2022 tokens:

- `executeAndConfirmSplit()` reads vault owner to determine token program
- Transfer fees, frozen accounts (sRFC-37), and transfer hooks are supported
- Frozen recipient accounts trigger unclaimed flow (auto-delivers when thawed)

```typescript
// Works automatically for Token-2022 tokens like PYUSD
const result = await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer);
```

## Performance Notes

### Compute Budget

Set compute limits based on recipient count:

```typescript
// ~30,000 base + 3,500 per recipient
const computeUnits = 30_000 + (recipientCount * 3_500);

await executeAndConfirmSplit(rpc, rpcSubscriptions, vault, signer, {
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

## Resources

- **Architecture:** [ARCHITECTURE.md](https://github.com/cascade-protocol/splits/blob/main/packages/sdk/ARCHITECTURE.md) — why the SDK is structured this way
- **Specification:** [docs/specification.md](https://github.com/cascade-protocol/splits/blob/main/docs/specification.md)
- **Changelog:** [CHANGELOG.md](https://github.com/cascade-protocol/splits/blob/main/packages/sdk/CHANGELOG.md)
- **Issues:** [GitHub Issues](https://github.com/cascade-protocol/splits/issues)
- **Contact:** hello@cascade.fyi

## License

Apache-2.0
