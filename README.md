# Cascade Splits

Non-custodial payment splitting protocol for Solana. Automatically distribute incoming payments to multiple recipients based on pre-configured percentages.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-green.svg)](https://solana.com)
[![npm](https://img.shields.io/npm/v/@cascade-fyi/splits-sdk.svg)](https://www.npmjs.com/package/@cascade-fyi/splits-sdk)
[![Verified Build](https://img.shields.io/badge/Verified-OtterSec-brightgreen.svg)](https://verify.osec.io/status/SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB)

**Program ID:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Overview

Cascade Splits enables trustless payment distribution on Solana:

- **Non-custodial**: Funds held in PDA-owned vaults, no private keys
- **Automatic**: Split funds instantly on execution
- **Permissionless**: Anyone can trigger distributions
- **Self-healing**: Missing recipient ATAs handled gracefully with automatic recovery

### How It Works

```
Payment → Vault (PDA) → execute_split() → Recipients
```

1. Authority creates a split config with recipients and percentages
2. Protocol creates a vault (ATA owned by PDA) to receive payments
3. Payments sent to vault
4. Anyone calls `execute_split()` to distribute funds

## Features

- **1-20 recipients** per split configuration
- **1% protocol fee** (transparent, on-chain enforced)
- **SPL Token & Token-2022** support, including [sRFC-37](https://forum.solana.com/t/srfc-37-efficient-block-allow-list-token-standard/4036) frozen accounts
- **Multiple configs** per authority/mint via unique identifiers
- **Idempotent execution** - safe to retry
- **Self-healing** - unclaimed funds auto-deliver when ATAs created
- **Zero-copy accounts** - optimized for high-throughput micropayments

## Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/cascade-protocol/splits.git
cd splits

# Install dependencies
pnpm install

# Build program
anchor build
```

### Run Tests

```bash
# Mollusk unit tests (fast)
cargo test -p cascade-splits

# Anchor integration tests
anchor test
```

### Run Benchmarks

```bash
cargo bench -p cascade-splits
```

## Costs

### Rent (Refundable)

Creating a split config requires rent-exempt deposits that are **fully refundable** when closing:

| Account | Size | Rent |
|---------|------|------|
| SplitConfig | 1,832 bytes | 0.0136 SOL |
| Vault ATA | 165 bytes | 0.0020 SOL |
| **Total** | | **~0.0157 SOL** |

At $150/SOL ≈ $2.35 (refunded on `close_split_config`)

### Compute Units

| Instruction | CUs | Notes |
|------------|-----|-------|
| execute_split (1 recipient) | ~28,505 | Minimal case |
| execute_split (5 recipients) | ~68,573 | Typical case |
| execute_split (10 recipients) | ~109,000 | High activity |
| create_split_config | 36,590 - 40,024 | Includes vault ATA creation |
| update_split_config | 7,424 - 14,032 | Varies by recipient count |
| close_split_config | ~10,168 | Includes vault ATA closure |
| initialize_protocol | ~8,998 | One-time setup |

Scaling: ~8K CU per recipient (6K Token CPI + 2K overhead). Even 10-recipient splits use only 8% of Solana's 1.4M CU budget.

For comparison: typical DEX swaps use 100,000-400,000+ CUs.

See [docs/benchmarks/compute_units.md](docs/benchmarks/compute_units.md) for full benchmark history and additional scenarios (unclaimed flows, protocol admin ops).

## Usage Example

### Execute a Split (Facilitators)

```typescript
import { createSolanaRpc } from "@solana/kit";
import { sendExecuteSplit, isCascadeSplit } from "@cascade-fyi/splits-sdk/solana";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

// Check if destination is a split vault
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

> **Note:** `sendExecuteSplit` uses HTTP polling for confirmation — no WebSocket required. For WebSocket-based confirmation, use `executeAndConfirmSplit` with `rpcSubscriptions`.

### Create a Split (Merchants)

```typescript
import { createSplitConfig } from "@cascade-fyi/splits-sdk/solana";

const { instruction, vault } = await createSplitConfig({
  authority: myWallet,
  recipients: [
    { address: "Agent111111111111111111111111111111111111111", share: 90 },
    { address: "Marketplace1111111111111111111111111111111", share: 10 },
  ],
});

// Sign and send instruction, then share `vault` with payers
```

See [SDK documentation](packages/sdk/README.md) for complete API reference.

## Architecture

### Account Structure

**ProtocolConfig** (global singleton)
- Authority and fee wallet configuration
- Seeds: `[b"protocol_config"]`

**SplitConfig** (per-split)
- Recipients, percentages, vault address
- Seeds: `[b"split_config", authority, mint, unique_id]`
- Zero-copy for optimal compute (1,832 bytes fixed)

### Instructions

| Instruction | Authorization | Description |
|------------|---------------|-------------|
| `initialize_protocol` | Deployer | One-time protocol setup |
| `update_protocol_config` | Protocol authority | Update fee wallet |
| `create_split_config` | Anyone | Create new split |
| `execute_split` | Anyone | Distribute vault funds |
| `update_split_config` | Config authority | Update recipients |
| `close_split_config` | Config authority | Delete config, reclaim rent |

## Self-Healing Unclaimed Recovery

If a recipient's ATA is missing during execution:

1. Their share is recorded as "unclaimed" and stays in vault
2. Funds are protected from re-splitting
3. On next `execute_split`, system attempts to clear unclaimed
4. Once recipient creates ATA, funds auto-deliver

No separate claim instruction needed - single interface for all operations.

## x402 Integration

Cascade Splits integrates seamlessly with x402 payment facilitators:

```typescript
import { isCascadeSplit, sendExecuteSplit } from "@cascade-fyi/splits-sdk/solana";

// In your facilitator's settle handler:
if (await isCascadeSplit(rpc, paymentDestination)) {
  // It's a split vault - execute distribution after payment
  await sendExecuteSplit(rpc, paymentDestination, signer);
}
```

Use the vault address as your `payTo` destination. The SDK caches detection results for high-volume efficiency. HTTP-only — no WebSocket required.

See [specification](docs/specification.md) for complete integration guide.

## Development

### Project Structure

```
├── programs/cascade-splits/
│   ├── src/
│   │   ├── instructions/    # Instruction handlers
│   │   ├── state.rs         # Account structures
│   │   ├── errors.rs        # Error codes
│   │   └── events.rs        # Event definitions
│   ├── tests/               # Mollusk unit tests
│   └── benches/             # Compute unit benchmarks
├── packages/sdk/            # TypeScript SDK
└── docs/
    └── specification.md     # Full specification
```

### Dependencies

- Anchor 0.32.1
- Solana SDK 2.2
- Mollusk SVM 0.5.1 (testing)
- @solana/kit ^5.0.0 (SDK)

### Building

```bash
# Build program
anchor build

# Build SDK
pnpm build
```

## Documentation

- [Full Specification](docs/specification.md) - Detailed protocol documentation
- [SDK Documentation](packages/sdk/README.md) - TypeScript SDK reference
- [Error Codes](docs/specification.md#error-codes) - All error codes and descriptions
- [Events](docs/specification.md#events) - Event definitions for indexing

## Security

### Implemented Protections

- Non-custodial (PDA-owned vaults)
- Overflow/underflow checks (all math uses `checked_*`)
- Duplicate recipient validation
- Bounded account size (max 20 recipients)
- Protocol fee enforcement (cannot be bypassed)
- ATA validation on creation

### Audits

*Coming soon*

## License

Apache License 2.0 - see [LICENSE](LICENSE) file.

## Links

- **GitHub:** https://github.com/cascade-protocol/splits
- **SDK:** [@cascade-fyi/splits-sdk](https://www.npmjs.com/package/@cascade-fyi/splits-sdk)
- **Verification:** [OtterSec](https://verify.osec.io/status/SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB)
- **Contact:** hello@cascade.fyi

---

Built by [Cascade Labs](https://cascade.fyi)
