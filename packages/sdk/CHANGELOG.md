# Changelog

## [0.3.0] - 2025-11-21

### Added
- Complete `@solana/web3.js` adapter implementation
  - `buildExecuteSplit()` - fetch split config, derive ATAs, build transaction
  - `buildUpdateSplit()` - update recipients with validation
  - `buildCloseSplit()` - close split and recover rent
  - `getSplit()` - fetch and deserialize split config
  - `previewExecution()` - calculate distribution preview
- Complete `@solana/kit` v5 adapter implementation
  - All instruction builders with proper `Rpc<SolanaRpcApi>` types
  - `getSplit()`, `getVaultBalance()`, `getProtocolConfig()`, `previewExecution()`
- Shared deserialization module (`core/deserialization.ts`)
  - `deserializeSplitConfig()` - 1832-byte zero-copy struct with padding
  - `deserializeProtocolConfig()` - 105-byte account
- Proper base58 encoding via `bs58@6.0.0` package
- Account fetching infrastructure for both adapters

### Changed
- **BREAKING:** web3 adapter methods now return implemented functionality instead of throwing errors
- **BREAKING:** Kit adapter now requires `Rpc<SolanaRpcApi>` instead of `Rpc<unknown>`
- Package structure: moved `@solana/kit` from devDependencies to dependencies

### Fixed
- Removed placeholder implementations from all adapter methods
- Corrected SplitConfig size to 1832 bytes (was incorrectly documented as 1792)
- Fixed instruction builder account ordering for execute/update/close operations
- Protocol ATA derivation now uses actual `feeWallet` from protocol config

### Removed
- All TODO comments from codebase
- Placeholder hex encoding workarounds
- Unused `deriveProtocolConfig` imports from instruction builders

## [0.2.0] - 2025-11-19

### Added
- Initial TypeScript SDK release
- Dual-format adapters (@solana/web3.js and @solana/kit)
- Zod validation schemas with 100-share mental model
- Mini schemas for bundler/edge environments
- PDA derivation utilities
- Type definitions for all protocol accounts

### Features
- Create splits with automatic share-to-basis-points conversion
- Read-only methods for split config and vault balance
- Transaction building with compute budget support
- Type-safe schemas with comprehensive validation

### Notes
- web3 and kit adapters had placeholder implementations for execute/update/close
- Account deserialization was not fully implemented
