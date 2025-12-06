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
import type { Hash } from "viem";

const client = createEvmSplitsClient(base, {
  account: privateKeyToAccount("0x..."),
});

// Generate a unique ID (or use a deterministic one for idempotency)
const uniqueId = `0x${crypto.randomUUID().replace(/-/g, "").padStart(64, "0")}` as Hash;

const result = await client.ensureSplit({
  uniqueId,
  recipients: [
    { address: "0xAlice...", share: 60 },
    { address: "0xBob...", share: 40 },
  ],
});

// Handle all possible outcomes
switch (result.status) {
  case "CREATED":
    console.log(`Split created at ${result.split}`);
    console.log(`Transaction: ${result.signature}`);
    break;
  case "NO_CHANGE":
    console.log(`Already exists at ${result.split}`);
    break;
  case "FAILED":
    console.log(`Failed: ${result.message}`);
    break;
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
// ensureSplit
const result = await client.ensureSplit({ uniqueId, recipients });

switch (result.status) {
  case "CREATED":   // result.split, result.signature
  case "NO_CHANGE": // result.split (already exists)
  case "FAILED":    // result.reason, result.message, result.error?
}

// executeSplit
const execResult = await client.execute(splitAddress);

switch (execResult.status) {
  case "EXECUTED":  // execResult.signature
  case "SKIPPED":   // execResult.reason
  case "FAILED":    // execResult.reason, execResult.message
}
```

**Failed reasons:** `wallet_rejected`, `wallet_disconnected`, `network_error`, `transaction_failed`, `transaction_reverted`, `insufficient_gas`

**Skipped reasons:** `not_found`, `not_a_split`, `below_threshold`, `no_pending_funds`

### Immutable Splits

Unlike Solana, EVM splits are **immutable** — recipients cannot be changed after creation. Create a new split with a different `uniqueId` if you need different recipients.

## API Reference

### Client Factory (`/client`)

```typescript
import {
  createEvmSplitsClient,
  type EvmSplitsClient,
  type EvmSplitsClientConfig,
  type WalletConfig,
} from "@cascade-fyi/splits-sdk-evm/client";

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
  // Core operations
  ensureSplit,
  executeSplit,

  // Read functions
  isCascadeSplit,
  getSplitConfig,
  getSplitBalance,
  predictSplitAddress,
  previewExecution,
  hasPendingFunds,
  getPendingAmount,
  getTotalUnclaimed,

  // Helpers
  getDefaultToken,           // Get USDC address for a chain
  toEvmRecipient,
  toEvmRecipients,
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

## React Integration (Wagmi)

For React apps with Wagmi, use the ABIs directly with wagmi hooks:

```typescript
import { useWriteContract, useReadContracts } from "wagmi";
import {
  splitFactoryAbi,
  splitConfigImplAbi,
  getSplitFactoryAddress,
  getUsdcAddress,
  toEvmRecipients,
} from "@cascade-fyi/splits-sdk-evm";
import { base } from "wagmi/chains";

const FACTORY = getSplitFactoryAddress(base.id);
const USDC = getUsdcAddress(base.id);

function useCreateSplit() {
  const { writeContractAsync } = useWriteContract();

  return async (recipients: Array<{ address: `0x${string}`; share: number }>) => {
    const uniqueId = `0x${crypto.randomUUID().replace(/-/g, "").padStart(64, "0")}` as `0x${string}`;
    const evmRecipients = toEvmRecipients(recipients);

    return writeContractAsync({
      address: FACTORY,
      abi: splitFactoryAbi,
      functionName: "createSplitConfig",
      args: [authority, USDC, uniqueId, evmRecipients],
      chainId: base.id,
    });
  };
}
```

## Split Discovery

To discover splits owned by an address, use Goldsky subgraph:

```typescript
const GOLDSKY_URL = "https://api.goldsky.com/api/public/project_cmiq5kvoq64hs01wh0ydoesqs/subgraphs/cascade-splits-base/1.0.0/gn";

async function getSplitsForAuthority(authority: string) {
  const response = await fetch(GOLDSKY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{
        splitConfigCreateds(
          where: { authority: "${authority.toLowerCase()}" }
          orderBy: block_number
          orderDirection: desc
        ) {
          split
          block_number
        }
      }`,
    }),
  });

  const { data } = await response.json();
  return data.splitConfigCreateds.map((e: any) => e.split);
}
```

## Resources

- **Specification:** [docs/specification-evm.md](https://github.com/cascade-protocol/splits/blob/main/docs/specification-evm.md)
- **Changelog:** [CHANGELOG.md](https://github.com/cascade-protocol/splits/blob/main/packages/splits-sdk-evm/CHANGELOG.md)
- **Solana SDK:** [@cascade-fyi/splits-sdk](https://www.npmjs.com/package/@cascade-fyi/splits-sdk)
- **Issues:** [GitHub Issues](https://github.com/cascade-protocol/splits/issues)
- **Contact:** hello@cascade.fyi

## License

Apache-2.0
