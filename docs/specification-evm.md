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

## Terminology

This spec follows the [canonical glossary](./glossary.md). Key EVM-specific mappings:

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

### Handling Problematic Recipients

If a recipient becomes permanently unable to receive (blocklisted, lost keys, etc.), the recommended recovery pattern is:

1. **Existing split:** Continue operating. Other recipients receive their shares normally. Problematic recipient's share accumulates as unclaimed.

2. **Migration:** Authority creates new split with corrected recipients.

3. **Update integration:** Change `payTo` address in x402 resource server configuration.

4. **Old split:** Funds remain indefinitely. No recovery mechanism by design—this prevents authority from redirecting funds that belong to the original recipient.

Adding complexity for recipient removal would introduce trust assumptions that contradict the permissionless design. The migration pattern is simpler and maintains the immutability guarantee.

### Monitoring Transfer Failures

The `SplitExecuted` event includes transfer status for each recipient. Integrators should monitor for:
- Repeated failures to the same address (potential blocklist)
- Smart wallet addresses with no code (prompt user to deploy)

---

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
        authority = authority_;  // Explicit authority for CREATE2 determinism
        emit ProtocolConfigCreated(authority_, feeWallet_);
    }
}
```

**Versioned implementations:**
- `initialImplementation`: Set at factory deployment, immutable (for historical reference)
- `currentImplementation`: Used for new splits, can be upgraded by protocol authority
- Existing splits are unaffected by upgrades (their implementation is baked into clone bytecode)
- Enables safe bug fixes: deploy new implementation, new splits use it, old splits unchanged

**Note:** Implementation upgrades are currently instant (no timelock). This is intentional during active development for rapid iteration. Additional safeguards (timelock, multi-sig) may be added before production deployment.

**No registry mapping:** Split addresses are deterministic via CREATE2. Discovery uses `SplitConfigCreated` events indexed by subgraphs. On-chain verification recomputes CREATE2 address from known parameters.

**Implementation upgrade:**
```solidity
function upgradeImplementation(address newImplementation) external onlyAuthority {
    if (newImplementation == address(0)) revert ZeroAddress(0);
    if (newImplementation.code.length == 0) revert InvalidImplementation(newImplementation);
    address oldImplementation = currentImplementation;
    currentImplementation = newImplementation;
    emit ImplementationUpgraded(oldImplementation, newImplementation);
}
```

**Access control modifier:**
```solidity
modifier onlyAuthority() {
    if (msg.sender != authority) revert Unauthorized(msg.sender, authority);
    _;
}
```

### Interfaces

```solidity
/// @notice Minimal factory interface for SplitConfig to read protocol configuration
/// @dev Full interface includes createSplitConfig() and predictSplitAddress()
interface ISplitFactory {
    function feeWallet() external view returns (address);
    function currentImplementation() external view returns (address);
    function authority() external view returns (address);
}

/// @notice Minimal ERC20 interface for token operations
/// @dev Use OpenZeppelin's IERC20 or Solady's equivalent in implementation
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
```

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

Each recipient is packed as `address (20 bytes) + uint16 percentageBps (2 bytes) = 22 bytes`. Total clone data size: `92 + 22×N` bytes where N is recipient count (1-20). The `0x2d` (45 bytes) prefix is the EIP-1167 proxy bytecode that precedes the immutable args.

**Recipient count derivation:** N is not stored explicitly—it's derived from the clone's code size:

```solidity
function getRecipientCount() public view returns (uint256) {
    // code.length = 0x2d (proxy) + 92 (fixed fields) + 22*N (recipients)
    return (address(this).code.length - 0x2d - 92) / 22;
}
```

**Immutable args pattern:** Recipients and configuration are encoded in the clone's bytecode, not storage. Reading from bytecode via EXTCODECOPY (~100 gas base + ~3 gas/word) is significantly cheaper than storage (~2,100 gas cold SLOAD per slot). Trade-off: splits are immutable—deploy new split to change recipients.

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
| `createSplitConfig` | Deploy new split clone (uses `currentImplementation`) | Anyone |
| `updateProtocolConfig` | Update fee wallet (validates non-zero) | Protocol authority |
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
- `authority`: Creator/namespace address for the split (see Authority Field below)
- `token`: ERC20 token address (e.g., USDC)
- `uniqueId`: Unique identifier (enables multiple splits per authority/token pair)
- `recipients`: Array of recipients with percentage allocations (must sum to 9900 bps)

**Returns:** Deployed split clone address

**Authority Field:**

The `authority` address serves as a namespace and identifier, NOT a control mechanism:

| Purpose | Description |
|---------|-------------|
| **CREATE2 namespace** | Ensures address uniqueness per creator (`salt = keccak256(authority, token, uniqueId)`) |
| **Event indexing** | Allows filtering splits by creator in subgraphs via `SplitConfigCreated` event |
| **Semantic ownership** | Identifies who configured the split for off-chain coordination |

**Authority has NO on-chain privileges** for deployed splits. Splits are fully immutable and permissionlessly executable. The authority cannot:
- Modify recipients or percentages
- Withdraw or redirect funds
- Pause, close, or disable the split

`address(0)` is allowed as authority for "communal" splits with no attributed creator. This is useful for trustless configurations where no single party should be identified as the owner.

**Validation:**
- 1-20 recipients
- Total exactly 9900 bps (99%)
- No duplicate recipients
- No zero addresses (for recipients)
- No zero percentages
- Split with same params must not already exist

**Implementation note—CREATE2 collision handling:**

Use Solady's `createDeterministicClone` which handles collision detection internally and returns deployment status:

```solidity
bytes32 salt = keccak256(abi.encode(authority, token, uniqueId));

// Pack immutable args: factory (20) + authority (20) + token (20) + uniqueId (32) + recipients (22 each)
bytes memory data = abi.encodePacked(address(this), authority, token, uniqueId);
for (uint256 i; i < recipients.length; ) {
    data = abi.encodePacked(data, recipients[i].addr, recipients[i].percentageBps);
    unchecked { i++; }
}

(bool alreadyDeployed, address split) = LibClone.createDeterministicClone(
    currentImplementation,
    data,
    salt
);
if (alreadyDeployed) revert SplitAlreadyExists(split);
```

This is cleaner than manual `predictDeterministicAddress` + `code.length` check—Solady handles the atomic check-and-deploy pattern internally.

#### updateProtocolConfig

```solidity
function updateProtocolConfig(address newFeeWallet) external onlyAuthority;
```

Updates the protocol fee wallet. Validates non-zero address.

```solidity
function updateProtocolConfig(address newFeeWallet) external onlyAuthority {
    if (newFeeWallet == address(0)) revert ZeroAddress(0);
    address oldFeeWallet = feeWallet;
    feeWallet = newFeeWallet;
    emit ProtocolConfigUpdated(oldFeeWallet, newFeeWallet);
}
```

#### transferProtocolAuthority

```solidity
function transferProtocolAuthority(address newAuthority) external onlyAuthority;
```

Initiates two-step authority transfer. Set to `address(0)` to cancel pending transfer.

```solidity
function transferProtocolAuthority(address newAuthority) external onlyAuthority {
    pendingAuthority = newAuthority;
    emit ProtocolAuthorityTransferProposed(authority, newAuthority);
}
```

#### acceptProtocolAuthority

```solidity
function acceptProtocolAuthority() external;
```

Completes authority transfer. Must be called by pending authority.

```solidity
function acceptProtocolAuthority() external {
    if (pendingAuthority == address(0)) revert NoPendingTransfer();
    if (msg.sender != pendingAuthority) revert Unauthorized(msg.sender, pendingAuthority);
    address oldAuthority = authority;
    authority = pendingAuthority;
    pendingAuthority = address(0);
    emit ProtocolAuthorityTransferAccepted(oldAuthority, authority);
}
```

### Split Instructions

| Instruction | Description | Authorization |
|-------------|-------------|---------------|
| `executeSplit` | Distribute balance to recipients | Permissionless |

#### executeSplit

```solidity
function executeSplit() external nonReentrant;
```

Distributes available balance to recipients and protocol. Automatically retries any pending unclaimed transfers. See [executeSplit Algorithm](#executesplit-algorithm) for detailed behavior.

**No `updateSplitConfig`:** Splits are immutable by design. To change recipients, deploy a new split and update your `payTo` address. This provides trustless verification—payers can verify recipients on-chain before paying, and authority cannot change recipients after payment.

### View Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `getRecipients()` | `Recipient[]` | All configured recipients |
| `getRecipientCount()` | `uint256` | Number of recipients (derived from code size) |
| `totalUnclaimed()` | `uint256` | Sum of all unclaimed amounts |
| `hasPendingFunds()` | `bool` | True if balance > unclaimed |
| `pendingAmount()` | `uint256` | Amount available for next execution |
| `previewExecution()` | `(uint256[], uint256, uint256, uint256[], uint256)` | Preview complete execution (new distribution + pending unclaimed) |
| `getBalance()` | `uint256` | Total token balance held |
| `isCascadeSplitConfig()` | `bool` | Always returns true (for detection) |

**View function implementations:**

```solidity
/// @notice Calculate total unclaimed across all recipients + protocol
function totalUnclaimed() public view returns (uint256 total) {
    uint256 bitmap = _unclaimedBitmap;
    if (bitmap == 0) return 0;

    for (uint256 i; i < 21; ) {
        if (bitmap & (1 << i) != 0) {
            total += _unclaimedByIndex[i];
        }
        unchecked { i++; }
    }
}
```

**Design note:** `totalUnclaimed()` iterates over the bitmap rather than caching the sum in storage. This trades higher read cost (up to 21 SLOADs in worst case) for lower write cost on the happy path where transfers succeed. Since failures are rare and `totalUnclaimed()` is called once per `executeSplit()`, caching would add 5,000 gas per failure/clear event to save reads that rarely happen.

```solidity
/// @notice Preview complete execution outcome including pending unclaimed
/// @return recipientAmounts Amount each recipient would receive from new funds
/// @return protocolFee Amount protocol would receive from new funds (1% + dust)
/// @return available Total new funds being distributed
/// @return pendingRecipientAmounts Unclaimed amounts per recipient that would be retried
/// @return pendingProtocolAmount Unclaimed protocol fee that would be retried
function previewExecution() public view returns (
    uint256[] memory recipientAmounts,
    uint256 protocolFee,
    uint256 available,
    uint256[] memory pendingRecipientAmounts,
    uint256 pendingProtocolAmount
) {
    uint256 count = getRecipientCount();
    recipientAmounts = new uint256[](count);
    pendingRecipientAmounts = new uint256[](count);

    // Calculate pending unclaimed amounts
    uint256 bitmap = _unclaimedBitmap;
    if (bitmap != 0) {
        for (uint256 i; i < count; ) {
            if (bitmap & (1 << i) != 0) {
                pendingRecipientAmounts[i] = _unclaimedByIndex[i];
            }
            unchecked { i++; }
        }
        if (bitmap & (1 << PROTOCOL_INDEX) != 0) {
            pendingProtocolAmount = _unclaimedByIndex[PROTOCOL_INDEX];
        }
    }

    // Calculate new distribution
    available = IERC20(token()).balanceOf(address(this)) - totalUnclaimed();
    if (available == 0) return (recipientAmounts, 0, 0, pendingRecipientAmounts, pendingProtocolAmount);

    uint256 distributed;
    for (uint256 i; i < count; ) {
        (, uint16 bps) = _getRecipient(i);
        recipientAmounts[i] = (available * bps) / 10000;
        distributed += recipientAmounts[i];
        unchecked { i++; }
    }

    protocolFee = available - distributed;  // 1% + dust
}
```

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

**Key behaviors:**
- Step 2 runs before step 4: unclaimed retries happen first
- Step 4b uses subtraction, not multiplication: protocol gets exact remainder including dust
- All transfers use self-healing wrapper: failures don't revert, they record as unclaimed

### Transaction Atomicity

All state changes in `executeSplit()` are atomic with the EVM transaction:

1. **Partial execution rollback:** If the transaction reverts mid-execution (e.g., out of gas after some transfers), ALL state changes are rolled back, including bitmap modifications, unclaimed mapping updates, and ERC20 transfers (reverted in token contract).

2. **External call isolation:** ERC20 `transfer()` calls only modify state in the token contract (balance mappings). They do not execute arbitrary code on recipient addresses for standard ERC20 tokens.

3. **No cross-transaction state leakage:** Each `executeSplit()` call is independent. A failed call leaves state unchanged, and the next call starts fresh.

**Note:** This guarantee relies on standard ERC20 behavior. Tokens with transfer hooks (ERC777) could introduce additional complexity—see [Gas Griefing](#gas-griefing) section.

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

**Unclaimed retry behavior with fee-on-transfer tokens:** When a transfer fails and is stored as unclaimed, the retry on subsequent `executeSplit()` calls transfers the **stored amount**, not the net amount after fees:

```
Initial execution:
  - Split receives 990 tokens (1000 sent, 1% fee taken on deposit)
  - Recipient A's share: 495 tokens
  - Transfer to A fails → stored as unclaimed[0] = 495

Retry execution:
  - executeSplit() retries transfer of 495 to A
  - Fee-on-transfer takes 1% → A receives 490 tokens
  - unclaimed[0] cleared to 0
```

Recipients of fee-on-transfer tokens may receive slightly less than their stored unclaimed amount on retry due to the additional transfer fee. This is inherent to fee-on-transfer token mechanics and cannot be avoided without protocol-level subsidization.

**Rebasing Tokens (stETH, OHM, AMPL):**
Balance changes without transfers. Unclaimed accounting breaks. **Explicitly exclude.**

**Blocklist/Pausable Tokens (USDC, USDT):**
Circle/Tether can freeze addresses. Self-healing handles gracefully, but funds may be stuck permanently if recipient is blocklisted.

### Gas Griefing

**Standard ERC20:** Not vulnerable. Token `transfer()` only updates balances in the token contract - no code executes on the recipient address.

**Tokens with hooks (ERC777, custom):** If supported in future, recipient contracts could consume gas via `tokensReceived` hooks. Mitigation: gas caps per transfer or explicitly exclude hook-enabled tokens.

**Current scope (USDC):** USDC is standard ERC20 without hooks. No gas griefing vector.

### Deterministic Address Derivation

Split addresses are deterministic via CREATE2. The address depends on **both** the salt AND the immutable data (which includes recipients):

```solidity
// Salt ensures uniqueness per (authority, token, uniqueId) tuple
bytes32 salt = keccak256(abi.encode(authority, token, uniqueId));

// Immutable data is encoded in the clone bytecode
bytes memory data = abi.encodePacked(factory, authority, token, uniqueId, recipients);

// Address depends on implementation, data, salt, AND factory
address = LibClone.predictDeterministicAddress(implementation, data, salt, factory);
```

**Note:** The salt does not include `factory` because the CREATE2 formula already incorporates the deployer address—adding it to the salt would be redundant.

**Important:** Changing any parameter (including recipients) produces a different address. To compute the address off-chain, you need all parameters including the full recipient list.

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
| `ImplementationUpgraded` | New implementation set for future splits |
| `SplitConfigCreated` | New split deployed (includes full recipient list for indexing) |
| `SplitExecuted` | Funds distributed (includes per-recipient status) |
| `TransferFailed` | Individual transfer failed (recipient stored as unclaimed) |
| `UnclaimedCleared` | Previously unclaimed funds successfully delivered |

### Factory Event Signatures

```solidity
/// @notice Emitted when factory is deployed
event ProtocolConfigCreated(address indexed authority, address indexed feeWallet);

/// @notice Emitted when fee wallet is updated
event ProtocolConfigUpdated(address indexed oldFeeWallet, address indexed newFeeWallet);

/// @notice Emitted when authority transfer is initiated
event ProtocolAuthorityTransferProposed(address indexed currentAuthority, address indexed pendingAuthority);

/// @notice Emitted when authority transfer is completed
event ProtocolAuthorityTransferAccepted(address indexed oldAuthority, address indexed newAuthority);

/// @notice Emitted when implementation is upgraded for future splits
event ImplementationUpgraded(address indexed oldImplementation, address indexed newImplementation);
```

### SplitConfigCreated Details

```solidity
event SplitConfigCreated(
    address indexed split,
    address indexed authority,
    address indexed token,
    bytes32 uniqueId,
    Recipient[] recipients
);
```

Emitted by factory when a new split is deployed. Recipients array enables indexers to capture full configuration without additional queries.

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

### UnclaimedCleared Details

Emitted when a previously unclaimed transfer succeeds on retry:

```solidity
event UnclaimedCleared(
    address indexed recipient,
    uint256 amount,
    bool isProtocol                // True if protocol fee was cleared
);
```

**Monitoring use cases:**
- Track successful fund recovery after temporary failures
- Audit trail for all fund movements (complements TransferFailed)
- Debugging integrations (correlate with previous TransferFailed events)

### Event Emission Order

Events in `executeSplit()` are emitted in the following order:

1. **Unclaimed retry phase** (if bitmap != 0):
   - `UnclaimedCleared(recipient, amount, isProtocol)` for each successful retry
   - `TransferFailed(recipient, amount, isProtocol)` for each retry that fails again

2. **New distribution phase** (if available > 0):
   - `TransferFailed(recipient, amount, false)` for each recipient transfer that fails
   - `TransferFailed(feeWallet, amount, true)` if protocol fee transfer fails

3. **Summary event** (always emitted):
   - `SplitExecuted(totalAmount, protocolFee, unclaimedCleared, newUnclaimed)`

**Rationale:** `UnclaimedCleared` and `TransferFailed` events are emitted immediately when retries/transfers occur, providing a complete audit trail. `SplitExecuted` is emitted last with aggregated data for efficient querying.

---

## Error Definitions

Custom errors with diagnostic parameters for debugging and SDK integration:

```solidity
/// @dev Recipients array length not in [1, 20] range
error InvalidRecipientCount(uint256 count, uint256 min, uint256 max);

/// @dev Recipient percentages don't sum to 9900 bps (99%)
error InvalidSplitTotal(uint256 actual, uint256 expected);

/// @dev Same recipient address appears multiple times
error DuplicateRecipient(address recipient, uint256 firstIndex, uint256 duplicateIndex);

/// @dev Recipient or feeWallet address is zero
error ZeroAddress(uint256 index);

/// @dev Recipient has 0 bps allocation
error ZeroPercentage(uint256 index);

/// @dev Caller not authorized for this operation
error Unauthorized(address caller, address expected);

/// @dev No pending authority transfer to accept
error NoPendingTransfer();

/// @dev Split with identical params already deployed at this address
error SplitAlreadyExists(address predicted);

/// @dev Implementation address has no deployed code
error InvalidImplementation(address implementation);

/// @dev Reentrant call detected
error Reentrancy();
```

**Rationale:** Parameterized errors cost minimal bytecode (defined once) but dramatically improve debugging. When `InvalidRecipientCount(25, 1, 20)` is thrown, the issue is immediately clear vs tracing through transaction logs.

---

## Security

### Implemented Protections

- ReentrancyGuard on `executeSplit` only (Solady's `ReentrancyGuardTransient` via EIP-1153)
- Self-healing transfer wrapper (catches failures, records as unclaimed—see Audit Considerations)
- Overflow protection (Solidity 0.8+)
- Two-step protocol authority transfer (prevents accidental transfers)
- Duplicate recipient validation at creation
- Bounded recipient count (max 20, bounds gas consumption)
- Self-healing unclaimed pattern (CEI-compliant)
- Zero-address validation on feeWallet updates
- Implementation code-length validation on upgrades

### Not Implemented (by design)

- Pausability (see rationale below)
- Per-split upgrades (existing splits use fixed implementation, trust-minimized)
- Time locks (unnecessary—no high-stakes parameter changes in splits)
- Close/reclaim (no rent on EVM)
- Native ETH support (ERC20 only—simplifies implementation, USDC is primary use case)

**No Pause Mechanism Rationale:**

The factory and split contracts have no pause functionality:

- **Splits are immutable** — No parameter changes after creation
- **Funds are isolated** — Each split holds its own funds, factory has none
- **Bug mitigation** — Deploy new implementation; existing splits unaffected
- **Trust minimization** — No authority can halt user operations
- **Gas efficiency** — No pause check (+2,100 gas) on every `createSplitConfig`

If a critical vulnerability is discovered:
1. Upgrade factory implementation (new splits use fixed code)
2. Existing splits continue operating (immutable, no migration path needed)
3. Users can create new splits with fixed implementation

This follows the pattern of other simple, audited protocols (Safe, Uniswap v3 core) that prioritize immutability over pausability.

### Audit Considerations

**Reentrancy:**
- Solady's `ReentrancyGuardTransient` prevents same-tx reentrancy (uses slot `0x929eee149b4bd21268`)
- CEI pattern followed: bitmap updated before external calls
- Only `executeSplit` needs guard (only state-changing function with external calls)

**Bitmap synchronization:**
- Invariant: `bitmap bit set ⟺ unclaimedByIndex[i] > 0`
- Both updated atomically within same transaction
- Reentrancy guard prevents concurrent modifications

**Unclaimed index mapping:**
- Indices 0-19: Recipients (fixed, immutable in bytecode)
- Index 20: Protocol fee
- Indices never change after split creation

**Protocol fee unclaimed handling:**

The protocol fee wallet (index 20) uses the same self-healing pattern as recipients. If the fee wallet transfer fails (e.g., fee wallet is blocklisted):
1. Fee amount is stored in `_unclaimedByIndex[20]`
2. Bit 20 is set in `_unclaimedBitmap`
3. Next `executeSplit()` retries the transfer to current `feeWallet` from factory
4. If `feeWallet` was updated via `updateProtocolConfig`, retry succeeds to new address

This ensures protocol fees are never lost—they remain in the split contract until successfully delivered. The fee wallet address is read from the factory on each execution, not stored in the split, so updating the factory's fee wallet allows recovery of stuck protocol fees.

**Factory call pattern for feeWallet:**
```solidity
// In SplitConfigImpl.executeSplit()
address feeWallet = ISplitFactory(factory()).feeWallet();
// factory() uses EXTCODECOPY to read from clone bytecode (see Gas Optimization section)
```

**Token compatibility:**
- Fee-on-transfer tokens: supported (recipients receive post-fee amounts)
- Rebasing tokens: explicitly excluded (documented, not enforced)

**Self-healing transfer wrapper (why NOT SafeERC20):**

`SafeERC20.safeTransfer` reverts on failure—if one recipient is blocklisted, the entire `executeSplit()` transaction reverts and nobody gets paid. Self-healing **requires** catching failures gracefully:

| Pattern | On Transfer Failure | Result |
|---------|---------------------|--------|
| `SafeERC20.safeTransfer()` | Reverts entire tx | All recipients blocked |
| Manual `call()` | Returns false | Failed recipient stored as unclaimed, others paid |

We use assembly-based transfer following Solady's `trySafeTransferFrom` pattern (adapted for `transfer`):

```solidity
/// @dev Attempts ERC20 transfer without reverting. Returns success status.
/// Follows Solady's SafeTransferLib pattern for robust token handling.
function _trySafeTransfer(address token, address to, uint256 amount)
    private
    returns (bool success)
{
    /// @solidity memory-safe-assembly
    assembly {
        mstore(0x14, to) // Store the `to` argument.
        mstore(0x34, amount) // Store the `amount` argument.
        mstore(0x00, 0xa9059cbb000000000000000000000000) // `transfer(address,uint256)`.
        success := call(gas(), token, 0, 0x10, 0x44, 0x00, 0x20)
        if iszero(and(eq(mload(0x00), 1), success)) {
            // Success if: call succeeded AND (no code at token OR returndata is empty)
            success := lt(or(iszero(extcodesize(token)), returndatasize()), success)
        }
        mstore(0x34, 0) // Restore the part of the free memory pointer that was overwritten.
    }
}

/// @dev Transfer with self-healing fallback. Records failures as unclaimed.
function _safeTransferWithFallback(
    address token,
    address to,
    uint256 amount,
    uint256 index
) private returns (bool success) {
    success = _trySafeTransfer(token, to, amount);

    if (!success) {
        // Record as unclaimed for retry on next execution
        _unclaimedByIndex[index] += amount;
        _unclaimedBitmap |= (1 << index);
        emit TransferFailed(to, amount, index == PROTOCOL_INDEX);
    }
}
```

**Why assembly-based pattern:**
- Matches Solady's battle-tested `trySafeTransferFrom` implementation
- Handles USDT (no return value) via `returndatasize()` check
- Handles malformed return data (won't revert on garbage—checks for exact `1`)
- Includes `extcodesize` check for safety edge cases
- Catches reverts (blocklisted addresses, paused tokens) without reverting
- Allows other recipients to receive funds even when one transfer fails

**CREATE2 determinism:**
- Salt = `keccak256(authority, token, uniqueId)`
- Same params = same address (intentional, prevents duplicates)
- `SplitAlreadyExists` error if clone already deployed

**CREATE2 collision (known limitation):**

The factory checks `predicted.code.length == 0` before deploying. If code already exists at the predicted address (deployed by someone else), `SplitAlreadyExists` is thrown. We do NOT verify whether existing code is a valid SplitConfig.

*Why this is acceptable:*
- Attack requires knowing factory address + exact salt before factory deployment
- Even if successful, attacker only griefs one specific split creation—no funds at risk
- Using `isCascadeSplitConfig()` check would be spoofable (any contract can implement it)
- Realistic threat level: zero (requires predicting deterministic deployer output)

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

**Measured gas costs:**

| Recipients | `createSplitConfig` | `executeSplit` |
|------------|---------------------|----------------|
| 2 | 93k | 91k |
| 5 | 117k | 170k |
| 10 | 163k | 303k |
| 20 | 276k | 567k |

Gas scales linearly with recipient count due to ERC20 transfers and bytecode encoding.

### Clones with Immutable Args

Recipients stored in clone bytecode instead of storage. **Use Solady's `LibClone`** (not OpenZeppelin—OZ doesn't support immutable args).

> ⚠️ **CRITICAL: Two Incompatible CWIA Patterns Exist**
>
> Solady has **TWO libraries** for clones with immutable args—they are **INCOMPATIBLE**:
>
> | Library | Location | Args Storage | Reading Method |
> |---------|----------|--------------|----------------|
> | **LibClone** | `utils/LibClone.sol` | Bytecode only | EXTCODECOPY or `LibClone.argsOnClone()` |
> | **LibCWIA** (legacy) | `utils/legacy/LibCWIA.sol` | Appended to calldata | `_getArg*()` via `CWIA.sol` |
>
> **We use LibClone (modern pattern).** From LibClone.sol:
> > "The implementation of CWIA here does NOT append the immutable args into the calldata passed into delegatecall."
>
> **DO NOT:**
> - Import or inherit from `CWIA.sol` or `LibCWIA.sol`
> - Use `_getArgAddress()`, `_getArgUint256()`, or other `_getArg*()` helpers
> - Read args via `calldataload`—args are NOT in calldata with LibClone
>
> **DO:**
> - Use inline `extcodecopy` assembly (shown below)
> - Or use `LibClone.argsOnClone(address(this))` helper
> - Read from bytecode offset `0x2d` (45 bytes = proxy code size)

```solidity
import {LibClone} from "solady/utils/LibClone.sol";

// Factory deploys clone with appended data
bytes memory data = abi.encodePacked(
    factory,      // 20 bytes
    authority,    // 20 bytes
    token,        // 20 bytes
    uniqueId,     // 32 bytes
    recipients    // 22 bytes each (address + uint16)
);
address split = LibClone.cloneDeterministic(currentImplementation, data, salt);
```

**Reading immutable args from bytecode (in SplitConfig implementation):**

Solady's `LibClone` stores immutable args in the clone's bytecode after the proxy code (offset 0x2d = 45 bytes). **Important:** Unlike wighawag's original CWIA pattern, Solady does NOT append args to calldata during delegatecall—they remain in bytecode only.

```solidity
import {LibClone} from "solady/utils/LibClone.sol";

contract SplitConfigImpl {
    // Byte offsets in clone bytecode (after 0x2d proxy bytes)
    uint256 private constant _FACTORY_OFFSET = 0;
    uint256 private constant _AUTHORITY_OFFSET = 20;
    uint256 private constant _TOKEN_OFFSET = 40;
    uint256 private constant _UNIQUE_ID_OFFSET = 60;
    uint256 private constant _RECIPIENTS_OFFSET = 92;

    // Gas-efficient: inline assembly reads directly from clone bytecode
    // EXTCODECOPY: ~3 gas per word vs SLOAD: 2,100 gas (cold)
    function factory() public view returns (address result) {
        assembly {
            extcodecopy(address(), 0x00, 0x2d, 0x20)  // 0x2d = proxy code size
            result := shr(96, mload(0x00))            // Right-align address
        }
    }

    function authority() public view returns (address result) {
        assembly {
            extcodecopy(address(), 0x00, add(0x2d, 20), 0x20)
            result := shr(96, mload(0x00))
        }
    }

    function token() public view returns (address result) {
        assembly {
            extcodecopy(address(), 0x00, add(0x2d, 40), 0x20)
            result := shr(96, mload(0x00))
        }
    }

    function uniqueId() public view returns (bytes32 result) {
        assembly {
            extcodecopy(address(), 0x00, add(0x2d, 60), 0x20)
            result := mload(0x00)
        }
    }

    // Reading packed recipients (22 bytes each: address + uint16)
    function _getRecipient(uint256 index) internal view returns (address addr, uint16 bps) {
        uint256 offset = 0x2d + 92 + (index * 22);  // After proxy + fixed fields
        assembly {
            extcodecopy(address(), 0x00, offset, 0x20)
            addr := shr(96, mload(0x00))
            extcodecopy(address(), 0x00, add(offset, 20), 0x20)
            bps := shr(240, mload(0x00))
        }
    }

    // Alternative: Use LibClone helper (allocates memory, less gas-efficient)
    function _getAllArgs() internal view returns (bytes memory) {
        return LibClone.argsOnClone(address(this));
    }
}
```

**Note:** `address(this)` inside the implementation refers to the clone proxy (where args are stored), not the implementation contract. This is because the clone delegates calls to the implementation while maintaining its own address context.

**Why Solady over OpenZeppelin:**
- Native `cloneDeterministicWithImmutableArgs` support
- Highly gas-optimized (hand-tuned assembly)
- Battle-tested, maintained by Vectorized
- OpenZeppelin's `Clones.sol` lacks immutable args support

### Compiler Requirements

**Solidity 0.8.30+** required for native transient storage support.

```toml
# foundry.toml
[profile.default]
solc = "0.8.30"
optimizer = true
optimizer_runs = 1000000  # Optimize for runtime (frequently called)
evm_version = "cancun"    # Required for transient storage (Base L2)
```

**Note:** Solidity 0.8.30 defaults to "prague" EVM version, but we explicitly set "cancun" for Base L2 compatibility. Cancun includes EIP-1153 (transient storage) which is all we need.

### Transient Storage ReentrancyGuard

Use Solady's `ReentrancyGuardTransient` for reentrancy protection via EIP-1153. Saves ~9,800 gas per `executeSplit` call compared to traditional storage-based guards.

```solidity
import {ReentrancyGuardTransient} from "solady/utils/ReentrancyGuardTransient.sol";

contract SplitConfigImpl is ReentrancyGuardTransient {
    function executeSplit() external nonReentrant {
        // ...
    }
}
```

**Why Solady over custom assembly:**
- Battle-tested implementation with known slot allocation
- Inheritance-safe (uses pseudo-random slot `0x929eee149b4bd21268`, not slot 0)
- Consistent with project's existing Solady dependency (LibClone)
- Less custom code to audit

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

Per [glossary](./glossary.md), vault address is the primary identifier. On EVM, vault = split address.

```typescript
import { CascadeSplits } from "@cascade-fyi/splits-sdk/evm";

const sdk = new CascadeSplits({ rpcUrl: "https://mainnet.base.org" });

// Create split config - returns vault (deposit address)
const { vault, tx } = await sdk.createSplitConfig({
  authority,
  token: USDC_BASE,
  recipients: [
    { addr: platform, percentageBps: 900 },   // 9%
    { addr: merchant, percentageBps: 9000 },  // 90%
  ],
});

// Get split data by vault address
const split = await sdk.getSplit(vault);

// Execute split (distribute vault balance)
await sdk.executeSplit(vault);

// Detect if address is a Cascade split
const isSplit = await sdk.detectSplitConfig(vault);
```

**Note:** `vault` and `split` refer to the same address on EVM. The SDK uses `vault` as the parameter name for consistency with Solana SDK where they differ.

---

## Deployment

### Deterministic Multi-Chain Deployment

Factory deployed to **same address on all chains** using CREATE2 via deterministic deployer.

```solidity
// 0age's Deterministic Deployment Proxy (same address on all EVM chains)
address constant DETERMINISTIC_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
```

**Deployment script:**
```solidity
// script/Deploy.s.sol
import {Script} from "forge-std/Script.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";

contract Deploy is Script {
    bytes32 constant SALT = keccak256("cascade-splits-v1");

    function run() external {
        vm.startBroadcast();

        // Deploy implementation first
        SplitConfigImpl impl = new SplitConfigImpl{salt: SALT}();

        // Deploy factory with deterministic address
        SplitFactory factory = new SplitFactory{salt: SALT}(
            address(impl),  // initialImplementation
            feeWallet
        );

        vm.stopBroadcast();
    }
}
```

```bash
# Deploy to Base (primary chain)
forge script script/Deploy.s.sol --rpc-url base --broadcast --verify

# Future: Deploy to additional chains (same address via deterministic deployment)
forge script script/Deploy.s.sol --rpc-url polygon --broadcast --verify
forge script script/Deploy.s.sol --rpc-url bnb --broadcast --verify
```

### Contract Addresses

**Deterministic addresses (same on ALL EVM chains):**

| Contract | Address |
|----------|---------|
| SplitConfigImpl | [`0xF9ad695ecc76c4b8E13655365b318d54E4131EA6`](https://sepolia.basescan.org/address/0xF9ad695ecc76c4b8E13655365b318d54E4131EA6) |
| SplitFactory | [`0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7`](https://sepolia.basescan.org/address/0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7) |

These addresses are derived via CREATE2 using Arachnid's deterministic deployer and are identical on all supported networks.

#### Deployment Status

| Network | Status | Explorer |
|---------|--------|----------|
| Base Sepolia | Deployed | [View on BaseScan](https://sepolia.basescan.org/address/0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7) |
| Base Mainnet | Pending | - |

#### Future Chains (Planned)

| Network | Status | Notes |
|---------|--------|-------|
| Polygon | Planned | Same address via deterministic deployment |
| BNB Chain | Planned | Same address via deterministic deployment |

### Multi-Chain Deployment Strategy

Factory and implementation are deployed to the **same address on all chains** using CREATE2 via the deterministic deployment proxy.

**Deployment requirements:**
1. Same deployer private key
2. Same contract bytecode (including constructor args)
3. Same salt

**Cross-chain considerations:**

| Consideration | Handling |
|---------------|----------|
| **Token addresses differ** | USDC has different addresses per chain. Splits are token-specific. |
| **Pre-deployment deposits** | If user sends to predicted address before deployment, funds are accessible after deployment (CREATE2 address is deterministic). |
| **Chain-specific features** | Base-specific features (if any) documented separately. |

**Note:** Same salt + same bytecode = same address across all EVM chains (except zkSync Era which uses different CREATE2 formula).

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Hardcoded 1% fee** | Transparency. Anyone can verify on-chain. Avoids calculation complexity. |
| **Immutable splits** | Trustless verification—payers can verify recipients on-chain. Authority cannot rug by changing recipients post-payment. Deploy new split to change. |
| **Immutable args in bytecode** | 88% gas savings vs storage. Recipients encoded in clone bytecode via Solady's `LibClone`. Read via EXTCODECOPY (NOT `_getArg*()` calldata helpers—see [critical warning](#clones-with-immutable-args)). |
| **Versioned implementations** | Safe iteration during development. New splits use latest impl, existing splits unchanged. |
| **No factory registry** | Events + CREATE2 sufficient. Saves 22k gas per creation. Indexers use events anyway. |
| **Lazy unclaimed bitmap** | Only write storage on failure. Happy path: 1 SLOAD. 11% execution savings. |
| **Solady over OpenZeppelin** | Native immutable args support, superior gas optimization. OZ Clones lacks this feature. |
| **`token` not `mint`** | "Mint" means creating tokens in EVM. Avoid confusion. |
| **No close instruction** | EVM has no rent. Contracts persist forever. No reclaim needed. |
| **Self-healing over claim** | Single idempotent interface. Recipients auto-receive on retry. |
| **Clone pattern** | ~83k gas deploy with immutable args. Critical for high-throughput. |
| **Two-step protocol authority** | Higher stakes. Prevent accidental irreversible transfers. |
| **ERC20 only, no native ETH** | Simplifies implementation. USDC is primary use case for x402. |

---

## Constants

```solidity
uint16 public constant PROTOCOL_FEE_BPS = 100;        // 1%
uint16 public constant REQUIRED_SPLIT_TOTAL = 9900;   // 99%
uint8 public constant MIN_RECIPIENTS = 1;
uint8 public constant MAX_RECIPIENTS = 20;
uint256 public constant PROTOCOL_INDEX = MAX_RECIPIENTS;  // Bitmap index for protocol fee (20)
```

**PROTOCOL_INDEX explained:** Recipients use indices 0-19 (up to 20 recipients). Index 20 is reserved for protocol fee unclaimed tracking. This allows a single 21-bit bitmap to track unclaimed status for all parties:
- Bits 0-19: Recipients (one bit per possible recipient slot)
- Bit 20: Protocol fee wallet

**Design note:** Protocol index is placed after recipients (index 20) rather than before (index 0) to enable natural array indexing where `recipients[i]` maps directly to bitmap bit `i`. This avoids off-by-one errors and simplifies loop logic.

### Recipient Limits

**Maximum:** 20 recipients per split

**Rationale:**
- Bounds execution gas to predictable maximum (~150,000 gas for 20 transfers)
- Clone bytecode stays compact (<600 bytes immutable data)
- Covers 99%+ of x402 micropayment use cases (typically 2-5 recipients)
- Bitmap fits cleanly in single storage slot (21 bits for recipients + protocol)

**Duplicate validation:** O(n²) comparison is used for duplicate detection. For 20 recipients, this is ~190 comparisons (~38,000 gas worst case). This is acceptable because:
- Split creation is a one-time cost
- Most splits have 2-5 recipients
- On L2, the absolute cost is negligible (~$0.0001)

**Note:** The limit is defined as a constant. Changing it requires a new factory deployment.

**Comparison with industry:**
- 0xSplits v2: No hard cap (gas limits dictate practical maximum)
- Cascade Splits: Explicit cap for predictable gas costs and simpler UX

---

## Resources

### Core Dependencies
- [Solady LibClone](https://github.com/Vectorized/solady/blob/main/src/utils/LibClone.sol) - Clones with immutable args (factory + reading)
- [Solady ReentrancyGuardTransient](https://github.com/Vectorized/solady/blob/main/src/utils/ReentrancyGuardTransient.sol) - Gas-efficient reentrancy protection via EIP-1153

**Note:** We do NOT use SafeERC20 for self-healing transfers—it reverts on failure. See [Audit Considerations](#self-healing-transfer-wrapper-why-not-safeerc20) for the manual `call()` pattern we use instead.

**Note on CWIA patterns:** See the [critical warning in Gas Optimization](#clones-with-immutable-args) for details on Solady's two incompatible CWIA patterns. We use `LibClone` (modern, bytecode storage) NOT `LibCWIA` (legacy, calldata appending). Reading must use EXTCODECOPY, not `_getArg*()` helpers.

### Standards
- [EIP-1167: Minimal Proxy Contract](https://eips.ethereum.org/EIPS/eip-1167)
- [EIP-1153: Transient Storage](https://eips.ethereum.org/EIPS/eip-1153)

### Related Documentation
- [Glossary](./glossary.md) - Canonical terminology (Solana is source of truth)
- [Solana Specification](./specification.md)

### Related Projects
- [x402 Protocol](https://github.com/coinbase/x402)
- [0xSplits V2 Architecture](https://docs.splits.org/core/split-v2)
- [Base Documentation](https://docs.base.org/)

### Deployment
- [Deterministic Deployment Proxy](https://github.com/Arachnid/deterministic-deployment-proxy)

---

**Last Updated:** 2025-12-02
