# @cascade-fyi/splits-sdk

TypeScript SDK for [Cascade Splits](https://github.com/cascade-protocol/splits) – permissionless payment splitting on Solana.

**Program:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Install

```bash
npm install @cascade-fyi/splits-sdk @solana/web3.js
# or
npm install @cascade-fyi/splits-sdk @solana/kit
```

## Quick Start

### @solana/web3.js

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { CascadeSplits } from "@cascade-fyi/splits-sdk/web3";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const sdk = new CascadeSplits(connection);

// Create split (60/40 distribution)
const { splitConfig, vault, transaction } = await sdk.buildCreateSplit(
  authority.publicKey,
  {
    recipients: [
      { address: "alice.sol", share: 60 },
      { address: "bob.sol", share: 40 }
    ]
  }
);

transaction.sign([authority]);
await connection.sendTransaction(transaction);

// Execute distribution (anyone can call)
const executeTx = await sdk.buildExecuteSplit(vault, executor.publicKey);
executeTx.sign([executor]);
await connection.sendTransaction(executeTx);
```

### @solana/kit v5

```typescript
import { createSolanaRpc, address } from "@solana/kit";
import { buildCreateSplitInstruction } from "@cascade-fyi/splits-sdk/kit";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

const createIx = buildCreateSplitInstruction(
  {
    recipients: [
      { address: "alice.sol", share: 60 },
      { address: "bob.sol", share: 40 }
    ]
  },
  address(authority),
);
```

## Core Concepts

### 100-Share Model

Specify shares that sum to **100**. The SDK handles everything else.
- `share: 60` means 60% for that recipient
- `share: 40` means 40% for that recipient

A 1% protocol fee is deducted during distribution (see `previewDistribution` for details).

### Token Compatibility

Supports both SPL Token and Token-2022, including [sRFC-37](https://forum.solana.com/t/srfc-37-efficient-block-allow-list-token-standard/4036) tokens with `DefaultAccountState::Frozen`. Frozen accounts automatically hold funds as unclaimed until thawed.

### Address Prediction

Derive split addresses **before creation** using deterministic PDAs:

```typescript
import { deriveCreateSplitConfigAddresses } from "@cascade-fyi/splits-sdk";
import { Keypair } from "@solana/web3.js";

// Generate a unique ID for this split
const uniqueId = Keypair.generate().publicKey.toBase58();

// Derive all addresses at once
const { splitConfig, vault } = deriveCreateSplitConfigAddresses(
  authority,     // Your wallet address
  mint,          // Token mint (USDC, etc.)
  uniqueId,
);

console.log("Split config will be:", splitConfig);
console.log("Send payments to vault:", vault);
// The vault address is stable - share it before the split exists!
```

### Unclaimed Amounts

Missing recipient ATAs don't fail execution – amounts are held as unclaimed:
```typescript
const split = await sdk.getSplit(vault);
split.unclaimedAmounts; // [{ recipient, amount, timestamp }]
```

Next execution auto-clears unclaimed amounts if ATAs now exist.

**Critical:** Cannot update/close split until all unclaimed = 0.

### Vault Address

The split config PDA owns the vault (token account). Send payments to the vault, then call execute:

```typescript
import { deriveVault, deriveSplitConfig } from "@cascade-fyi/splits-sdk";

const { address: splitConfig } = deriveSplitConfig(authority, mint, uniqueId);
const vault = deriveVault(splitConfig, mint, tokenProgram);
```

### Parsing Transactions & Accounts

The SDK exports discriminators for identifying instructions and accounts in on-chain data:

```typescript
import {
  DISCRIMINATORS,
  ACCOUNT_DISCRIMINATORS,
  matchesDiscriminator
} from "@cascade-fyi/splits-sdk";

// Identify instruction type from transaction data
if (matchesDiscriminator(instructionData, DISCRIMINATORS.executeSplit)) {
  console.log("This is an execute split instruction");
}

// Identify account type from account data
if (matchesDiscriminator(accountData, ACCOUNT_DISCRIMINATORS.splitConfig)) {
  console.log("This is a split config account");
}

// Available instruction discriminators:
// - createSplitConfig, executeSplit, updateSplitConfig, closeSplitConfig
// - initializeProtocol, updateProtocolConfig, transferProtocolAuthority, acceptProtocolAuthority

// Available account discriminators:
// - splitConfig, protocolConfig
```

## API Reference

### web3 Adapter

```typescript
class CascadeSplits {
  // Create split
  buildCreateSplit(
    authority: PublicKey,
    params: { recipients: { address: string; share: number }[]; token?: string },
    options?: { priorityFee?: number; computeUnits?: number }
  ): Promise<{ splitConfig: string; vault: string; transaction: VersionedTransaction }>

  // Execute distribution (permissionless)
  buildExecuteSplit(
    vault: string,
    executor: PublicKey,
    options?: TransactionOptions
  ): Promise<VersionedTransaction>

  // Update recipients (requires empty vault + no unclaimed)
  buildUpdateSplit(
    authority: PublicKey,
    params: { vault: string; recipients: { address: string; share: number }[] },
    options?: TransactionOptions
  ): Promise<VersionedTransaction>

  // Close split and recover rent
  buildCloseSplit(
    vault: string,
    authority: PublicKey,
    rentReceiver?: PublicKey,
    options?: TransactionOptions
  ): Promise<VersionedTransaction>

  // Read split config
  getSplit(vault: string): Promise<SplitConfig>

  // Get vault balance
  getVaultBalance(vault: string): Promise<bigint>

  // Preview distribution
  previewExecution(vault: string): Promise<{
    vault: string;
    currentBalance: bigint;
    distributions: { address: string; amount: bigint; share: number }[];
    protocolFee: bigint;
    ready: boolean;
  }>
}
```

### kit Adapter

```typescript
// Instruction builders (async - fetch on-chain data)
buildCreateSplitInstruction(params, authority, payer?, uniqueId?): KitInstruction
buildExecuteSplitInstruction(rpc, vault, executor): Promise<KitInstruction>
buildUpdateSplitInstruction(rpc, params, authority): Promise<KitInstruction>
buildCloseSplitInstruction(rpc, vault, authority, rentReceiver?): Promise<KitInstruction>

// Read functions
getSplit(rpc, vault): Promise<SplitConfig>
getVaultBalance(rpc, vault): Promise<bigint>
getProtocolConfig(rpc): Promise<ProtocolConfig>
previewExecution(rpc, vault): Promise<DistributionPreview>
```

## Validation

Built-in Zod schemas with strict validation:

```typescript
import { CreateSplitInputSchema } from "@cascade-fyi/splits-sdk/schemas";

// Validates:
// - Shares sum to 100
// - Valid Solana addresses
// - 2-20 recipients
CreateSplitInputSchema.parse({
  recipients: [
    { address: "...", share: 60 },
    { address: "...", share: 40 }
  ],
  token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // optional
});
```

For bundler/edge environments, use mini schemas (no Zod dependency):
```typescript
import { validateCreate } from "@cascade-fyi/splits-sdk/schemas/mini";
```

## Examples

### Execute with priority fee

```typescript
const tx = await sdk.buildExecuteSplit(vault, executor.publicKey, {
  priorityFee: 100_000, // microlamports
  computeUnits: 200_000
});
```

### Update recipients

```typescript
// Vault must be empty and all unclaimed = 0
const updateTx = await sdk.buildUpdateSplit(
  authority.publicKey,
  {
    vault,
    recipients: [
      { address: "charlie.sol", share: 50 },
      { address: "dana.sol", share: 50 }
    ]
  }
);
```

### Check before close

```typescript
const split = await sdk.getSplit(vault);
const balance = await sdk.getVaultBalance(vault);

if (balance > 0n) {
  // Execute first to distribute
  await sdk.buildExecuteSplit(vault, executor.publicKey);
}

if (split.unclaimedAmounts.length > 0) {
  // Wait for recipients to create ATAs, then execute again
  throw new Error("Cannot close: unclaimed amounts exist");
}

// Now safe to close
await sdk.buildCloseSplit(vault, authority.publicKey);
```

## Type Safety

All types exported:

```typescript
import type {
  SplitConfig,
  DistributionPreview,
  CreateSplitInput,
  UpdateSplitInput,
  ShareRecipient
} from "@cascade-fyi/splits-sdk";
```

## Advanced

### Basis Point Conversion

For indexers, analytics, or custom instruction building, you can convert between the 100-share model and raw basis points:

```typescript
import { sharesToBasisPoints, basisPointsToShares } from "@cascade-fyi/splits-sdk";

// Convert shares to on-chain basis points
sharesToBasisPoints(50);  // 4950 bps
sharesToBasisPoints(100); // 9900 bps (single recipient)

// Convert on-chain basis points back to shares
basisPointsToShares(4950); // 50
basisPointsToShares(3267); // 33

// Formula: share * 99 = bps (protocol reserves 1% fee)
```

## License

Apache-2.0
