---
title: EVM Specification
description: Complete technical specification for Cascade Splits on Base (EVM)
sidebar:
  order: 2
  badge:
    text: Draft
    variant: caution
---

**Version:** 1.0
**Factory Address:** `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7`
**Pattern:** Clone Factory (EIP-1167)
**Terminology:** [Glossary](/specification/glossary/)

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

## Terminology

This spec follows the [canonical glossary](/specification/glossary/). Key EVM-specific mappings:

| Glossary Term | EVM Implementation | Notes |
|---------------|-------------------|-------|
| **ProtocolConfig** | `SplitFactory` contract | Factory IS the protocol config singleton |
| **SplitConfig** | `SplitConfigImpl` clone | Each split is a minimal proxy clone |
| **Vault** | SplitConfig contract balance | On EVM, vault = split address (same contract) |
| **initialize_protocol** | Constructor | Factory constructor handles initialization |
| **percentage_bps** | `percentageBps` | camelCase per EVM convention |

**Vault as Primary Identifier:** The vault address (where users deposit) IS the SplitConfig address on EVM. Unlike Solana where vault is a separate ATA, EVM splits hold funds directly. SDK functions accept this address:

```typescript
getSplit(vault)        // Returns SplitConfig data
executeSplit(vault)    // Distributes vault balance
```

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

:::note
With very small distributions or low-decimal tokens, small-percentage recipients may receive 0 due to floor division. This is expected behavior.
:::

### Dust and Minimum Amounts

There is no minimum execution amount. For very small distributions, floor division may result in some recipients receiving 0:

```
Example: 4 wei split among 5 recipients at 19.8% each
- Each recipient: floor(4 × 1980 / 10000) = 0 wei
- Protocol receives: 4 wei (entire amount as remainder)
```

This is intentional—the protocol collects dust that would otherwise be unallocatable. For practical use with USDC (6 decimals), amounts below ~$0.01 may result in some recipients receiving 0.

**Integrator guidance:** Avoid sending amounts smaller than `recipientCount × 100` base units to ensure all recipients receive non-zero shares.

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

x402 is moving toward smart wallet support. Smart wallets present a unique challenge:

- **Counterfactual addresses**: Wallet address is known before deployment
- **EIP-3009 limitation**: `transferWithAuthorization` may fail if wallet has no code
- **Coinbase Smart Wallet**: Users already encountering failures

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

## Contract Structure

### SplitFactory

Global factory for deploying splits. Supports versioned implementations for safe iteration during active development.

```solidity
contract SplitFactory {
    // Versioned implementation pattern
    address public immutable initialImplementation;  // V1, never changes
    address public currentImplementation;            // Latest version for new splits

    // Protocol configuration
    address public feeWallet;
    address public authority;
    address public pendingAuthority;

    constructor(address initialImplementation_, address feeWallet_, address authority_) {
        if (initialImplementation_ == address(0)) revert ZeroAddress(0);
        if (initialImplementation_.code.length == 0) revert InvalidImplementation(initialImplementation_);
        if (feeWallet_ == address(0)) revert ZeroAddress(1);
        if (authority_ == address(0)) revert ZeroAddress(2);

        initialImplementation = initialImplementation_;
        currentImplementation = initialImplementation_;
        feeWallet = feeWallet_;
        authority = authority_;
        emit ProtocolConfigCreated(authority_, feeWallet_);
    }
}
```

**Versioned implementations:**
- `initialImplementation`: Set at factory deployment, immutable (for historical reference)
- `currentImplementation`: Used for new splits, can be upgraded by protocol authority
- Existing splits are unaffected by upgrades (their implementation is baked into clone bytecode)
- Enables safe bug fixes: deploy new implementation, new splits use it, old splits unchanged

### SplitConfig

Per-split configuration deployed as EIP-1167 clone with immutable args.

```solidity
contract SplitConfig {
    // === IMMUTABLE (encoded in clone bytecode, read via EXTCODECOPY) ===
    // address public factory;      // Read via extcodecopy at offset 0x2d + 0
    // address public authority;    // Read via extcodecopy at offset 0x2d + 20
    // address public token;        // Read via extcodecopy at offset 0x2d + 40
    // bytes32 public uniqueId;     // Read via extcodecopy at offset 0x2d + 60
    // Recipient[] recipients;      // Read via extcodecopy at offset 0x2d + 92

    // === STORAGE (only for unclaimed tracking) ===
    uint256 private _unclaimedBitmap;              // Bits 0-19: recipients, bit 20: protocol
    mapping(uint256 => uint256) private _unclaimedByIndex;  // index => amount
}

struct Recipient {
    address addr;
    uint16 percentageBps;  // 1-9900 (0.01%-99%)
}
```

**Immutable args byte layout:**

| Offset | Size | Field | Clone Bytecode Offset |
|--------|------|-------|----------------------|
| 0 | 20 | factory | `0x2d + 0` |
| 20 | 20 | authority | `0x2d + 20` |
| 40 | 20 | token | `0x2d + 40` |
| 60 | 32 | uniqueId | `0x2d + 60` |
| 92 | 22×N | recipients[N] | `0x2d + 92 + i*22` |

Each recipient is packed as `address (20 bytes) + uint16 percentageBps (2 bytes) = 22 bytes`.

### Invariants

The following properties must always hold:

| Invariant | Description |
|-----------|-------------|
| `popcount(_unclaimedBitmap) <= 21` | Max 20 recipients + 1 protocol with unclaimed |
| `balance >= totalUnclaimed()` | Contract holds at least enough for all unclaimed |
| `sum(percentageBps) == 9900` | Recipients always total 99% (immutable in bytecode) |
| `recipientCount >= 1 && <= 20` | Always 1-20 recipients (immutable in bytecode) |

## Instructions

### Factory Instructions

| Instruction | Description | Authorization |
|-------------|-------------|---------------|
| `createSplitConfig` | Deploy new split clone | Anyone |
| `updateProtocolConfig` | Update fee wallet | Protocol authority |
| `upgradeImplementation` | Set new implementation for future splits | Protocol authority |
| `transferProtocolAuthority` | Propose authority transfer | Protocol authority |
| `acceptProtocolAuthority` | Accept authority transfer | Pending authority |

#### createSplitConfig

```solidity
function createSplitConfig(
    address authority,
    address token,
    bytes32 uniqueId,
    Recipient[] calldata recipients
) external returns (address split);
```

**Parameters:**
- `authority`: Creator/namespace address for the split
- `token`: ERC20 token address (e.g., USDC)
- `uniqueId`: Unique identifier (enables multiple splits per authority/token pair)
- `recipients`: Array of recipients with percentage allocations (must sum to 9900 bps)

**Returns:** Deployed split clone address

**Validation:**
- 1-20 recipients
- Total exactly 9900 bps (99%)
- No duplicate recipients
- No zero addresses (for recipients)
- No zero percentages
- Split with same params must not already exist

### Split Instructions

| Instruction | Description | Authorization |
|-------------|-------------|---------------|
| `executeSplit` | Distribute balance to recipients | Permissionless |

#### executeSplit

```solidity
function executeSplit() external nonReentrant;
```

Distributes available balance to recipients and protocol. Automatically retries any pending unclaimed transfers.

**No `updateSplitConfig`:** Splits are immutable by design. To change recipients, deploy a new split and update your `payTo` address.

### executeSplit Algorithm

```
1. Load _unclaimedBitmap (1 SLOAD)
2. If bitmap != 0:
   - For each set bit i in bitmap:
     - Attempt transfer of _unclaimedByIndex[i] to recipient[i] (or feeWallet if i == 20)
     - If success: clear bit and mapping
     - If fail: keep as unclaimed
3. Calculate available = token.balanceOf(this) - totalUnclaimed()
4. If available > 0:
   a. For each recipient i:
      - amount[i] = available * percentageBps[i] / 10000
      - Attempt transfer, record as unclaimed on failure
   b. protocolFee = available - sum(amount[i])  // Includes 1% + dust
      - Attempt transfer to feeWallet, record as unclaimed on failure
5. Emit SplitExecuted(totalDistributed, protocolFee, unclaimedCleared, newUnclaimed)
```

## x402 Integration

Cascade Splits integrates with the [x402 protocol](https://github.com/coinbase/x402) for internet-native payments. When a resource server sets `payTo` to a split address, funds land via EIP-3009 and can be distributed via `executeSplit`.

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

### Token Compatibility

| Token | EIP-3009 | x402 Compatible |
|-------|----------|-----------------|
| USDC (Base) | ✓ | ✓ |
| USDT | ✗ | ✗ |
| DAI | ✗ (EIP-2612) | ✗ |

## Events

| Event | Description |
|-------|-------------|
| `ProtocolConfigCreated` | Factory deployed |
| `ProtocolConfigUpdated` | Fee wallet changed |
| `ProtocolAuthorityTransferProposed` | Authority transfer initiated |
| `ProtocolAuthorityTransferAccepted` | Authority transfer completed |
| `ImplementationUpgraded` | New implementation set for future splits |
| `SplitConfigCreated` | New split deployed |
| `SplitExecuted` | Funds distributed |
| `TransferFailed` | Individual transfer failed |
| `UnclaimedCleared` | Previously unclaimed funds successfully delivered |

### SplitExecuted Details

```solidity
event SplitExecuted(
    uint256 totalAmount,           // Total distributed this execution
    uint256 protocolFee,           // Protocol's 1% share
    uint256 unclaimedCleared,      // Previously unclaimed now delivered
    uint256 newUnclaimed           // New transfers that failed
);
```

## Error Codes

| Error | Description |
|-------|-------------|
| `InvalidRecipientCount` | Recipients count not in 1-20 range |
| `InvalidSplitTotal` | Percentages don't sum to 9900 bps |
| `DuplicateRecipient` | Same address appears twice |
| `ZeroAddress` | Recipient or feeWallet address is zero |
| `ZeroPercentage` | Recipient has 0 bps allocation |
| `Unauthorized` | Caller not authorized |
| `NoPendingTransfer` | No pending authority transfer to accept |
| `SplitAlreadyExists` | Split with identical params already deployed |
| `InvalidImplementation` | Implementation address has no deployed code |
| `Reentrancy` | Reentrant call detected |

## Security

### Implemented Protections

- ReentrancyGuard on `executeSplit` (Solady's `ReentrancyGuardTransient` via EIP-1153)
- Self-healing transfer wrapper (catches failures, records as unclaimed)
- Overflow protection (Solidity 0.8+)
- Two-step protocol authority transfer
- Duplicate recipient validation at creation
- Bounded recipient count (max 20)
- Zero-address validation on feeWallet updates
- Implementation code-length validation on upgrades

### Not Implemented (by design)

- Pausability (trust minimization)
- Per-split upgrades (existing splits use fixed implementation)
- Close/reclaim (no rent on EVM)
- Native ETH support (ERC20 only)

## Gas Optimization

Optimized for high-throughput micropayments where `executeSplit` is called frequently.

### Measured Gas Costs

| Recipients | `createSplitConfig` | `executeSplit` |
|------------|---------------------|----------------|
| 2 | 93k | 91k |
| 5 | 117k | 170k |
| 10 | 163k | 303k |
| 20 | 276k | 567k |

Gas scales linearly with recipient count due to ERC20 transfers and bytecode encoding.

### Key Optimizations

| Optimization | Creation Impact | Execution Impact |
|--------------|-----------------|------------------|
| **Immutable args** | -65% | -78% |
| **No factory registry** | -7% | None |
| **Lazy unclaimed bitmap** | None | -11% |

## Contract Addresses

**Deterministic addresses (same on ALL EVM chains):**

| Contract | Address |
|----------|---------|
| SplitConfigImpl | `0xF9ad695ecc76c4b8E13655365b318d54E4131EA6` |
| SplitFactory | `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` |

### Deployment Status

| Network | Status |
|---------|--------|
| Base Mainnet | ✅ Deployed |
| Base Sepolia | ✅ Deployed |

## Constants

```solidity
uint16 public constant PROTOCOL_FEE_BPS = 100;        // 1%
uint16 public constant REQUIRED_SPLIT_TOTAL = 9900;   // 99%
uint8 public constant MIN_RECIPIENTS = 1;
uint8 public constant MAX_RECIPIENTS = 20;
uint256 public constant PROTOCOL_INDEX = MAX_RECIPIENTS;  // Bitmap index for protocol fee (20)
```

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Hardcoded 1% fee** | Transparency. Anyone can verify on-chain. |
| **Immutable splits** | Trustless verification—payers can verify recipients on-chain. |
| **Immutable args in bytecode** | 88% gas savings vs storage. |
| **Versioned implementations** | Safe iteration during development. |
| **No factory registry** | Events + CREATE2 sufficient. Saves 22k gas per creation. |
| **Lazy unclaimed bitmap** | Only write storage on failure. 11% execution savings. |
| **`token` not `mint`** | "Mint" means creating tokens in EVM. |
| **No close instruction** | EVM has no rent. Contracts persist forever. |
| **Self-healing over claim** | Single idempotent interface. |
| **Clone pattern** | ~83k gas deploy. Critical for high-throughput. |
| **ERC20 only, no native ETH** | Simplifies implementation. USDC is primary use case. |
