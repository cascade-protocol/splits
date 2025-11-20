# Cascade Splits

Permissionless payment splitter. Distributes tokens from vault to recipients by percentage.

**Program ID:** `SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

## Critical Gotchas

### 1. Unclaimed Flow (Most Important)
Missing recipient ATAs don't cause errors - amounts are **held as unclaimed** in state:
- `execute_split` checks `data_is_empty()` before transfer
- If missing: stores in `unclaimed_amounts[i]`
- Next execution auto-clears if ATA now exists
- **Cannot close/update split until all unclaimed = 0**

### 2. Remaining Accounts Order
```
execute_split: [recipient_ata_0, ..., recipient_ata_N, protocol_ata_LAST]
```
Protocol ATA accessed via `.last().unwrap()` - will panic if missing or wrong position.

### 3. Zero-Copy Struct Size
`SplitConfig` is 1792 bytes with `#[repr(C)]` padding. Changing fields **breaks deserialization**.

### 4. Percentage Math
- Recipients must sum to **9900 bps** (99%)
- Protocol gets 1% + rounding dust
- Math: `(amount * bps) / 10000` rounds DOWN

### 5. Update/Close Requires Empty State
- Vault must be empty (execute first to distribute)
- All `unclaimed_amounts` must be zero
- `protocol_unclaimed` must be zero

### 6. Two-Step Authority Transfer
Protocol authority transfer requires two transactions:
1. `transfer_protocol_authority` - Sets `pending_authority` (current authority signs)
2. `accept_protocol_authority` - Completes transfer (new authority signs)

Can be overwritten by calling transfer again. Cancel by setting to `Pubkey::default()`.

## Architecture

```
User Payment → Vault (ATA owned by SplitConfig PDA)
             → execute_split (permissionless)
                → Recipients OR unclaimed
                → Protocol fee (1%)
```

**PDAs:**
- Protocol Config: `["protocol_config"]` - singleton, 105 bytes
- Split Config: `["split_config", authority, mint, unique_id]` - 1792 bytes
- Vault: ATA with split_config as owner

## SDK

Dual format with identical APIs:
```typescript
import { web3 } from '@cascade-labs/splits';  // @solana/web3.js
import { kit } from '@cascade-labs/splits';   // @solana/kit
```

Instruction serialization is manual (not IDL-generated) - account order matters.

## Testing

| Layer | Location | Framework | Command |
|-------|----------|-----------|---------|
| Unit | `programs/*/src/*.rs` | `#[cfg(test)]` | `cargo test --lib` |
| Instruction | `programs/*/tests/` | Mollusk | `cargo test` |
| SDK | `sdk/tests/` | Vitest + LiteSVM | `pnpm test:sdk` |
| Smoke | `tests/` | Vitest + Anchor | `pnpm test` |

```bash
pnpm test:all    # Run everything
```

**Principle:** Mollusk tests all errors. Smoke tests only Token-2022 CPI and real network behavior.
