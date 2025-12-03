# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-12-03

Initial release of the EVM SDK for Cascade Splits.

### Added

- **Core Operations**
  - `ensureSplit()` — idempotent split creation (CREATED or NO_CHANGE)
  - `executeSplit()` — permissionless distribution to recipients

- **Client Factory** (`/client`)
  - `createEvmSplitsClient(chain, wallet)` — stateful client with viem wallet
  - Methods: `ensureSplit()`, `execute()`, `getSplit()`, `getBalance()`, `isCascadeSplit()`, `previewExecution()`, `predictSplitAddress()`

- **Helper Functions**
  - `predictSplitAddress()` — deterministic CREATE2 address prediction
  - `isCascadeSplit()` — detect if address is a Cascade Split
  - `getSplitConfig()` — read full split configuration
  - `getSplitBalance()` — get split token balance
  - `hasPendingFunds()` — check if funds available for distribution
  - `getPendingAmount()` — get amount available for distribution
  - `getTotalUnclaimed()` — get unclaimed amounts across recipients
  - `previewExecution()` — preview distribution before executing
  - `toEvmRecipient()` / `toEvmRecipients()` — convert share-based input to bps
  - `getDefaultToken()` — get USDC address for chain

- **Address Management**
  - `getSplitFactoryAddress()` — get factory address for chain
  - `getUsdcAddress()` — get USDC address for chain
  - `isSupportedChain()` — check chain support
  - Constants: `SPLIT_FACTORY_ADDRESSES`, `USDC_ADDRESSES`, `SUPPORTED_CHAIN_IDS`

- **ABI Exports**
  - `splitFactoryAbi` — SplitFactory contract ABI
  - `splitConfigImplAbi` — SplitConfigImpl contract ABI

- **Result Types** (discriminated unions)
  - `EvmEnsureResult`: `CREATED`, `NO_CHANGE`, `FAILED`
  - `EvmExecuteResult`: `EXECUTED`, `SKIPPED`, `FAILED`
  - `EvmSkippedReason`: `not_found`, `not_a_split`, `below_threshold`, `no_pending_funds`
  - `EvmFailedReason`: `wallet_rejected`, `wallet_disconnected`, `network_error`, `transaction_failed`, `transaction_reverted`, `insufficient_gas`

### Supported Chains

- Base Mainnet (8453)
- Base Sepolia (84532)

### Deployed Contracts

| Contract | Address |
|----------|---------|
| SplitFactory | `0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7` |
| SplitConfigImpl | `0xF9ad695ecc76c4b8E13655365b318d54E4131EA6` |

[Unreleased]: https://github.com/cascade-protocol/splits/compare/sdk-evm@v0.1.0...HEAD
[0.1.0]: https://github.com/cascade-protocol/splits/releases/tag/sdk-evm@v0.1.0
