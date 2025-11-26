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
`SplitConfig` is 1,832 bytes with `#[repr(C)]` padding. Changing fields **breaks deserialization**.

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
- Split Config: `["split_config", authority, mint, unique_id]` - 1,832 bytes
- Vault: ATA with split_config as owner

## SDK

Dual format with identical APIs:
```typescript
import { web3 } from '@cascade-fyi/splits-sdk';  // @solana/web3.js
import { kit } from '@cascade-fyi/splits-sdk';   // @solana/kit
```

Instruction serialization is manual (not IDL-generated) - account order matters.

## Release Process

### Pre-Release Version Checklist

**CRITICAL:** Update ALL versions before building. Missing any causes metadata inconsistencies.

1. **Program Version** (`programs/cascade-splits/Cargo.toml`)
   - Minor bump (0.X.0): new features, behavior changes
   - Patch bump (0.0.X): bug fixes only

2. **CHANGELOG** (`programs/cascade-splits/CHANGELOG.md`)
   - Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
   - Valid categories: Added, Changed, Deprecated, Removed, Fixed, Security
   - Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` on release
   - Include CU impact inline (e.g., "+300 CU")
   - Update version links at bottom

3. **Specification Version** (`docs/specification.md`)
   - Update `**Version:** X.Y` (top)
   - Update `**Last Updated:** YYYY-MM-DD` (bottom)

4. **SDK Version** (`packages/sdk/package.json`) - ONLY if SDK API changes
   - Skip if only on-chain validation changed

5. **Commit Version Updates** (conventional commits)
   ```bash
   git add -A
   git commit -m "chore: release vX.Y.Z"
   ```

### Build & Test Pipeline

**CRITICAL:** Use `--skip-build` everywhere after initial build to ensure exact binary is tested/deployed.

**NOTE:** `anchor deploy` creates NEW program addresses. Use `anchor upgrade` to upgrade existing programs.

```bash
# 0. Set variables once (use everywhere)
VERSION="X.Y.Z"
DEPLOYER="~/.config/solana/deployer.json"

# 1. Pre-flight checks - formatting, linting & tests
cargo fmt --all --check || { echo "Error: Run 'cargo fmt --all'"; exit 1; }
cargo clippy --all-targets --all-features -- -D warnings || { echo "Error: Fix clippy warnings"; exit 1; }
pnpm -w check || { echo "Error: Fix formatting/linting in TypeScript"; exit 1; }
pnpm -w test:all || { echo "Error: Fix failing tests"; exit 1; }

# 2. Pre-flight checks - git & balances
git diff --quiet || { echo "Error: Uncommitted changes"; exit 1; }
git diff --cached --quiet || { echo "Error: Staged changes"; exit 1; }
echo "Devnet balance:" && solana balance --url devnet --keypair $DEPLOYER
echo "Mainnet balance:" && solana balance --url mainnet-beta --keypair $DEPLOYER
echo "Pre-flight checks passed. Proceeding..."

# 3. ONE verifiable build (Docker-based, deterministic)
anchor build --verifiable

# 4. Sync build artifacts for testing
cp target/verifiable/cascade_splits.so target/deploy/cascade_splits.so
cp target/idl/cascade_splits.json packages/sdk/idl.json

# 5. Test on localnet with EXACT verifiable build (no rebuild)
anchor test --skip-build --provider.cluster localnet

# 6. Upgrade devnet (uses verifiable binary)
anchor upgrade target/verifiable/cascade_splits.so \
  --program-id SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB \
  --provider.cluster devnet \
  --provider.wallet $DEPLOYER

# 7. Test DEPLOYED program on devnet (no rebuild, no deploy)
# If tests fail: fix issues, rebuild from step 3, don't proceed to mainnet
anchor test --skip-build --skip-deploy --provider.cluster devnet

# 8. Commit to git (devnet validated, ready for mainnet)
git add -A
git commit -m "chore: release v${VERSION}"

# 9. Upgrade mainnet (SAME exact verifiable binary)
anchor upgrade target/verifiable/cascade_splits.so \
  --program-id SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB \
  --provider.cluster mainnet \
  --provider.wallet $DEPLOYER

# 10. Test DEPLOYED program on mainnet (no rebuild, no deploy)
anchor test --skip-build --skip-deploy --provider.cluster mainnet

# 11. Tag and push (mainnet validated, ready for production)
git tag "v${VERSION}"
git push origin main --tags

# 12. Verify build + upload PDA + submit remote job
yes | solana-verify verify-from-repo --remote \
  --url https://api.mainnet-beta.solana.com \
  --program-id SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB \
  https://github.com/cascade-protocol/splits \
  --library-name cascade_splits \
  --commit-hash $(git rev-parse HEAD) \
  --keypair $DEPLOYER

# If rate limited, wait and submit separately:
solana-verify remote submit-job \
  --program-id SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB \
  --uploader <PROGRAM_AUTHORITY> \
  --url https://api.mainnet-beta.solana.com
```

Verify at: `https://verify.osec.io/status/SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB`

### Post-Deployment

```bash
# 1. Verify build on osec.io
# Check: https://verify.osec.io/status/SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB

# 2. Create GitHub release from CHANGELOG
python3 scripts/extract-changelog.py "$VERSION" programs/cascade-splits/CHANGELOG.md > /tmp/release-notes.md
gh release create "v${VERSION}" --title "v${VERSION}" --notes-file /tmp/release-notes.md --verify-tag

# 3. Publish SDK to npm (if SDK version changed)
cd packages/sdk
pnpm build && pnpm test:sdk  # Ensure SDK builds and tests pass
pnpm publish
cd ../..
```

**CHANGELOG Maintenance:**
- Keep `[Unreleased]` section for ongoing work
- Move to versioned section only on release
- Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
- Include breaking changes prominently

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
