# Cascade Splits Specification

**Version:** 1.1
**GitHub:** [cascade-protocol/splits](https://github.com/cascade-protocol/splits)
**Target:** Solana payment infrastructure
**Terminology:** [Glossary](./glossary.md)

---

## Overview

Cascade Splits is a non-custodial payment splitting protocol for Solana that automatically distributes incoming payments to multiple recipients based on pre-configured percentages.

**Design Goals:**
- High-throughput micropayments (API calls, streaming payments)
- Minimal compute cost per execution
- Simple, idempotent interface for facilitators
- Permissionless operation

**Key Features:**
- Accept payments to a single vault address
- Automatically split funds to 1-20 recipients
- Mandatory 1% protocol fee (transparent, on-chain enforced)
- Supports SPL Token and Token-2022
- Idempotent execution with self-healing unclaimed recovery
- Multiple configs per authority/mint via unique identifiers
- Integration with x402 payment facilitators

---

## How It Works

### 1. Setup

Authority creates a **split config** defining:
- Token mint (USDC, USDT, etc.)
- Recipients and their percentages (must total 99%)
- Unique identifier (enables multiple configs per authority/mint)

The protocol automatically creates a vault (PDA-owned ATA) to receive payments.

### 2. Payment Flow

```
Payment → Vault (PDA-owned) → execute_split() → Recipients
```

**Without Facilitator:**
1. Payment sent to vault
2. Anyone calls `execute_split()`
3. Funds distributed

**With x402 Facilitator (e.g., PayAI):**
1. Facilitator sends payment to vault address
2. Anyone can call `execute_split` to distribute funds
3. Recipients receive their shares

### 3. Idempotent Execution

`execute_split` is designed to be idempotent and self-healing:
- Multiple calls on the same vault state produce the same result
- Only new funds (vault balance minus unclaimed) are split
- Previously unclaimed amounts are automatically delivered when recipient ATAs become valid
- Facilitators can safely retry without risk of double-distribution

---

## Core Concepts

### PDA Vault Pattern

- Vault is an Associated Token Account owned by a Program Derived Address (PDA)
- No private keys = truly non-custodial
- Funds can only be moved by program instructions

### Self-Healing Unclaimed Recovery

If a recipient's ATA is missing, invalid, or frozen during execution:
1. Their share is recorded as "unclaimed" and stays in vault
2. Unclaimed funds are protected from re-splitting
3. On subsequent `execute_split` calls, the system automatically attempts to clear unclaimed
4. Once recipient creates their ATA (or account is thawed if frozen), funds are delivered on the next execution
5. No separate claim instruction needed - single interface for all operations

**Frozen Accounts**: Token-2022 tokens using sRFC-37 DefaultAccountState::Frozen are supported. Frozen recipient accounts trigger the same unclaimed flow as missing accounts.

Recipients can trigger `execute_split` themselves to retrieve unclaimed funds, even when no new payments exist. This gives recipients agency over their funds without depending on facilitators.

### Protocol Fee

- **Fixed 1%** enforced by program (transparent, cannot be bypassed)
- Recipients control the remaining 99%
- Example: `[90%, 9%]` = 99% total ✅
- Invalid: `[90%, 10%]` = 100% total ❌

**Design Decision:** Fee percentage is hardcoded for transparency. Integrators can verify the exact fee on-chain. If fee changes are needed, protocol will redeploy.

### Multiple Configs per Authority

Each split config includes a `unique_id` allowing an authority to create multiple configurations for the same token:
- Facilitator managing multiple merchants
- Different split ratios for different products
- Parallel config creation without contention

### ATA Lifecycle Strategy

**At config creation:** All recipient ATAs must exist. This:
- Ensures recipients are ready to receive funds
- Protects facilitators from ATA creation costs (0.002 SOL × recipients)
- Prevents malicious configs designed to drain facilitators

**During execution:** Missing ATAs are handled gracefully. If a recipient accidentally closes their ATA:
- Their share goes to unclaimed (protected from re-splitting)
- Other recipients still receive funds
- Funds auto-deliver when ATA is recreated

This design optimizes for both security (creation) and reliability (execution).

---

## Account Structure

### ProtocolConfig (PDA)

Global protocol configuration (single instance).

```rust
#[account(zero_copy)]
pub struct ProtocolConfig {
    pub authority: Pubkey,         // Can update config
    pub pending_authority: Pubkey, // Pending authority for two-step transfer
    pub fee_wallet: Pubkey,        // Receives protocol fees
    pub bump: u8,                  // Stored for CU optimization
}
```

**Seeds:** `[b"protocol_config"]`

**Usage:** Constraints use `bump = protocol_config.bump` to avoid on-chain PDA derivation.

**Two-Step Authority Transfer:** To prevent accidental irreversible transfers, authority changes require:
1. Current authority calls `transfer_protocol_authority` → sets `pending_authority`
2. New authority calls `accept_protocol_authority` → completes transfer

The pending transfer can be cancelled by calling `transfer_protocol_authority` with `Pubkey::default()`.

### SplitConfig (PDA)

Per-split configuration. Uses zero-copy for optimal compute efficiency.

```rust
#[account(zero_copy)]
#[repr(C)]
pub struct SplitConfig {
    pub version: u8,                              // Schema version
    pub authority: Pubkey,                        // Can update/close config
    pub mint: Pubkey,                             // Token mint
    pub vault: Pubkey,                            // Payment destination
    pub unique_id: Pubkey,                        // Enables multiple configs
    pub bump: u8,                                 // Stored for CU optimization
    pub recipient_count: u8,                      // Active recipients (1-20)
    pub recipients: [Recipient; 20],              // Fixed array, use recipient_count
    pub unclaimed_amounts: [UnclaimedAmount; 20], // Fixed array
    pub protocol_unclaimed: u64,                  // Protocol fees awaiting claim
    pub last_activity: i64,                       // Timestamp of last execution
    pub rent_payer: Pubkey,                       // Who paid rent (for refund on close)
}

#[repr(C)]
pub struct Recipient {
    pub address: Pubkey,
    pub percentage_bps: u16,            // 1-9900 (0.01%-99%)
}

#[repr(C)]
pub struct UnclaimedAmount {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
```

**Seeds:** `[b"split_config", authority, mint, unique_id]`

**Space Allocation:** Fixed size for all configs (1,832 bytes). Zero-copy provides ~50% serialization CU savings, critical for high-throughput micropayments. The fixed rent (~0.015 SOL) is negligible compared to cumulative compute savings.

**Payer Separation:** The `rent_payer` field tracks who paid rent for the account, enabling:
- **Sponsored rent:** Protocol or third party pays rent on behalf of user
- **Proper refunds:** On close, rent returns to original payer, not authority

The `authority` controls the config (update, close), while `rent_payer` receives the rent refund. These can be the same address (user pays own rent) or different (sponsored).

**Activity Tracking:** The `last_activity` timestamp is updated on every `execute_split`. This enables future capability for:
- Stale account cleanup (recover rent from abandoned accounts after inactivity period)

Currently, only the authority can close accounts. The activity tracking reserves the option to add permissionless cleanup of inactive accounts in a future version without breaking changes.

---

## Instructions

### initialize_protocol

One-time protocol initialization.

**Authorization:** Deployer (first call only)

**Parameters:**
- `fee_wallet`: Address to receive protocol fees

### update_protocol_config

Updates protocol fee wallet.

**Authorization:** Protocol authority

**Parameters:**
- `new_fee_wallet`: New address for protocol fees

### transfer_protocol_authority

Proposes transfer of protocol authority to a new address.

**Authorization:** Protocol authority

**Parameters:**
- `new_authority`: Address to receive authority (or `Pubkey::default()` to cancel)

**Note:** This only sets `pending_authority`. The new authority must call `accept_protocol_authority` to complete the transfer.

### accept_protocol_authority

Accepts a pending protocol authority transfer.

**Authorization:** Pending authority (must match `pending_authority` in config)

**Parameters:** None

**Note:** Completes the two-step transfer and clears `pending_authority`.

### create_split_config

Creates a new payment split configuration.

**Authorization:** Anyone (becomes authority)

**Accounts:**
- `payer` - Pays rent for account creation (recorded as `rent_payer`)
- `authority` - Controls the config (update, close)

The payer and authority can be the same address (user pays own rent) or different (sponsored rent).

**Validation:**
- 1-20 recipients
- Total exactly 9900 bps (99%)
- No duplicate recipients
- No zero addresses
- No zero percentages
- All recipient ATAs must exist

*Note: Requiring pre-existing ATAs protects payment facilitators from ATA creation costs (0.002 SOL × recipients). Config creators ensure their recipients are ready before setup.*

*Note: Recipients can be PDAs (multisig vaults, DAO treasuries, other protocols). The controlling program must have logic to withdraw from the ATA - the protocol only transfers to the ATA, not beyond.*

**Example:**
```typescript
import { createSplitConfig } from "@cascade-fyi/splits-sdk/solana";

const { instruction, vault } = await createSplitConfig({
  authority: wallet,
  recipients: [
    { address: "Agent111111111111111111111111111111111111111", share: 90 },
    { address: "Marketplace1111111111111111111111111111111", share: 10 },
  ],
});
```

### execute_split

Distributes vault balance to recipients. Self-healing: also clears any pending unclaimed amounts.

**Authorization:** Permissionless (anyone can trigger)

**Required Accounts:**
```typescript
remaining_accounts: [
  recipient_1_ata,    // Canonical ATA for first recipient
  recipient_2_ata,    // Canonical ATA for second recipient
  // ... one per recipient in config order
  protocol_ata        // Protocol fee wallet canonical ATA (last)
]
```

**Important**: All ATAs must be canonical Associated Token Accounts derived via `get_associated_token_address_with_program_id()`. Non-canonical token accounts are rejected to prevent UX issues where recipients don't monitor non-standard accounts.

The instruction validates that `remaining_accounts.len() >= recipient_count + 1`.

**Logic:**
1. Calculate available funds: `vault_balance - total_unclaimed - protocol_unclaimed`
2. If available > 0:
   - Calculate each recipient's share (floor division)
   - Attempt transfer to each recipient
   - If transfer fails → record as unclaimed (protected)
   - Calculate protocol fee (1% + rounding dust)
   - Attempt transfer to protocol
   - If protocol transfer fails → add to `protocol_unclaimed`
3. Attempt to clear all unclaimed amounts:
   - For each recipient entry, check if ATA now exists
   - If valid → transfer exact recorded amount, remove entry
   - If still invalid → keep in unclaimed
4. Attempt to clear protocol unclaimed:
   - If protocol ATA exists → transfer `protocol_unclaimed`, reset to 0
   - No additional fee charged on clearing (fee was calculated on original split)

**Idempotency:** Safe to call multiple times. Only new funds are split. Unclaimed funds cannot be redistributed to other recipients.

### update_split_config

Authority updates recipient list while preserving the vault address.

**Authorization:** Config authority

**Requirements:**
- Vault must be empty (execute pending splits first)
- All `unclaimed_amounts` must be zero
- `protocol_unclaimed` must be zero
- 1-20 recipients
- Total exactly 9900 bps (99%)
- No duplicate recipients
- No zero addresses
- No zero percentages
- All recipient ATAs must exist

**Use Case:** The splitConfig address (PDA) is the stable public interface for x402 payments—facilitators derive the vault ATA automatically. When business arrangements change (new partners, revised percentages), the authority can update the split without requiring payers to change their payment destination.

**Design Decision:** Vault must be empty to ensure funds are always split according to the rules active when they were received.

### close_split_config

Closes config and vault, reclaiming all rent.

**Authorization:** Config authority

**Accounts:**
- `authority` - Must match config authority (authorizes close)
- `rent_destination` - Must match config `rent_payer` (receives rent refund)
- `vault` - Vault ATA (closed via CPI to token program)
- `token_program` - Token program owning the vault

**Requirements:**
- Vault must be empty (balance = 0)
- All unclaimed amounts must be zero
- Protocol unclaimed must be zero

**Rent Recovery:**
- Config account rent: ~0.015 SOL (1,832 bytes)
- Vault ATA rent: ~0.002 SOL (165 bytes)
- **Total recovered**: ~0.017 SOL

The rent is refunded to the original `rent_payer`, not necessarily the authority. This enables sponsored rent where a third party pays rent but the user controls the config.

---

## x402 Integration

### Merchant Configuration

Set `payTo` to the **splitConfig address** (PDA), not the vault. Per [x402 SVM spec](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md), facilitators derive the destination: `ATA(owner=payTo, mint=asset)`.

This makes `payTo` token-agnostic—same address works for USDC, USDT, or any supported token.

### Automatic Detection

After payment, facilitators can detect split vaults by checking if the derived destination is a token account owned by a SplitConfig PDA:

```typescript
async function detectSplitVault(destination: PublicKey): Promise<SplitConfig | null> {
  const accountInfo = await connection.getAccountInfo(destination);
  if (!accountInfo) return null;

  const tokenAccount = decodeTokenAccount(accountInfo.data);

  try {
    const splitConfig = await program.account.splitConfig.fetch(
      tokenAccount.owner  // PDA that owns the vault
    );

    if (splitConfig.vault.equals(destination)) {
      return splitConfig;
    }
  } catch {
    // Not a split vault
  }

  return null;
}
```

### Facilitator Benefits

- **Single interface:** Only `execute_split` needed (self-healing handles unclaimed)
- **Idempotent:** Safe to retry on network failures
- **No ATA creation costs:** Protocol holds funds for missing ATAs, doesn't require facilitator to create them
- **Multiple merchants:** Use `unique_id` to manage many configs with same token

---

## Token Support

| Token Type | Support | Notes |
|------------|---------|-------|
| SPL Token | ✅ Full | Standard tokens |
| Token-2022 | ✅ Full | See extensions below |
| Native SOL | ❌ No | Use wrapped SOL |

**Token-2022 Extensions:**
- ✅ **Transfer Fees**: Recipients receive net amounts after token's fees. Transfer fee is separate from 1% protocol fee.
- ✅ **sRFC-37 (Frozen Accounts)**: Frozen accounts automatically trigger unclaimed flow. Funds held until account is thawed. See [sRFC-37](https://forum.solana.com/t/srfc-37-efficient-block-allow-list-token-standard/4036).
- ✅ **Transfer Hooks**: Program invokes transfer hooks per Token-2022 spec. Hook failures revert the transaction.
- ✅ **Interest-Bearing**: Supported. Interest accrues to vault before distribution.
- ⚠️ **Confidential Transfer**: Supported but requires proper account setup by recipients.

**Note on Frozen Accounts**: Tokens using sRFC-37 DefaultAccountState::Frozen (e.g., tokens with allowlists/blocklists) are supported. If a recipient's account is frozen during execution, their share is held as unclaimed until the account is thawed by the Gate Program.

**⚠️ Vault Freeze Warning**: Token issuers with freeze authority can freeze the vault account itself, not just recipient accounts. If the vault is frozen, all funds are locked and no distributions can occur. There is no protocol-level recovery mechanism. When using tokens with freeze authority (e.g., regulated stablecoins), users accept that the token issuer has ultimate control over fund movement.

---

## Events

All operations emit events for indexing:

| Event | Description |
|-------|-------------|
| `ProtocolConfigCreated` | Protocol initialized |
| `ProtocolConfigUpdated` | Fee wallet changed |
| `ProtocolAuthorityTransferProposed` | Authority transfer proposed |
| `ProtocolAuthorityTransferAccepted` | Authority transfer completed |
| `SplitConfigCreated` | New split config created |
| `SplitExecuted` | Payment distributed (includes `held_as_unclaimed` field) |
| `SplitConfigUpdated` | Config recipients modified |
| `SplitConfigClosed` | Config deleted, rent reclaimed |

**SplitExecuted Event Details:**
```rust
pub struct SplitExecuted {
    pub config: Pubkey,
    pub vault: Pubkey,
    pub total_amount: u64,              // Total vault balance processed
    pub recipients_distributed: u64,     // Amount sent to recipients
    pub protocol_fee: u64,              // Amount sent to protocol
    pub held_as_unclaimed: u64,         // Amount added to unclaimed
    pub unclaimed_cleared: u64,         // Amount cleared from previous unclaimed
    pub protocol_unclaimed_cleared: u64, // Protocol fees cleared
    pub executor: Pubkey,
    pub timestamp: i64,
}
```

**Use Case:** Build indexer to track all configs, executions, and analytics.

---

## Error Codes

| Code | Description |
|------|-------------|
| `InvalidRecipientCount` | Recipients count not in 1-20 range |
| `InvalidSplitTotal` | Percentages don't sum to 9900 bps |
| `DuplicateRecipient` | Same address appears twice |
| `ZeroAddress` | Recipient address is zero |
| `ZeroPercentage` | Recipient percentage is zero |
| `RecipientATADoesNotExist` | Required ATA not found |
| `RecipientATAInvalid` | ATA is not the canonical derived address |
| `RecipientATAWrongOwner` | ATA owner doesn't match recipient |
| `RecipientATAWrongMint` | ATA mint doesn't match config |
| `VaultNotEmpty` | Vault must be empty for this operation |
| `InvalidVault` | Vault doesn't match config |
| `InsufficientRemainingAccounts` | Not enough accounts provided |
| `MathOverflow` | Arithmetic overflow |
| `MathUnderflow` | Arithmetic underflow |
| `InvalidProtocolFeeRecipient` | Protocol ATA validation failed |
| `Unauthorized` | Signer not authorized |
| `AlreadyInitialized` | Protocol already initialized |
| `UnclaimedNotEmpty` | Unclaimed amounts must be cleared first |
| `InvalidTokenProgram` | Token account owned by wrong program |
| `NoPendingTransfer` | No pending authority transfer to accept |
| `InvalidRentDestination` | Rent destination doesn't match original payer |

---

## Security

### Implemented Protections

- ✅ Non-custodial (PDA-owned vaults)
- ✅ Idempotent execution (unclaimed funds protected from re-splitting)
- ✅ Overflow/underflow checks (all math uses `checked_*`)
- ✅ Duplicate recipient validation
- ✅ Bounded account size (max 20 recipients)
- ✅ Protocol fee enforcement (cannot be bypassed)
- ✅ Configurable protocol wallet
- ✅ Fixed space allocation (zero-copy)

### Known Limitations

- No pause mechanism (redeploy if critical issue found)
- Single authority per config (use Squads multisig as authority for multi-sig control)
- Unclaimed funds never expire
- Vault freeze risk: Token-2022 issuers with freeze authority can freeze the vault directly, locking all funds with no protocol-level recovery (see Token Support section)

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Hardcoded 1% fee** | Transparency for integrators. Anyone can verify on-chain. Avoids calculation complexity and potential bugs. Protocol redeploys if fee change needed. |
| **Empty vault for updates** | Ensures funds are split according to rules active when received. Prevents race conditions. |
| **Update preserves vault address** | Vault address is the stable public interface. Payers shouldn't need to update their systems when business arrangements change. |
| **unique_id over counter** | Client generates (no on-chain state management). Enables parallel creation without contention. Simple implementation. |
| **Self-healing over separate claim** | Single idempotent interface for facilitators. Simplifies integration. Recipients auto-receive on next execution. No additional flow to maintain. |
| **Protocol unclaimed tracking** | Enables permissionless support for any token. Protocol doesn't need to pre-create ATAs for every possible token. Fees are preserved until protocol ATA exists. |
| **Zero-copy with fixed arrays** | ~50% serialization CU savings. Fixed rent (~0.015 SOL) is negligible vs cumulative compute savings across thousands of transactions. Critical for high-throughput micropayments. |
| **Stored bumps** | All PDAs store their bump. Constraints use stored bump instead of deriving, saving ~1,300 CU per account validation. |
| **remaining_accounts pattern** | Recipient count is variable (1-20). Anchor requires dynamic account lists via remaining_accounts. Accounts in config order with protocol ATA last. |
| **Minimal logging** | Production builds avoid `msg!` statements. Each costs ~100-200 CU. Debug logging via feature flag. |
| **No streaming/partial splits** | Different product category (see Streamflow, Zebec). Cascade Splits is for instant one-time splits. |
| **No native SOL** | Adds complexity. Use wrapped SOL instead. |
| **No built-in multi-sig** | Use Squads/Realms as authority. Works with current design without added complexity. |
| **Pre-existing ATAs required** | Protects facilitators from being drained by forced ATA creation (0.002 SOL each). Config creators responsible for recipient readiness. |
| **Two-step authority transfer** | Prevents accidental irreversible authority transfers. Current authority proposes, new authority accepts. Can be cancelled before acceptance. |
| **Payer separation** | Separates rent payer from authority. Enables sponsored rent (protocol/third party pays) while user retains control. Rent refunds go to original payer, not authority. |
| **Activity timestamp tracking** | Enables future stale account cleanup without breaking changes. Updated on every execution. |
| **Frozen account detection** | sRFC-37 tokens with DefaultAccountState::Frozen are detected before transfer attempts (~300 CU per recipient). Frozen accounts trigger unclaimed flow rather than transaction failure. Minimal overhead for compatibility with allowlist/blocklist tokens. |
| **Vault rent recovery on close** | Close instruction closes both config and vault via CPI, recovering all rent (~0.017 SOL total). Adds ~5,000 CU to close operation but ensures no rent is left behind. |
| **Canonical ATA enforcement** | All recipient and protocol ATAs must be canonical derived addresses. Prevents funds from being sent to non-standard accounts that recipients may not monitor. Consistent with security best practices. |

---

## Technical Details

**Dependencies:**
```toml
anchor-lang = "0.32.1"
anchor-spl = "0.32.1"
```

**Constants:**
```rust
PROTOCOL_FEE_BPS: u16 = 100;       // 1%
REQUIRED_SPLIT_TOTAL: u16 = 9900;  // Recipients must total 99%
MIN_RECIPIENTS: usize = 1;
MAX_RECIPIENTS: usize = 20;
```

**Fixed Space (Zero-Copy):**
```rust
// SplitConfig size (fixed for all configs)
pub const SPLIT_CONFIG_SIZE: usize =
    8 +                     // discriminator
    1 +                     // version
    32 +                    // authority
    32 +                    // mint
    32 +                    // vault
    32 +                    // unique_id
    1 +                     // bump
    1 +                     // recipient_count
    (34 * 20) +             // recipients [Recipient; 20]
    (48 * 20) +             // unclaimed_amounts [UnclaimedAmount; 20]
    8 +                     // protocol_unclaimed
    8 +                     // last_activity
    32;                     // rent_payer
    // Total: 1,832 bytes

// ProtocolConfig size
pub const PROTOCOL_CONFIG_SIZE: usize =
    8 +                     // discriminator
    32 +                    // authority
    32 +                    // pending_authority
    32 +                    // fee_wallet
    1;                      // bump
    // Total: 105 bytes
```

**Compute Budget:**
Current compute unit consumption (as of 2025-11-26):

| Instruction | 1 recipient | 5 recipients | 20 recipients |
|-------------|-------------|--------------|---------------|
| execute_split | 28,505 CU | 68,573 CU | 211,703 CU |
| create_split_config | 36,590 CU | 40,024 CU | N/A |
| close_split_config | 10,168 CU | N/A | N/A |
| update_split_config | N/A | 7,424 CU (to 2) | 14,032 CU (to 10) |

For high-throughput micropayments, set explicit CU limits based on recipient count:
```typescript
// Conservative estimate: 30,000 base + (3,500 * recipient_count)
const computeUnits = 30_000 + (recipientCount * 3_500);

transaction.add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })
);
```

Latest benchmarks: [docs/benchmarks/compute_units.md](../benchmarks/compute_units.md)

**Logging:**
Production builds use minimal logging to save compute. Debug logging available via feature flag:
```rust
#[cfg(feature = "verbose")]
msg!("Debug: {}", value);
```

**Program ID:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

---

## Resources

- **GitHub:** https://github.com/cascade-protocol/splits
- **SDK:** `@cascade-fyi/splits-sdk`
- **Usage Guide:** [docs/usage.md](./usage.md)
- **Contact:** hello@cascade.fyi

---

**Last Updated:** 2025-11-29
