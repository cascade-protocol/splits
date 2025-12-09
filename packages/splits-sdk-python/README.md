# @cascade-fyi/splits-sdk-python

Python SDK for [Cascade Splits](https://github.com/cascade-protocol/splits) on EVM chains (Base).

Split incoming payments to multiple recipients automatically. Built for high-throughput micropayments.

**Factory Address:** `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` (Base Mainnet & Sepolia)

## Installation

```bash
pip install cascade-splits
```

**Requirements:**
- Python 3.9+
- `web3` >= 6.0.0

## Quick Start

### Create a Split

```python
from cascade_splits import CascadeSplitsClient, Recipient
import secrets

# Initialize client (Base mainnet)
client = CascadeSplitsClient(
    rpc_url="https://mainnet.base.org",
    private_key="0x...",
    chain_id=8453  # Base mainnet
)

# Generate a unique ID
unique_id = secrets.token_bytes(32)

# Create a split with 2 recipients
result = client.ensure_split(
    unique_id=unique_id,
    recipients=[
        Recipient(address="0xAlice...", share=60),
        Recipient(address="0xBob...", share=40),
    ]
)

# Handle all possible outcomes
if result.status == "CREATED":
    print(f"Split created at {result.split}")
    print(f"Transaction: {result.signature}")
elif result.status == "NO_CHANGE":
    print(f"Already exists at {result.split}")
elif result.status == "FAILED":
    print(f"Failed: {result.message}")
```

### Execute a Split

```python
# Anyone can call this to distribute funds
result = client.execute_split(
    split_address="0xSplitAddress...",
    min_balance=1_000_000  # 1 USDC (6 decimals)
)

if result.status == "EXECUTED":
    print(f"Distributed! Tx: {result.signature}")
elif result.status == "SKIPPED":
    print(f"Skipped: {result.reason}")
elif result.status == "FAILED":
    print(f"Failed: {result.message}")
```

### Check if Address is a Split

```python
if client.is_cascade_split("0xSomeAddress..."):
    print("This is a valid Cascade split!")
```

## Key Concepts

### 100-Share Model

Recipients specify shares from 1-100 that must total exactly 100. Protocol takes 1% fee during distribution.

```python
Recipient(address="0xAlice...", share=60)  # 60% of 99% = 59.4%
Recipient(address="0xBob...", share=40)    # 40% of 99% = 39.6%
# Protocol receives 1%
```

### Discriminated Union Results

All operations return typed results with `status` discriminant:

```python
# ensure_split results
result.status == "CREATED"    # result.split, result.signature
result.status == "NO_CHANGE"  # result.split (already exists)
result.status == "FAILED"     # result.reason, result.message

# execute_split results
result.status == "EXECUTED"   # result.signature
result.status == "SKIPPED"    # result.reason
result.status == "FAILED"     # result.reason, result.message
```

**Failed reasons:** `wallet_rejected`, `wallet_disconnected`, `network_error`, `transaction_failed`, `transaction_reverted`, `insufficient_gas`

**Skipped reasons:** `not_found`, `not_a_split`, `below_threshold`, `no_pending_funds`

### Immutable Splits

EVM splits are **immutable** — recipients cannot be changed after creation. Create a new split with a different `unique_id` if you need different recipients.

## API Reference

### CascadeSplitsClient

```python
from cascade_splits import CascadeSplitsClient

client = CascadeSplitsClient(
    rpc_url="https://mainnet.base.org",
    private_key="0x...",
    chain_id=8453,  # Optional, default: 8453 (Base mainnet)
    factory_address=None,  # Optional, uses default
)

# Properties
client.address          # Wallet address
client.chain_id         # Connected chain ID
client.factory_address  # Factory contract address

# Methods
result = client.ensure_split(unique_id, recipients, authority=None, token=None)
result = client.execute_split(split_address, min_balance=None)
config = client.get_split_config(split_address)
balance = client.get_split_balance(split_address)
is_split = client.is_cascade_split(address)
preview = client.preview_execution(split_address)
predicted = client.predict_split_address(unique_id, recipients, authority, token)
```

### Helper Functions

```python
from cascade_splits import (
    to_evm_recipient,
    to_evm_recipients,
    is_cascade_split,
    get_split_balance,
    get_split_config,
    has_pending_funds,
    preview_execution,
)

# Convert share (1-100) to basis points
recipient = to_evm_recipient(Recipient("0x...", share=50))
# EvmRecipient(addr="0x...", percentage_bps=4950)

# Check if address is a split
is_split = is_cascade_split(w3, address)

# Get split balance
balance = get_split_balance(w3, split_address)
```

### Address Utilities

```python
from cascade_splits import (
    get_split_factory_address,
    get_usdc_address,
    is_supported_chain,
    SPLIT_FACTORY_ADDRESSES,
    USDC_ADDRESSES,
    SUPPORTED_CHAIN_IDS,
)

factory = get_split_factory_address(8453)  # Base mainnet
usdc = get_usdc_address(8453)
supported = is_supported_chain(8453)  # True
```

## Types

```python
from cascade_splits import (
    Recipient,          # Input recipient with share (1-100)
    EvmRecipient,       # On-chain format with basis points
    EnsureResult,       # Result of ensure_split
    ExecuteResult,      # Result of execute_split
    ExecutionPreview,   # Preview of execution
    SplitConfig,        # Split configuration
)
```

## Supported Chains

| Chain | Chain ID | Factory | USDC |
|-------|----------|---------|------|
| Base Mainnet | 8453 | `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## ubounty.ai Integration

This SDK is designed for easy integration with payment platforms:

```python
from cascade_splits import CascadeSplitsClient, Recipient
import secrets

# Initialize client
client = CascadeSplitsClient(
    rpc_url="https://mainnet.base.org",
    private_key=os.environ["PRIVATE_KEY"],
)

# Create a split for bounty distribution
result = client.ensure_split(
    unique_id=f"bounty-{issue_id}".encode().ljust(32, b'\x00'),
    recipients=[
        Recipient(address=developer_wallet, share=90),
        Recipient(address=platform_wallet, share=10),
    ]
)

# After PR is merged, execute the split
exec_result = client.execute_split(result.split)
```

## Resources

- **Specification:** [docs/specification-evm.md](https://github.com/cascade-protocol/splits/blob/main/docs/specification-evm.md)
- **TypeScript SDK:** [@cascade-fyi/splits-sdk-evm](https://www.npmjs.com/package/@cascade-fyi/splits-sdk-evm)
- **Issues:** [GitHub Issues](https://github.com/cascade-protocol/splits/issues)
- **Contact:** hello@cascade.fyi

## License

Apache-2.0
