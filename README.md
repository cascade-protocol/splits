# Cascade Splits

Non-custodial payment splitting protocol for Solana. Automatically distribute incoming payments to multiple recipients based on pre-configured percentages.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-green.svg)](https://solana.com)

**Program ID:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Overview

Cascade Splits enables trustless payment distribution on Solana:

- **Non-custodial**: Funds held in PDA-owned vaults, no private keys
- **Automatic**: Split funds instantly on execution
- **Permissionless**: Anyone can trigger distributions
- **Self-healing**: Missing recipient ATAs handled gracefully with automatic recovery

### How It Works

```
Payment → Vault (PDA) → execute_split() → Recipients (99%) + Protocol (1%)
```

1. Authority creates a split config with recipients and percentages
2. Protocol creates a vault (ATA owned by PDA) to receive payments
3. Payments sent to vault
4. Anyone calls `execute_split()` to distribute funds

## Features

- **1-20 recipients** per split configuration
- **99% to recipients**, 1% protocol fee (transparent, on-chain enforced)
- **SPL Token & Token-2022** support
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
| SplitConfig | 1,792 bytes | 0.0134 SOL |
| Vault ATA | 165 bytes | 0.0020 SOL |
| **Total** | | **~0.0154 SOL** |

At $150/SOL ≈ $2.31 (refunded on `close_split_config`)

### Compute Units

| Instruction | CUs | Notes |
|------------|-----|-------|
| execute_split (1 recipient) | 27,777 | Best case |
| execute_split (5 recipients) | 66,677 | Typical case |
| execute_split (20 recipients) | 205,427 | Worst case (MAX) |
| create_split_config | 36,460 | Includes vault ATA creation |
| update_split_config | 7,446 | |
| close_split_config | 4,904 | |
| initialize_protocol | 8,998 | One-time setup |

Scaling: ~9K CU per recipient (6K Token CPI + 3K overhead). Even worst case uses only 15% of Solana's 1.4M CU budget.

For comparison: typical DEX swaps use 100,000-400,000+ CUs.

See [benchmarks/compute_units.md](benchmarks/compute_units.md) for full benchmark history and additional scenarios (unclaimed flows, protocol admin ops).

## Usage Example

### Create Split Config

```typescript
import { createSplitConfig } from '@cascade-labs/splits';

const uniqueId = Keypair.generate().publicKey;

const { splitConfigPDA, vault } = await createSplitConfig({
  authority: wallet,
  mint: USDC_MINT,
  uniqueId,
  recipients: [
    { address: platform, percentageBps: 900 },   // 9%
    { address: merchant, percentageBps: 9000 },  // 90%
  ],
});

// Share `vault` address to receive payments
```

### Execute Split

```typescript
import { executeSplit } from '@cascade-labs/splits';

// Anyone can call this - permissionless
await executeSplit({
  splitConfig: splitConfigPDA,
  recipientAtas: [platformAta, merchantAta],
  protocolAta,
});
```

### Distribution Example

For a 100 USDC payment with config `[9%, 90%]`:

```
Platform (9%):  9.00 USDC
Merchant (90%): 90.00 USDC
Protocol (1%):  1.00 USDC
```

## Architecture

### Account Structure

**ProtocolConfig** (global singleton)
- Authority and fee wallet configuration
- Seeds: `[b"protocol_config"]`

**SplitConfig** (per-split)
- Recipients, percentages, vault address
- Seeds: `[b"split_config", authority, mint, unique_id]`
- Zero-copy for optimal compute (~1,787 bytes fixed)

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

Payment facilitators can detect split vaults and bundle payment + execution atomically:

```typescript
const tx = new Transaction()
  .add(transferInstruction(vault, amount))
  .add(executeSplitInstruction(splitConfigPDA));
```

See [specification](docs/specification.md) for detection logic.

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
├── sdk/                     # TypeScript SDK
└── docs/
    └── specification.md     # Full specification
```

### Dependencies

- Anchor 0.32.1
- Solana SDK 2.2
- Mollusk SVM 0.5.1 (testing)

### Building

```bash
# Build program
anchor build

# Build SDK
pnpm build
```

## Documentation

- [Full Specification](docs/specification.md) - Detailed protocol documentation
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
- **SDK:** `@cascade-labs/splits`
- **Contact:** hello@cascade-protocol.xyz

---

Built by [Cascade Labs](https://cascade-protocol.xyz)
