# [DRAFT] Cascade Splits EVM Specification

**Version:** 1.0
**Target:** Base (EVM-compatible L2)
**Pattern:** Clone Factory (EIP-1167)

---

## Overview

Cascade Splits EVM is a non-custodial payment splitting protocol for EVM chains that automatically distributes incoming payments to multiple recipients based on pre-configured percentages.

**Design Goals:**
- High-throughput micropayments (API calls, streaming payments)
- Minimal gas cost per execution
- Simple, idempotent interface for facilitators
- Permissionless operation
- Cross-chain parity with Solana implementation

**Key Features:**
- Accept payments to a single split address
- Automatically split funds to 1-20 recipients
- Mandatory 1% protocol fee (transparent, on-chain enforced)
- ERC20 token support (USDC on Base)
- Idempotent execution with self-healing unclaimed recovery
- Multiple configs per authority/token via unique identifiers
- Integration with x402 payment facilitators

---

## How It Works

### 1. Setup

Authority creates a **split config** via the factory defining:
- Token address (USDC, etc.)
- Recipients and their percentages (must total 99%)
- Unique identifier (enables multiple configs per authority/token)

The factory deploys a minimal proxy clone with a deterministic address.

### 2. Payment Flow

```
Payment → SplitConfig → executeSplit() → Recipients (99%) + Protocol (1%)
```

**Without Facilitator:**
1. Payment sent to split address
2. Anyone calls `executeSplit()`
3. Funds distributed

**With x402 Facilitator:**
1. Facilitator sends payment via EIP-3009 `transferWithAuthorization`
2. Anyone calls `executeSplit()` to distribute
3. Recipients receive their shares

### 3. Idempotent Execution

`executeSplit` is designed to be idempotent and self-healing:
- Multiple calls on the same state produce the same result
- Only new funds (balance minus unclaimed) are split
- Previously unclaimed amounts are automatically delivered when transfers succeed
- Facilitators can safely retry without risk of double-distribution

---

## Core Concepts

### EIP-1167 Clone Pattern

- SplitConfig contracts are minimal proxy clones (~45 bytes)
- Single implementation contract, many lightweight clones
- ~60k gas deployment (vs ~500k for full contract)
- Deterministic addresses via CREATE2

### Self-Healing Unclaimed Recovery

If a recipient transfer fails during execution:
1. Their share is recorded as "unclaimed" and stays in contract
2. Unclaimed funds are protected from re-splitting
3. On subsequent `executeSplit` calls, system auto-retries failed transfers
4. Once transfer succeeds, funds are delivered
5. No separate claim instruction needed

### Protocol Fee

- **Fixed 1%** enforced by contract (transparent, cannot be bypassed)
- Recipients control the remaining 99%
- Example: `[90%, 9%]` = 99% total ✓
- Invalid: `[90%, 10%]` = 100% total ✗

### Naming Parity

All function names aligned with Solana implementation (camelCase for EVM):

| Solana (snake_case) | EVM (camelCase) |
|---------------------|-----------------|
| `create_split_config` | `createSplitConfig` |
| `execute_split` | `executeSplit` |
| `update_split_config` | `updateSplitConfig` |

**One exception:** `mint` → `token` (avoids EVM terminology collision where "mint" means creating tokens)

---

## Contract Structure

### SplitFactory

Global factory for deploying and tracking splits.

```solidity
contract SplitFactory {
    address public immutable implementation;
    address public feeWallet;
    address public authority;
    address public pendingAuthority;

    mapping(bytes32 => address) public splits;
    uint256 public totalSplits;
}
```

### SplitConfig

Per-split configuration deployed as EIP-1167 clone.

```solidity
contract SplitConfig {
    address public factory;
    address public authority;
    address public token;
    bytes32 public uniqueId;

    Recipient[] internal _recipients;
    mapping(address => uint256) public unclaimedAmounts;
    uint256 public protocolUnclaimed;
}

struct Recipient {
    address recipient;
    uint16 percentageBps;  // 1-9900 (0.01%-99%)
}
```

---

## Instructions

### Factory Instructions

| Instruction | Description | Authorization |
|-------------|-------------|---------------|
| `createSplitConfig` | Deploy new split clone | Anyone |
| `updateProtocolConfig` | Update fee wallet | Protocol authority |
| `transferProtocolAuthority` | Propose authority transfer | Protocol authority |
| `acceptProtocolAuthority` | Accept authority transfer | Pending authority |

### Split Instructions

| Instruction | Description | Authorization |
|-------------|-------------|---------------|
| `executeSplit` | Distribute balance to recipients | Permissionless |
| `updateSplitConfig` | Change recipients (split must be empty) | Split authority |

---

## x402 Integration

Cascade Splits integrates with the [x402 protocol](https://github.com/coinbase/x402) for internet-native payments. When a resource server sets `payTo` to a split address, funds land via EIP-3009 and can be distributed via `executeSplit`.

See: [x402 Specification](https://github.com/coinbase/x402/blob/main/specs/x402-specification.md) | [EVM Scheme](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)

### Payment Flow

```
x402 Payment (EIP-3009):
  Client signs transferWithAuthorization (to: split address)
  → Facilitator submits to token contract
  → Funds land in split

Async Distribution:
  Keeper/Anyone calls executeSplit()
  → Recipients receive their shares
  → Protocol receives 1% fee
```

### Detection

```solidity
// Check if payTo is a Cascade Split
if (SplitConfig(payTo).isCascadeSplitConfig()) {
    address token = SplitConfig(payTo).token();
    bool hasPending = SplitConfig(payTo).hasPendingFunds();
    SplitConfig(payTo).executeSplit();
}
```

### Keeper Pattern

```typescript
// Minimal keeper for async settlement
async function executeAllPending(splits: Address[]) {
  for (const split of splits) {
    if (await splitConfig.hasPendingFunds()) {
      await splitConfig.executeSplit();
    }
  }
}
```

### Token Compatibility

| Token | EIP-3009 | x402 Compatible |
|-------|----------|-----------------|
| USDC (Base) | ✓ | ✓ |
| USDT | ✗ | ✗ |
| DAI | ✗ (EIP-2612) | ✗ |

---

## Production Considerations

### ERC20 Token Edge Cases

**Fee-on-Transfer Tokens (PAXG, STA):**
Current code assumes transfer amount = received amount. Document exclusion or add balance tracking.

**Rebasing Tokens (stETH, OHM, AMPL):**
Balance changes without transfers. Unclaimed accounting breaks. **Explicitly exclude.**

**Blocklist/Pausable Tokens (USDC, USDT):**
Circle/Tether can freeze addresses. Self-healing handles gracefully, but funds may be stuck permanently if recipient is blocklisted.

### Gas Griefing

Malicious recipient contracts could consume gas:
```solidity
receive() external payable {
    while(true) {} // Consume all gas
}
```

**Mitigation:** `_safeTransfer` catches reverts. Consider gas caps per transfer.

### Clone Initialization Front-Running

Salt includes `authority`, so attacker cannot front-run with different recipients while using same predicted address.

### Unclaimed Array Growth

If many transfers fail, iteration cost grows. Current implementation handles via mapping + array pattern.

### Multi-Chain Determinism

CREATE2 address depends on factory address. Deploy factory via deterministic deployer (like 0age's) for same addresses across chains.

---

## Events

| Event | Description |
|-------|-------------|
| `ProtocolConfigCreated` | Factory deployed |
| `ProtocolConfigUpdated` | Fee wallet changed |
| `ProtocolAuthorityTransferProposed` | Authority transfer initiated |
| `ProtocolAuthorityTransferAccepted` | Authority transfer completed |
| `SplitConfigCreated` | New split deployed |
| `SplitExecuted` | Funds distributed |
| `SplitConfigUpdated` | Recipients changed |

---

## Error Codes

| Error | Description |
|-------|-------------|
| `InvalidRecipientCount` | Recipients not in 1-20 range |
| `InvalidSplitTotal` | Percentages don't sum to 9900 bps |
| `DuplicateRecipient` | Same address appears twice |
| `ZeroAddress` | Recipient address is zero |
| `ZeroPercentage` | Recipient percentage is zero |
| `SplitNotEmpty` | Split must be empty for update |
| `UnclaimedNotEmpty` | Unclaimed must be cleared first |
| `Unauthorized` | Signer not authorized |
| `SplitAlreadyExists` | Split with same params already deployed |

---

## Security

### Implemented Protections

- ReentrancyGuard on state-changing functions
- SafeERC20 for token transfers
- Overflow protection (Solidity 0.8+)
- Two-step protocol authority transfer
- Duplicate recipient validation
- Bounded recipient count (max 20)
- Self-healing unclaimed pattern

### Not Implemented (by design)

- Pausability (immutable contracts)
- Upgrades (trust-minimized)
- Time locks (unnecessary for this use case)
- Close/reclaim (no rent on EVM)

---

## SDK Usage

```typescript
import { CascadeSplits } from "@cascade-fyi/splits-sdk/evm";

const sdk = new CascadeSplits({ rpcUrl: "https://mainnet.base.org" });

// Create split config
const { splitConfig, tx } = await sdk.buildCreateSplitConfig(authority, {
  token: USDC_BASE,
  recipients: [
    { recipient: platform, percentageBps: 900 },   // 9%
    { recipient: merchant, percentageBps: 9000 },  // 90%
  ],
});

// Execute split
const { transaction } = await sdk.buildExecuteSplit(splitConfig);

// Detect split
const isSplit = await sdk.detectSplitConfig(address);
```

---

## Deployment

### Contract Addresses

| Network | Contract | Address |
|---------|----------|---------|
| Base Mainnet | SplitFactory | TBD |
| Base Sepolia | SplitFactory | TBD |

### Deployment Steps

```bash
# 1. Deploy factory (sets deployer as protocol authority)
forge create SplitFactory --constructor-args $FEE_WALLET

# 2. Verify
forge verify-contract $FACTORY_ADDRESS SplitFactory
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Hardcoded 1% fee** | Transparency. Anyone can verify on-chain. Avoids calculation complexity. |
| **Empty split for updates** | Ensures funds split according to rules active when received. |
| **`token` not `mint`** | "Mint" means creating tokens in EVM. Avoid confusion. |
| **No close instruction** | EVM has no rent. Contracts persist forever. No reclaim needed. |
| **Self-healing over claim** | Single idempotent interface. Recipients auto-receive on retry. |
| **Clone pattern** | ~60k gas deploy vs ~500k. Critical for high-throughput. |
| **No split authority transfer** | Unnecessary complexity. Authority can update recipients to hand off control. |
| **Two-step protocol authority** | Higher stakes. Prevent accidental irreversible transfers. |

---

## Constants

```solidity
uint16 public constant PROTOCOL_FEE_BPS = 100;        // 1%
uint16 public constant REQUIRED_SPLIT_TOTAL = 9900;   // 99%
uint8 public constant MIN_RECIPIENTS = 1;
uint8 public constant MAX_RECIPIENTS = 20;
```

---

## Resources

- [Solana Specification](./specification.md)
- [EIP-1167: Minimal Proxy Contract](https://eips.ethereum.org/EIPS/eip-1167)
- [x402 Protocol](https://github.com/coinbase/x402)
- [Base Documentation](https://docs.base.org/)

---

**Last Updated:** 2025-11-26
