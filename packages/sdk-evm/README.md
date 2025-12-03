# @cascade-fyi/splits-sdk-evm

TypeScript SDK for [Cascade Splits](https://github.com/cascade-protocol/splits) on EVM chains (Base).

Split incoming payments to multiple recipients automatically. Built for high-throughput micropayments.

**Factory Address:** `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` (Base Mainnet & Sepolia)

## Installation

```bash
npm install @cascade-fyi/splits-sdk-evm viem
```

**Requirements:**
- `viem` ^2.41.2

## Quick Start

### Create a Split

```typescript
import { createEvmSplitsClient } from "@cascade-fyi/splits-sdk-evm/client";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const client = createEvmSplitsClient(base, {
  account: privateKeyToAccount("0x..."),
});

const result = await client.ensureSplit({
  uniqueId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  recipients: [
    { address: "0xAlice...", share: 60 },
    { address: "0xBob...", share: 40 },
  ],
});

if (result.status === "CREATED") {
  console.log(`Split created at ${result.split}`);
} else if (result.status === "NO_CHANGE") {
  console.log(`Already exists at ${result.split}`);
}
```

### Execute a Split

```typescript
const execResult = await client.execute(splitAddress);

if (execResult.status === "EXECUTED") {
  console.log(`Distributed in tx ${execResult.signature}`);
} else if (execResult.status === "SKIPPED") {
  console.log(`Skipped: ${execResult.reason}`);
}
```

### Low-Level Functions

```typescript
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { ensureSplit, executeSplit, isCascadeSplit } from "@cascade-fyi/splits-sdk-evm";

const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ chain: base, transport: http(), account });

// Check if address is a split
if (await isCascadeSplit(publicClient, address)) {
  // Execute distribution
  const result = await executeSplit(publicClient, walletClient, address);
}
```

## Key Concepts

### 100-Share Model

Recipients specify shares from 1-100 that must total exactly 100. Protocol takes 1% fee during distribution.

```typescript
{ address: "0xAlice...", share: 60 }  // 60% of 99% = 59.4%
{ address: "0xBob...", share: 40 }    // 40% of 99% = 39.6%
// Protocol receives 1%
```

### Discriminated Union Results

All operations return typed results with `status` discriminant:

```typescript
const result = await client.ensureSplit({ uniqueId, recipients });

switch (result.status) {
  case "CREATED":   // result.split, result.signature
  case "NO_CHANGE": // result.split (already exists)
  case "FAILED":    // result.reason, result.message, result.error
}
```

### Immutable Splits

Unlike Solana, EVM splits are **immutable** — recipients cannot be changed after creation. Create a new split with a different `uniqueId` if you need different recipients.

## API Reference

### Client Factory (`/client`)

```typescript
import { createEvmSplitsClient } from "@cascade-fyi/splits-sdk-evm/client";

const client = createEvmSplitsClient(chain, { account, transport? }, { factoryAddress? });

// Properties
client.address      // Wallet address
client.chain        // Connected chain
client.factoryAddress  // Factory contract address

// Methods
await client.ensureSplit({ uniqueId, recipients, authority?, token? })
await client.execute(splitAddress, { minBalance? })
await client.getSplit(splitAddress)
await client.getBalance(splitAddress)
await client.isCascadeSplit(address)
await client.previewExecution(splitAddress)
await client.predictSplitAddress({ uniqueId, recipients, authority?, token? })
```

### Core Functions (`/`)

```typescript
import {
  ensureSplit,
  executeSplit,
  isCascadeSplit,
  getSplitConfig,
  getSplitBalance,
  predictSplitAddress,
  previewExecution,
  hasPendingFunds,
  getPendingAmount,
  getTotalUnclaimed,
} from "@cascade-fyi/splits-sdk-evm";

// Create split (idempotent)
const result = await ensureSplit(publicClient, walletClient, factoryAddress, {
  uniqueId: "0x...",
  recipients: [{ address: "0x...", share: 100 }],
  authority?,  // Default: wallet address
  token?,      // Default: USDC
});

// Execute distribution
const result = await executeSplit(publicClient, walletClient, splitAddress, {
  minBalance?: 1_000_000n,  // Skip if below 1 USDC
});

// Read operations
const config = await getSplitConfig(publicClient, splitAddress);
const balance = await getSplitBalance(publicClient, splitAddress);
const isSplit = await isCascadeSplit(publicClient, address);
const preview = await previewExecution(publicClient, splitAddress);
```

### Address Helpers

```typescript
import {
  getSplitFactoryAddress,
  getUsdcAddress,
  isSupportedChain,
  SPLIT_FACTORY_ADDRESSES,
  USDC_ADDRESSES,
  SUPPORTED_CHAIN_IDS,
} from "@cascade-fyi/splits-sdk-evm";

const factory = getSplitFactoryAddress(8453);  // Base mainnet
const usdc = getUsdcAddress(8453);
const supported = isSupportedChain(8453);  // true
```

### Recipient Conversion

```typescript
import { toEvmRecipient, toEvmRecipients } from "@cascade-fyi/splits-sdk-evm";

// Convert share (1-100) to basis points
const recipient = toEvmRecipient({ address: "0x...", share: 50 });
// { addr: "0x...", percentageBps: 4950 }

// Or use percentageBps directly
const recipient = toEvmRecipient({ address: "0x...", percentageBps: 4950 });
```

### ABI Exports

```typescript
import { splitFactoryAbi, splitConfigImplAbi } from "@cascade-fyi/splits-sdk-evm";

// Use with viem's getContract
const factory = getContract({
  address: factoryAddress,
  abi: splitFactoryAbi,
  client: publicClient,
});
```

## Types

```typescript
import type {
  EvmRecipient,
  EvmRecipientInput,
  EvmSplitConfig,
  EvmExecutionPreview,
  EvmEnsureResult,
  EvmExecuteResult,
  EvmEnsureParams,
  EvmExecuteOptions,
  EvmEnsureStatus,
  EvmExecuteStatus,
  EvmFailedReason,
  EvmSkippedReason,
  SupportedChainId,
} from "@cascade-fyi/splits-sdk-evm";
```

## Supported Chains

| Chain | Chain ID | Factory | USDC |
|-------|----------|---------|------|
| Base Mainnet | 8453 | `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Resources

- **Specification:** [docs/specification-evm.md](https://github.com/cascade-protocol/splits/blob/main/docs/specification-evm.md)
- **Changelog:** [CHANGELOG.md](https://github.com/cascade-protocol/splits/blob/main/packages/sdk-evm/CHANGELOG.md)
- **Solana SDK:** [@cascade-fyi/splits-sdk](https://www.npmjs.com/package/@cascade-fyi/splits-sdk)
- **Issues:** [GitHub Issues](https://github.com/cascade-protocol/splits/issues)
- **Contact:** hello@cascade.fyi

## License

Apache-2.0
