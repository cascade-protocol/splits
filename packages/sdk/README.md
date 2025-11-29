# @cascade-fyi/splits-sdk

TypeScript SDK for [Cascade Splits](https://github.com/cascade-protocol/splits) – permissionless payment splitting on Solana.

**Program:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Install

```bash
npm install @cascade-fyi/splits-sdk @solana/kit
```

## Quick Start

```typescript
import { createSplitConfig, executeSplit } from "@cascade-fyi/splits-sdk/solana";

const { instruction, vault } = await createSplitConfig({
  authority: wallet,
  recipients: [
    { address: "Agent111111111111111111111111111111111111111", share: 90 },
    { address: "Marketplace1111111111111111111111111111111", share: 10 },
  ],
});

const result = await executeSplit(rpc, vault, executor);
if (result.ok) {
  await sendTransaction(result.instruction);
}
```

### Web3.js Compatibility

```typescript
import { executeSplit } from "@cascade-fyi/splits-sdk/solana";
import { toWeb3Instruction } from "@cascade-fyi/splits-sdk/solana/web3-compat";

const result = await executeSplit(rpc, vault, executor);
if (result.ok) {
  const web3Ix = toWeb3Instruction(result.instruction);
  transaction.add(web3Ix); // use with @solana/web3.js
}
```

## API

### Instructions (`/solana`)

```typescript
// Create split - returns { instruction, splitConfig, vault }
createSplitConfig({
  authority: Address;
  recipients: { address: string; share: number }[];
  mint?: Address;         // default: USDC
  uniqueId?: Address;     // default: random
  tokenProgram?: Address; // default: SPL Token
  payer?: Address;        // default: authority
})

// Execute distribution - returns { ok, instruction } or { ok: false, reason }
executeSplit(rpc, vault, executor, tokenProgram?)

// Update recipients - requires empty vault
updateSplitConfig(rpc, { vault, authority, recipients, tokenProgram? })

// Close and recover rent - requires empty vault
closeSplitConfig(rpc, { vault, authority, rentReceiver?, tokenProgram? })
```

### Read Functions (`/solana`)

```typescript
getSplit(rpc, vault)         // SplitConfig
getProtocolConfig(rpc)       // ProtocolConfig
getVaultBalance(rpc, vault)  // bigint
isCascadeSplit(rpc, address) // boolean
```

### PDAs (`/solana`)

```typescript
deriveSplitConfig(authority, mint, uniqueId)  // { address, bump }
deriveVault(splitConfig, mint, tokenProgram?) // Address
deriveAta(owner, mint, tokenProgram?)         // Address
deriveProtocolConfig()                        // { address, bump }
```

### Types & Constants (`/`)

```typescript
import {
  type Recipient,
  type SplitConfig,
  PROGRAM_ID,
  PROTOCOL_FEE_BPS,    // 100 (1%)
  MAX_RECIPIENTS,      // 20
  validateRecipients,  // throws InvalidRecipientsError
  sharesToBps,         // share * 99
  bpsToShares,         // bps / 99
} from "@cascade-fyi/splits-sdk";
```

### Web3.js Bridge (`/solana/web3-compat`)

```typescript
toAddress(pubkey)           // PublicKey → Address
toPublicKey(address)        // Address → PublicKey
toWeb3Instruction(ix)       // Instruction → TransactionInstruction
fromWeb3Instruction(ix)     // TransactionInstruction → Instruction
```

## Key Concepts

### 100-Share Model

Shares must sum to **100**. Protocol takes 1% fee during distribution.

```typescript
{ address: "Agent111111111111111111111111111111111111111", share: 90 }
{ address: "Marketplace1111111111111111111111111111111", share: 10 }
```

### Unclaimed Amounts

Missing recipient ATAs don't fail – amounts are held as unclaimed:

```typescript
const split = await getSplit(rpc, vault);
split.unclaimedAmounts; // [{ recipient, amount, timestamp }]
```

Next execution auto-clears if ATAs exist. Cannot update/close until all unclaimed = 0.

### Discriminated Returns

`executeSplit` returns a discriminated union for type-safe handling:

```typescript
const result = await executeSplit(rpc, vault, executor);
if (result.ok) {
  // result.instruction is available
} else {
  // result.reason: "not_a_split" | "not_found"
}
```

## License

Apache-2.0
