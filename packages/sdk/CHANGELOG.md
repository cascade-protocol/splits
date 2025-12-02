# Changelog

## [0.8.0] - 2025-12-02

### Added

- **`executeAndConfirmSplit()`** - High-level helper that builds, signs, sends, and confirms split execution in one call
  - `ExecuteAndConfirmOptions` - Configuration for minimum balance threshold, commitment, abort signal, and compute budget
  - `ExecuteAndConfirmResult` - Discriminated union for type-safe result handling
  - `minBalance` option for micropayment batching - skip execution if vault balance below threshold
  - `abortSignal` option for timeout/cancellation support - matches `@solana/kit` patterns
  - `computeUnitLimit` and `computeUnitPrice` options for priority fee support during network congestion
  - `programErrorCode` in error results for debugging on-chain failures
  - Auto-detects Token-2022 from vault account owner (no manual tokenProgram needed)
  - Uses WebSocket-based confirmation via `@solana/kit`'s `sendAndConfirmTransactionFactory` (no polling)

- **`isCascadeSplit()` caching** - Automatic caching of split detection results for RPC efficiency
  - Positive results cached indefinitely (vault is a split)
  - Negative results cached for existing accounts (can't become a split)
  - Non-existent accounts NOT cached (could be created as split later)
  - RPC errors NOT cached (transient failures should retry)
  - ~75% reduction in RPC calls for high-volume facilitators

- **Cache control functions**
  - `invalidateSplitCache(vault)` - Clear cache for specific vault
  - `clearSplitCache()` - Clear entire split detection cache
  - `invalidateProtocolConfigCache()` - Clear protocol config cache

- **Protocol config caching** - Automatic caching with self-healing on fee_wallet changes
  - Cached after first fetch, saves 1 RPC per `executeSplit`
  - Auto-invalidates and retries on `InvalidProtocolFeeRecipient` error
  - Zero coordination needed when protocol changes fee_wallet

### Internal

- New `execute.ts` module for transaction execution helpers
- Clean separation: `instructions.ts` (build) vs `execute.ts` (execute)
- Added `@solana-program/compute-budget` dependency for priority fees

## [0.7.1] - 2025-11-30

### Fixed

- Browser compatibility: replaced Node.js `Buffer` with native APIs

## [0.7.0] - 2025-11-29

### BREAKING CHANGES
- **Complete API restructure**: `/web3` and `/kit` exports replaced with unified `/solana` export
- **Removed**: `kit/`, `web3/`, `react/` modules entirely
- **Removed**: `SplitsProvider`, React hooks (`useSplits`, `useCreateSplit`, etc.)
- **Removed**: Zod schemas (`schemas.ts`, `schemas-mini.ts`)
- **Removed**: Old instruction builders

### Added
- Codama-generated instruction encoders in `/solana/generated`
- Manual instruction builders with correct remaining accounts:
  - `createSplitConfig` - includes recipient ATAs as remaining accounts
  - `executeSplit` - returns discriminated union `{ ok, instruction }` or `{ ok: false, reason }`
  - `updateSplitConfig` - includes recipient ATAs for validation
  - `closeSplitConfig` - recovers vault rent
- Web3.js compatibility bridge (`/solana/web3-compat`):
  - `toAddress()`, `toPublicKey()`, `toKitSigner()`
  - `toWeb3Instruction()`, `fromWeb3Instruction()`
- Helper utilities:
  - `getSplitConfigFromVault()` - vault-centric API
  - `getProtocolConfig()`, `getVaultBalance()`, `isCascadeSplit()`
  - PDA derivation: `deriveSplitConfig()`, `deriveVault()`, `deriveAta()`
  - `generateUniqueId()` for random unique IDs

### Changed
- SDK now requires `@solana/kit` as peer dependency
- Main export provides types, constants, and conversion helpers only
- All Solana functionality moved to `/solana` subpath

## [0.6.0] - 2025-11-26

### Changed
- Compatible with on-chain program v0.3.0
- `buildCloseSplit` requires `tokenProgram` account for vault closure

### Fixed
- Kit adapter: `vault` account now WRITABLE in `buildCloseSplit` (was READONLY)
- Updated IDL to match program v0.3.0

## [0.5.2] - 2025-11-25

### Added
- `address` field to `SplitWithBalance` for PDA identification

## [0.5.1] - 2025-11-24

### Fixed
- Package metadata for npm publish

## [0.5.0] - 2025-11-23

### Added
- React hooks for split management (`useSplits`, `useCreateSplit`, `useExecuteSplit`, `useUpdateSplit`, `useCloseSplit`)
- `SplitsProvider` context with connection and wallet configuration
- TanStack Query integration for data fetching and caching
- `getAllSplitsForAuthority()` method in web3 adapter
- Helper utilities (`toBase58`, `toUint8Array`, `formatBasisPointsAsPercent`)
- Typed error hierarchy (`SplitsError`, `ValidationError`, `NetworkError`, `TransactionError`)

### Changed
- Expanded error types with specific error codes for React hook consumers

## [0.4.0] - 2025-11-22

### Added
- `SplitsError` class hierarchy for `instanceof` error handling
- `matchesDiscriminator()` utility for indexers
- Comprehensive tests for PDA derivation, deserialization, and discriminators
- Export `sharesToBasisPoints`/`basisPointsToShares` for advanced use

### Changed
- Separate Raw/User-facing types (`RawRecipient` vs `Recipient`)
- Expanded share range to 1-100 (single recipient can have 100%)
- Pre-validate vault state in update/close operations

## [0.3.1] - 2025-11-21

### Fixed
- Verified full compatibility with `@solana/kit` v5.0.0
- Instruction builders use correct v5 `Address` types

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
- Create splits with automatic share-to-basis-points conversion
- Read-only methods for split config and vault balance
- Transaction building with compute budget support
- Type-safe schemas with comprehensive validation

[0.8.0]: https://github.com/cascade-protocol/splits/compare/sdk@v0.7.1...sdk@v0.8.0
[0.7.1]: https://github.com/cascade-protocol/splits/compare/sdk@v0.7.0...sdk@v0.7.1
[0.7.0]: https://github.com/cascade-protocol/splits/compare/sdk@v0.6.0...sdk@v0.7.0
[0.6.0]: https://github.com/cascade-protocol/splits/compare/sdk@v0.5.2...sdk@v0.6.0
[0.5.2]: https://github.com/cascade-protocol/splits/compare/sdk@v0.5.1...sdk@v0.5.2
[0.5.1]: https://github.com/cascade-protocol/splits/compare/sdk@v0.5.0...sdk@v0.5.1
[0.5.0]: https://github.com/cascade-protocol/splits/compare/sdk@v0.4.0...sdk@v0.5.0
[0.4.0]: https://github.com/cascade-protocol/splits/compare/sdk@v0.3.1...sdk@v0.4.0
[0.3.1]: https://github.com/cascade-protocol/splits/compare/sdk@v0.3.0...sdk@v0.3.1
[0.3.0]: https://github.com/cascade-protocol/splits/compare/sdk@v0.2.0...sdk@v0.3.0
[0.2.0]: https://github.com/cascade-protocol/splits/releases/tag/sdk@v0.2.0
