# Compute Unit Benchmarks

This directory contains compute unit (CU) measurements for all Cascade Splits instructions.

## Running Benchmarks

```bash
cargo bench
```

Results are written to `compute_units.md` in this directory.

## Benchmark Categories

### Protocol Admin Instructions
- `initialize_protocol` - One-time setup (~9K CU)
- `update_protocol_config` - Update fee wallet (~3.5K CU)
- `transfer_protocol_authority` - Propose authority transfer (~3.4K CU)
- `accept_protocol_authority` - Accept pending transfer (~3.4K CU)

### Split Config Lifecycle
- `create_split_config_1_recipient` - Minimum case (~36K CU)
- `create_split_config_5_recipients` - Typical case (~40K CU)
- `update_split_config_to_2` - Small update (~7K CU)
- `update_split_config_to_10` - Larger update (~14K CU)
- `close_split_config` - Close and reclaim rent (~5K CU)

### Execute Split - Scaling Tests
- `execute_split_1_recipient` - Best case (~28K CU)
- `execute_split_5_recipients` - Typical case (~67K CU)
- `execute_split_20_recipients` - Worst case / MAX_RECIPIENTS (~205K CU)

### Execute Split - Unclaimed Scenarios
Tests behavior when recipient ATAs are missing (amounts held as unclaimed):
- `execute_split_unclaimed_1_of_2` - 1 missing of 2 recipients (~30K CU)
- `execute_split_unclaimed_1_of_5` - 1 missing of 5 recipients (~60K CU)
- `execute_split_unclaimed_4_of_5` - 4 missing of 5 recipients (~31K CU)
- `execute_split_unclaimed_5_of_5` - All missing (~24K CU)

**Key insight**: Missing ATAs are **cheaper** because skipped transfers save ~6K CU each (Token CPI cost). The unclaimed storage write is much cheaper than a CPI transfer.

## Interpreting Results

- **CU Budget**: Solana allows 1,400,000 CU per transaction (even worst case uses only ~15%)
- **Cost**: Higher CU = higher priority fees
- **Scaling**: `execute_split` costs ~9K CU per recipient (6K Token CPI + 3K overhead)

## Historical Results

Results are committed to this repo to:
1. Track performance regressions
2. Document expected CU costs for integrators
3. Compare before/after for optimizations

When making program changes, run benchmarks and include the diff in PRs if significant changes occur.
