# Cascade Splits EVM Contracts

EVM implementation of Cascade Splits - a non-custodial payment splitting protocol for EVM chains.

## Overview

Cascade Splits automatically distributes incoming payments to multiple recipients based on pre-configured percentages. Built for high-throughput micropayments with minimal gas costs.

**Target:** Base (EVM-compatible L2)
**Pattern:** Clone Factory (EIP-1167) with immutable args

See the [full specification](../docs/specification-evm.md) for detailed documentation.

## Quick Start

```bash
# Build
forge build

# Test
forge test

# Lint
forge lint

# Format
forge fmt

# Local E2E validation (requires Anvil running)
anvil &
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/LocalValidation.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

## Project Structure

```
contracts/
├── src/
│   ├── interfaces/
│   │   └── ISplitFactory.sol    # Factory interface
│   ├── Errors.sol               # Custom errors
│   ├── Types.sol                # Shared types (Recipient)
│   ├── SplitFactory.sol         # Factory contract
│   └── SplitConfigImpl.sol      # Split implementation
├── test/
│   ├── Base.t.sol               # Shared test harness
│   ├── SplitFactory.t.sol       # Factory tests
│   ├── SplitConfigImpl.t.sol    # Split tests
│   └── Fork.t.sol               # Fork tests (Base Sepolia)
├── script/
│   ├── Deploy.s.sol             # Production deployment
│   └── LocalValidation.s.sol    # Local E2E validation
└── lib/
    ├── forge-std/               # Foundry testing library
    └── solady/                  # LibClone + utilities
```

## Key Features

- **EIP-1167 Clones**: ~83k gas deployment with immutable args
- **Self-Healing**: Failed transfers stored as unclaimed, auto-retried
- **Transient Storage**: EIP-1153 reentrancy guard (~200 gas vs ~5000)
- **Deterministic Addresses**: CREATE2 for predictable deployment

## Dependencies

- [Solady](https://github.com/Vectorized/solady) - LibClone for minimal proxies with immutable args

## Configuration

See `foundry.toml` for compiler settings. Key configurations:

- Solidity 0.8.30
- EVM version: Prague (Base L2 compatible via Pectra upgrade)
- Optimizer: 1,000,000 runs (optimized for runtime)

## Deployment

```bash
# Testnet (Base Sepolia)
forge script script/Deploy.s.sol:DeployTestnet \
  --rpc-url base_sepolia \
  --broadcast \
  --verify

# Mainnet (Base)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url base \
  --broadcast \
  --verify
```

## License

Apache-2.0
