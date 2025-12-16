---
title: Glossary
description: Canonical terminology for Cascade Splits protocol
sidebar:
  order: 3
---

Canonical terminology for Cascade Splits. **Solana program is the source of truth** - EVM adapts where platform requires.

## Accounts & Contracts

| Term | Definition |
|------|------------|
| **ProtocolConfig** | Global singleton storing protocol settings: authority, pending authority, fee wallet. |
| **SplitConfig** | Per-split configuration storing: authority, token, vault, recipients, unclaimed amounts. |
| **Vault** | Token account holding funds pending distribution. On Solana: ATA owned by SplitConfig PDA. On EVM: balance held by SplitConfig contract itself. |

## Data Structures

| Term | Definition |
|------|------------|
| **Recipient** | Entry in SplitConfig: wallet address + percentage in basis points. |
| **UnclaimedAmount** | Funds held when recipient transfer fails. Automatically retried on next execution. |

## Values

| Term | Definition |
|------|------------|
| **percentage_bps** | On-chain recipient percentage in basis points. 99 bps = 1%. Recipients must sum to 9900 bps (99%). |
| **share** | SDK/UI percentage (1-100). Converted to bps via `share × 99`. |
| **protocol_fee** | Fixed 1% (100 bps) taken from each distribution. |

## Instructions

| Instruction | Description |
|-------------|-------------|
| **create_split_config** | Create new SplitConfig with recipients. |
| **execute_split** | Distribute vault balance to recipients. Permissionless. |
| **update_split_config** | Change recipients. Requires empty vault, no unclaimed. *(Solana only)* |
| **close_split_config** | Delete SplitConfig, recover rent. *(Solana only)* |

## Protocol Instructions

| Instruction | Description |
|-------------|-------------|
| **initialize_protocol** | Create ProtocolConfig. One-time setup. |
| **update_protocol_config** | Change fee wallet. |
| **transfer_protocol_authority** | Start two-step authority transfer. |
| **accept_protocol_authority** | Complete authority transfer. |

## Platform Adaptations

Where platforms diverge from canonical terms:

| Concept | Solana | EVM | Reason |
|---------|--------|-----|--------|
| Token reference | `mint` | `token` | "Mint" means creating tokens in EVM |
| Case convention | `snake_case` | `camelCase` | Platform convention |
| Recipient updates | Supported | Not supported | EVM uses immutable args for gas optimization |
| Close/reclaim | Supported | Not applicable | EVM has no rent model |
| Vault location | Separate ATA | Contract balance | Platform architecture |
| Vault address | Different from SplitConfig PDA | Same as SplitConfig address | EVM splits hold funds directly |
| ProtocolConfig | Separate account | Embedded in SplitFactory | Factory IS the protocol config |
| initialize_protocol | Explicit instruction | Constructor | One-time at factory deploy |

## SDK Naming

SDK follows on-chain names, adapting case per platform:

```typescript
// Solana SDK
createSplitConfig(...)
executeSplit(...)
updateSplitConfig(...)
closeSplitConfig(...)

// EVM SDK
createSplitConfig(...)
executeSplit(...)
// No update/close on EVM
```

**Types use PascalCase on both platforms:**
- `SplitConfig`
- `ProtocolConfig`
- `Recipient`

## Identifier Convention

The **vault address** is the primary user-facing identifier for a split:
- It's what users deposit to
- It's what appears in block explorers
- SDK functions accept vault to look up SplitConfig

```typescript
// Both platforms: vault is the deposit address
getSplit(vault)        // Returns SplitConfig
executeSplit(vault)    // Distributes vault balance
```
