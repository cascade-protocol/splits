# Changelog

All notable changes to Cascade Splits program will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2025-11-26

### Added
- sRFC-37 support: Frozen Token-2022 accounts now trigger unclaimed flow
- Vault rent recovery: `close_split_config` now closes vault ATA (~0.017 SOL total recovered)

### Changed
- `close_split_config` requires `token_program` account (+5,000 CU for vault CPI)
- `execute_split` validates canonical ATAs and frozen state (+300 CU per recipient)
- Non-canonical token accounts rejected to prevent funds sent to non-monitored accounts

### Fixed
- Canonical ATA validation: All recipient and protocol ATAs must be derived via `get_associated_token_address_with_program_id()`

## [0.2.0] - 2025-11-20

### Added
- Initial public release
- Permissionless payment splitting with 1% protocol fee
- Support for 1-20 recipients
- Self-healing unclaimed recovery
- SPL Token and Token-2022 support
- Two-step protocol authority transfer
- Rent payer tracking for sponsored rent
- Checked arithmetic operations throughout
- Canonical PDA bump storage
- Comprehensive account validation
- Zero-copy serialization for CU efficiency

[Unreleased]: https://github.com/cascade-protocol/splits/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/cascade-protocol/splits/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cascade-protocol/splits/releases/tag/v0.2.0
