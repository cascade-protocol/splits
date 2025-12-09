# Contributing to Cascade Splits

## Development Setup

```bash
# Clone and install
git clone https://github.com/cascade-protocol/splits.git
cd splits
pnpm install

# Build program
anchor build

# Build SDK
pnpm build
```

## Testing

| Layer | Command | Description |
|-------|---------|-------------|
| Unit | `cargo test --lib` | Rust unit tests |
| Instruction | `cargo test -p cascade-splits` | Mollusk tests |
| SDK | `pnpm test:sdk` | Vitest + LiteSVM |
| Integration | `anchor test` | Anchor + localnet |
| All | `pnpm test:all` | Everything |

Run before submitting PRs:

```bash
pnpm nx run-many -t check   # Format + lint (Rust & TypeScript)
pnpm nx run-many -t test    # All tests
```

## Commit Messages

Follow [Conventional Commits](https://conventionalcommits.org):

```
feat(sdk): add executeAndConfirmSplit helper
fix(program): validate canonical ATAs
chore(sdk): release v0.8.0
docs: update README examples
```

Scopes: `sdk`, `program`, `docs`, or omit for repo-wide changes.

## Code Style

Formatting is auto-fixed when running `pnpm nx run-many -t check`.

## Project Structure

```
├── programs/cascade-splits/   # Solana program (Anchor)
│   ├── src/                   # Program source
│   ├── tests/                 # Mollusk unit tests
│   └── benches/               # CU benchmarks
├── packages/
│   ├── splits-sdk/            # TypeScript SDK (Solana)
│   ├── splits-sdk-evm/        # TypeScript SDK (EVM/Base)
│   └── tabs-sdk/              # TypeScript SDK (Tabs/Squads)
├── apps/
│   ├── dashboard/             # Dashboard app
│   └── tabs/                  # Tabs app
├── contracts/                 # EVM contracts (Foundry)
├── tests/                     # Anchor integration tests
└── docs/                      # Documentation
```

## Questions?

- Open an [issue](https://github.com/cascade-protocol/splits/issues)
- Email: hello@cascade.fyi
