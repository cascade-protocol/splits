# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2025-12-09

### Fixed

- Storage slot computation now includes required `0x` prefix for Anvil compatibility
- Proper aiohttp session cleanup via `provider.disconnect()` to prevent resource leak warnings
- Type errors with `ChecksumAddress` parameter handling
- Nullable `result.message` and `result.split` type guards in tests

### Added

- Async context manager support for `AsyncCascadeSplitsClient` (`async with client:`)
- `close()` method for explicit session cleanup

## [0.1.0] - 2025-12-09

### Added

- **Async-first architecture** with `AsyncCascadeSplitsClient` (recommended)
- **Sync client** `CascadeSplitsClient` for simple scripts
- **Standalone async functions** `ensure_split()` and `execute_split()` for low-level control
- **Helper functions**: `is_cascade_split`, `get_split_balance`, `get_split_config`, `has_pending_funds`, `get_pending_amount`, `get_total_unclaimed`, `preview_execution`, `predict_split_address`, `get_default_token`
- **Result types**: `EnsureResult` (CREATED/NO_CHANGE/FAILED), `ExecuteResult` (EXECUTED/SKIPPED/FAILED)
- **Type safety**: Full Pydantic v2 models with frozen dataclasses
- **PEP 561 compliance**: `py.typed` marker for type checkers
- Support for **Base Mainnet** (8453) and **Base Sepolia** (84532)

### Technical Details

- Python 3.11+ required
- Uses `web3.py` 7.x with `AsyncWeb3` for async operations
- Uses `pydantic` 2.x for data validation
- Full TypeScript SDK API parity
