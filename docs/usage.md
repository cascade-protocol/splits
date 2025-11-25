# Cascade Splits SDK

Revenue sharing in 5 minutes.

## Installation

```bash
npm install @cascade-fyi/splits-sdk
```

## Quick Start

```typescript
import { CascadeSplits } from "@cascade-fyi/splits-sdk/web3";

const sdk = new CascadeSplits(connection);

// Create a split
const { splitConfig, vault, transaction } = await sdk.buildCreateSplit(
  authority,
  {
    recipients: [
      { address: "platform.sol", share: 10 },   // 10%
      { address: "merchant.sol", share: 90 },   // 90%
    ],
  }
);

// Sign and send
await sendAndConfirm(transaction);

// Use `vault` as your x402 payTo address
```

## Key Concepts

- **Shares sum to 100** — SDK converts to 9900 basis points (99%), protocol takes 1%
- **Builder pattern** — Methods return unsigned transactions for flexible signing
- **Permissionless execution** — Anyone can call `executeSplit()` to distribute funds
- **Self-healing** — Missing recipient ATAs are tracked as unclaimed, auto-delivered when valid

## API Reference

| Method | Description |
|--------|-------------|
| `buildCreateSplit(authority, params)` | Create new split configuration |
| `buildExecuteSplit(vault)` | Distribute vault balance to recipients |
| `buildUpdateSplit(vault, recipients)` | Update recipient list (vault must be empty) |
| `buildCloseSplit(vault)` | Close config and reclaim rent |

### Read Methods

| Method | Description |
|--------|-------------|
| `getSplit(vault)` | Fetch split configuration |
| `getVaultBalance(vault)` | Get current vault balance |
| `previewExecution(vault)` | Preview distribution amounts |

## x402 Integration

Use the vault address as your `payTo` destination. x402 facilitators can bundle payment + execute in a single atomic transaction:

```typescript
const tx = new Transaction()
  .add(transferInstruction(vault, amount))
  .add(await sdk.buildExecuteSplit(vault));
```

## Costs

| Operation | Cost |
|-----------|------|
| Create split | ~0.015 SOL rent (refundable) |
| Execute split | ~0.000005 SOL compute |
| Protocol fee | 1% of distributed amount |

## Links

- [GitHub](https://github.com/cascade-protocol/splits)
- [NPM](https://www.npmjs.com/package/@cascade-fyi/splits-sdk)
- [Protocol Specification](./specification.md)
