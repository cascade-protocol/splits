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

### EIP-1167 Clone Pattern with Immutable Args

- SplitConfig contracts are minimal proxy clones with appended data (~45 bytes + immutable args)
- Single implementation contract, many lightweight clones
- ~83k gas deployment with immutable args (vs ~290k baseline, vs ~500k full contract)
- Deterministic addresses via CREATE2 (salt includes authority, token, uniqueId)
- Recipients and configuration encoded in clone bytecode—no storage initialization needed
- No initializer function—all data read from bytecode via CODECOPY

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

### Execution Behavior

**Zero-balance execution:** Calling `executeSplit()` with no new funds is a no-op for distribution but still attempts to clear any pending unclaimed amounts. No revert, emits event with zero amounts.

**Rounding:** Recipient shares use floor division. Dust (remainder from rounding) goes to protocol fee. Example with 100 tokens and 3 recipients at 33% each:
- Recipients: 33 + 33 + 33 = 99 tokens
- Protocol: 1 token (fee) + 0 tokens (dust in this case)

**Note:** With very small distributions or low-decimal tokens, small-percentage recipients may receive 0 due to floor division. This is expected behavior.

### Naming Parity

All function names aligned with Solana implementation (camelCase for EVM):

| Solana (snake_case) | EVM (camelCase) | Notes |
|---------------------|-----------------|-------|
| `create_split_config` | `createSplitConfig` | |
| `execute_split` | `executeSplit` | |
| `update_split_config` | — | EVM splits are immutable (gas optimization) |

**Terminology adaptations:**
- `mint` → `token` (EVM: "mint" means creating tokens)
- `authority` retained (EVM equivalent: "owner"). Kept for cross-chain consistency.

**Divergence from Solana:** EVM implementation does not support `updateSplitConfig` due to architectural optimization (immutable args pattern). This is justified by different cost models—EVM storage reads are expensive, Solana account reads are cheap.

---

## Regulated Token & Smart Wallet Support

Cascade Splits is designed for the x402 ecosystem where **transfer failures are a normal operating condition**, not an edge case.

### Why Transfers Fail

| Scenario | Cause | Frequency |
|----------|-------|-----------|
| **Smart Wallet Recipients** | EIP-4337/6492 wallets may not be deployed yet | Growing (x402 direction) |
| **Blocklisted Addresses** | Circle/Tether compliance (USDC, USDT) | Occasional |
| **Allowlist Tokens** | Future KYC-enabled tokens reject non-approved recipients | Coming |
| **Paused Tokens** | Token operations temporarily suspended | Rare |

### Self-Healing as Infrastructure

Traditional splits revert when any transfer fails—one bad recipient blocks all distributions. Cascade Splits treats failed transfers as **recoverable state**:

```
Payment arrives → executeSplit() called
  ├─ Recipient A: ✓ Transfer succeeds → funds delivered
  ├─ Recipient B: ✗ Transfer fails → stored as unclaimed
  └─ Protocol: ✓ Transfer succeeds → fee delivered

Later: executeSplit() called again
  └─ Recipient B: ✓ Transfer succeeds → unclaimed cleared
```

**Key behaviors:**
- Failed transfers don't revert the transaction
- Unclaimed funds are protected from re-splitting (balance accounting)
- Every `executeSplit()` retries all pending unclaimed amounts
- No separate claim function needed—recipients receive automatically when conditions clear

### Smart Wallet Recipients (EIP-4337/6492)

x402 is moving toward smart wallet support ([Issue #639](https://github.com/coinbase/x402/issues/639), [Issue #646](https://github.com/coinbase/x402/issues/646)). Smart wallets present a unique challenge:

- **Counterfactual addresses**: Wallet address is known before deployment
- **EIP-3009 limitation**: `transferWithAuthorization` may fail if wallet has no code
- **Coinbase Smart Wallet**: Users already encountering failures ([Issue #623](https://github.com/coinbase/x402/issues/623))

Self-healing handles this gracefully:
1. Payment lands in split (works—split is deployed)
2. `executeSplit()` attempts transfer to smart wallet
3. Transfer fails (no code at address)
4. Amount stored as unclaimed
5. User deploys their smart wallet
6. Next `executeSplit()` succeeds—funds delivered

### Permanent Blocklist Behavior

If a recipient is **permanently** blocklisted (e.g., OFAC sanctions):

- Funds remain in the split contract forever
- No backdoor to redirect funds (by design)
- Funds belong to the recipient, not the authority
- Authority cannot reclaim or reassign

This is intentional. The alternative—allowing authority to redirect funds—creates a trust assumption that contradicts the permissionless design.

### Monitoring Transfer Failures

The `SplitExecuted` event includes transfer status for each recipient. Integrators should monitor for:
- Repeated failures to the same address (potential blocklist)
- Smart wallet addresses with no code (prompt user to deploy)

---

## Contract Structure

### SplitFactory

Global factory for deploying splits. No on-chain registry—discovery via events.

```solidity
contract SplitFactory {
    address public immutable implementation;
    address public feeWallet;
    address public authority;
    address public pendingAuthority;
}
```

**No registry mapping:** Split addresses are deterministic via CREATE2. Discovery uses `SplitConfigCreated` events indexed by subgraphs. On-chain verification recomputes CREATE2 address from known parameters.

### SplitConfig

Per-split configuration deployed as EIP-1167 clone with immutable args.

```solidity
contract SplitConfig {
    // === IMMUTABLE (encoded in clone bytecode via clones-with-immutable-args) ===
    // address public factory;      // Read via _getArgAddress(0)
    // address public authority;    // Read via _getArgAddress(20)
    // address public token;        // Read via _getArgAddress(40)
    // bytes32 public uniqueId;     // Read via _getArgBytes32(60)
    // Recipient[] recipients;      // Read via _getArgRecipients(92)

    // === STORAGE (only for unclaimed tracking) ===
    uint256 private _unclaimedBitmap;              // Bits 0-19: recipients, bit 20: protocol
    mapping(uint256 => uint256) private _unclaimedByIndex;  // index => amount
}

struct Recipient {
    address addr;
    uint16 percentageBps;  // 1-9900 (0.01%-99%)
}
```

**Immutable args pattern:** Recipients and configuration are encoded in the clone's bytecode, not storage. Reading from bytecode (~3 gas/word via CODECOPY) is 700x cheaper than storage (~2,100 gas cold SLOAD). Trade-off: splits are immutable—deploy new split to change recipients.

**Lazy unclaimed tracking:**
- `_unclaimedBitmap`: Single slot, bits indicate which indices have unclaimed
- `_unclaimedByIndex`: Only written when transfer fails (lazy)
- Maximum 21 bits used (20 recipients + 1 protocol)
- Happy path: 1 SLOAD to check bitmap, skip if zero

### Invariants

The following properties must always hold:

| Invariant | Description |
|-----------|-------------|
| `popcount(_unclaimedBitmap) <= 21` | Max 20 recipients + 1 protocol with unclaimed |
| `balance >= totalUnclaimed()` | Contract holds at least enough for all unclaimed |
| `sum(percentageBps) == 9900` | Recipients always total 99% (immutable in bytecode) |
| `recipientCount >= 1 && <= 20` | Always 1-20 recipients (immutable in bytecode) |
| `_unclaimedBitmap & (1 << i) != 0 ⟺ _unclaimedByIndex[i] > 0` | Bitmap and mapping stay synchronized |

Where `totalUnclaimed() = sum(_unclaimedByIndex[i] for all set bits)`.

**Gas bounds:** Maximum iteration in `executeSplit()` is 41 transfers (20 recipients + 1 protocol for new split, plus 21 unclaimed retries). Bitmap check short-circuits when no unclaimed exists.

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

**No `updateSplitConfig`:** Splits are immutable by design. To change recipients, deploy a new split and update your `payTo` address. This provides trustless verification—payers can verify recipients on-chain before paying, and authority cannot change recipients after payment.

### View Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `getRecipients()` | `Recipient[]` | All configured recipients |
| `getRecipientCount()` | `uint256` | Number of recipients |
| `hasPendingFunds()` | `bool` | True if balance > unclaimed |
| `pendingAmount()` | `uint256` | Amount available for next execution |
| `previewExecution()` | `(uint256[], uint256, uint256)` | Preview distribution (recipient amounts, protocol fee, available) |
| `getBalance()` | `uint256` | Total token balance held |
| `isCascadeSplitConfig()` | `bool` | Always returns true (for detection) |

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

**Quick check (weak):** Any contract can implement `isCascadeSplitConfig()`, so this is not authoritative:

```solidity
// Quick detection - may have false positives
if (SplitConfig(payTo).isCascadeSplitConfig()) {
    SplitConfig(payTo).executeSplit();
}
```

**Verified check (strong):** Recompute CREATE2 address from immutable args:

```solidity
// Verified detection - authoritative
address factory = SplitConfig(payTo).factory();
if (factory == KNOWN_CASCADE_FACTORY) {
    // Get immutable args from the split itself
    address authority = SplitConfig(payTo).authority();
    address token = SplitConfig(payTo).token();
    bytes32 uniqueId = SplitConfig(payTo).uniqueId();
    Recipient[] memory recipients = SplitConfig(payTo).getRecipients();

    // Recompute CREATE2 address
    bytes memory data = abi.encodePacked(factory, authority, token, uniqueId, recipients);
    bytes32 salt = keccak256(abi.encode(authority, token, uniqueId));
    address computed = LibClone.predictDeterministicAddress(
        ISplitFactory(factory).implementation(),
        data,
        salt,
        factory
    );

    if (computed == payTo) {
        // Confirmed Cascade Split
        SplitConfig(payTo).executeSplit();
    }
}
```

For most integrations, the quick check is sufficient since calling `executeSplit()` on a non-Cascade contract will simply revert.

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

### Smart Wallet Recipients

x402 is actively developing smart wallet support ([EIP-4337](https://github.com/coinbase/x402/issues/639), [EIP-6492](https://github.com/coinbase/x402/pull/675)). Split recipients may be:

| Wallet Type | Challenge | Cascade Handling |
|-------------|-----------|------------------|
| **Coinbase Smart Wallet** | May not be deployed when split created | Self-healing retries until deployed |
| **EIP-4337 Account** | UserOp execution timing varies | Self-healing bridges timing gaps |
| **Counterfactual Wallets** | Address known before code exists | Self-healing stores until ready |

**Integration pattern for facilitators:**

```typescript
// After settling x402 payment to split
const split = SplitConfig.at(payTo);

// Execute immediately - handles smart wallet failures gracefully
await split.executeSplit();

// If TransferFailed events emitted, schedule retry
// (or rely on keeper to call executeSplit later)
```

### x402 v2 Compatibility

Cascade Splits aligns with x402 v2's modular architecture:

- **@x402/evm mechanism**: Splits work with existing EIP-3009 settlement
- **Delegated billing** ([Issue #694](https://github.com/coinbase/x402/issues/694)): Complementary—billing → splits → recipients
- **Future mechanisms**: Same `payTo` → split pattern works regardless of settlement mechanism

---

## Production Considerations

### ERC20 Token Edge Cases

**Fee-on-Transfer Tokens (PAXG, STA):**
Supported. Recipients receive their proportional share minus transfer fees at each hop. The split percentages remain accurate relative to each other. No code changes required.

**Rebasing Tokens (stETH, OHM, AMPL):**
Balance changes without transfers. Unclaimed accounting breaks. **Explicitly exclude.**

**Blocklist/Pausable Tokens (USDC, USDT):**
Circle/Tether can freeze addresses. Self-healing handles gracefully, but funds may be stuck permanently if recipient is blocklisted.

### Gas Griefing

**Standard ERC20:** Not vulnerable. Token `transfer()` only updates balances in the token contract - no code executes on the recipient address.

**Tokens with hooks (ERC777, custom):** If supported in future, recipient contracts could consume gas via `tokensReceived` hooks. Mitigation: gas caps per transfer or explicitly exclude hook-enabled tokens.

**Current scope (USDC):** USDC is standard ERC20 without hooks. No gas griefing vector.

### Deterministic Address Derivation

Split addresses are deterministic via CREATE2:

```solidity
salt = keccak256(abi.encode(authority, token, uniqueId))
address = predictDeterministicAddress(implementation, salt, factory)
```

Integrators can compute addresses off-chain before deployment.

### L2 Compatibility

**No time-based logic:** This contract has no vesting, time locks, or block-based conditions—execution is purely balance-driven. This avoids incompatibilities with L2s where `block.number` behaves differently (e.g., Polygon zkEVM uses transaction count).

**zkSync Era:** Uses a different CREATE2 formula—split addresses will differ from other EVM chains. This is expected behavior (same pattern as Safe, 0xSplits).

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
| `SplitConfigCreated` | New split deployed (includes full recipient list for indexing) |
| `SplitExecuted` | Funds distributed (includes per-recipient status) |
| `TransferFailed` | Individual transfer failed (recipient stored as unclaimed) |

### SplitExecuted Details

```solidity
event SplitExecuted(
    uint256 totalAmount,           // Total distributed this execution
    uint256 protocolFee,           // Protocol's 1% share
    uint256 unclaimedCleared,      // Previously unclaimed now delivered
    uint256 newUnclaimed           // New transfers that failed
);
```

### TransferFailed Details

Emitted for each failed transfer during execution:

```solidity
event TransferFailed(
    address indexed recipient,
    uint256 amount,
    bool isProtocol                // True if protocol fee transfer failed
);
```

**Monitoring use cases:**
- Detect blocklisted recipients (repeated failures)
- Identify undeployed smart wallets (prompt user action)
- Track compliance issues with regulated tokens

---

## Error Codes

| Error | Description |
|-------|-------------|
| `InvalidRecipientCount` | Recipients not in 1-20 range |
| `InvalidSplitTotal` | Percentages don't sum to 9900 bps |
| `DuplicateRecipient` | Same address appears twice |
| `ZeroAddress` | Recipient address is zero |
| `ZeroPercentage` | Recipient percentage is zero |
| `Unauthorized` | Signer not authorized |
| `SplitAlreadyExists` | Split with same params already deployed |
| `Reentrancy` | Reentrant call detected |

---

## Security

### Implemented Protections

- ReentrancyGuard on state-changing functions (transient storage)
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

## Gas Optimization

Optimized for high-throughput micropayments where `executeSplit` is called frequently.

### Architectural Optimizations

| Optimization | Creation Impact | Execution Impact | Trade-off |
|--------------|-----------------|------------------|-----------|
| **Immutable args** | -65% | -78% | No in-place recipient updates |
| **No factory registry** | -7% | None | No on-chain enumeration |
| **Lazy unclaimed bitmap** | None | -11% | View functions slightly complex |
| **Combined** | -71% | -89% | See above |

**Projected costs on Base L2** (0.001 Gwei, 5 recipients):
- Split creation: ~83,000 gas ($0.00025)
- Split execution: ~2,100 gas ($0.000006)

### Clones with Immutable Args

Recipients stored in clone bytecode instead of storage:

```solidity
// Factory deploys clone with appended data
bytes memory data = abi.encodePacked(
    factory,      // 20 bytes
    authority,    // 20 bytes
    token,        // 20 bytes
    uniqueId,     // 32 bytes
    recipients    // 22 bytes each (address + uint16)
);
address split = LibClone.cloneDeterministic(implementation, data, salt);
```

**Reading from bytecode:**
```solidity
// CODECOPY: ~3 gas per word vs SLOAD: 2,100 gas (cold)
function _getRecipients() internal pure returns (Recipient[] memory) {
    return _getArgRecipients(92);  // Offset after fixed fields
}
```

### Compiler Requirements

**Solidity 0.8.28+** required for native transient storage support.

```toml
# foundry.toml
[profile.default]
solc = "0.8.28"
optimizer = true
optimizer_runs = 1000000  # Optimize for runtime (frequently called)
evm_version = "cancun"    # Required for transient storage
```

### Transient Storage ReentrancyGuard

Use EIP-1153 transient storage for reentrancy protection. Saves ~9,800 gas per `executeSplit` call compared to traditional storage-based guards.

```solidity
// Transient storage: 100 gas per TSTORE/TLOAD
uint256 private transient _reentrancyStatus;

modifier nonReentrant() {
    require(_reentrancyStatus == 0, Reentrancy());
    _reentrancyStatus = 1;
    _;
    _reentrancyStatus = 0;
}
```

### Lazy Unclaimed Bitmap

Only write to storage when transfers fail:

```solidity
uint256 private _unclaimedBitmap;
mapping(uint256 => uint256) private _unclaimedByIndex;

function executeSplit() external nonReentrant {
    uint256 bitmap = _unclaimedBitmap;  // 1 SLOAD

    // Happy path: bitmap is 0, skip unclaimed processing entirely
    if (bitmap != 0) {
        for (uint256 i; i < 21; ) {
            if (bitmap & (1 << i) != 0) {
                // Try to clear unclaimed[i]
            }
            unchecked { i++; }
        }
    }

    // Process distribution...
    // Only write on failure:
    if (!success) {
        _unclaimedByIndex[i] = amount;
        _unclaimedBitmap |= (1 << i);
    }
}
```

### Storage Patterns

**Constants and Immutables:** Use `constant` for compile-time values, `immutable` for constructor-set values. Saves 2,100 gas per read vs storage variables.

```solidity
// Constants (inlined, 0 gas read)
uint16 public constant PROTOCOL_FEE_BPS = 100;
uint16 public constant REQUIRED_SPLIT_TOTAL = 9900;
```

### L2 Optimization Priority (Post-Dencun)

With EIP-4844 blobs, L2 calldata costs are minimal. Optimization priority:

1. **Execution gas** - Storage reads/writes, ERC20 transfers
2. **Storage patterns** - Packing, caching, transient storage
3. **Calldata size** - Less critical on L2s post-Dencun

---

## SDK Usage

```typescript
import { CascadeSplits } from "@cascade-fyi/splits-sdk/evm";

const sdk = new CascadeSplits({ rpcUrl: "https://mainnet.base.org" });

// Create split config
const { splitConfig, tx } = await sdk.buildCreateSplitConfig(authority, {
  token: USDC_BASE,
  recipients: [
    { addr: platform, percentageBps: 900 },   // 9%
    { addr: merchant, percentageBps: 9000 },  // 90%
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
| **Immutable splits** | Trustless verification—payers can verify recipients on-chain. Authority cannot rug by changing recipients post-payment. Deploy new split to change. |
| **Immutable args in bytecode** | 88% gas savings vs storage. Recipients encoded in clone bytecode via `clones-with-immutable-args`. |
| **No factory registry** | Events + CREATE2 sufficient. Saves 22k gas per creation. Indexers use events anyway. |
| **Lazy unclaimed bitmap** | Only write storage on failure. Happy path: 1 SLOAD. 11% execution savings. |
| **`token` not `mint`** | "Mint" means creating tokens in EVM. Avoid confusion. |
| **No close instruction** | EVM has no rent. Contracts persist forever. No reclaim needed. |
| **Self-healing over claim** | Single idempotent interface. Recipients auto-receive on retry. |
| **Clone pattern** | ~83k gas deploy with immutable args. Critical for high-throughput. |
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
- [EIP-1153: Transient Storage](https://eips.ethereum.org/EIPS/eip-1153)
- [clones-with-immutable-args (Solady)](https://github.com/Vectorized/solady/blob/main/src/utils/LibClone.sol)
- [x402 Protocol](https://github.com/coinbase/x402)
- [Base Documentation](https://docs.base.org/)
- [0xSplits V2 Architecture](https://docs.splits.org/core/split-v2)

---

**Last Updated:** 2025-11-28
