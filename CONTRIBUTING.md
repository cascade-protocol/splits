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
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
pnpm check
pnpm test:all
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

## Release Components

| Component | Location | Tag Format | Package |
|-----------|----------|------------|---------|
| `splits-sdk` | `packages/splits-sdk` | `sdk@vX.Y.Z` | [@cascade-fyi/splits-sdk](https://npmjs.com/package/@cascade-fyi/splits-sdk) |
| `solana-program` | `programs/cascade-splits` | `solana-program@vX.Y.Z` | — |

GitHub releases and git tags follow this naming convention.

## Release Process

See [.claude/CLAUDE.md](.claude/CLAUDE.md#release-process) for the full release checklist including:

- Version updates across Cargo.toml, package.json, CHANGELOGs
- Verifiable build process
- Devnet → Mainnet deployment
- OtterSec verification
- npm publish

## Code Style

**Rust:**
- Format: `cargo fmt --all`
- Lint: `cargo clippy --all-targets --all-features -- -D warnings`

**TypeScript:**
- Format + Lint: `pnpm check` (Biome)
- Fix: `pnpm check --write`

## Project Structure

```
├── programs/cascade-splits/   # Solana program (Anchor)
│   ├── src/                   # Program source
│   ├── tests/                 # Mollusk unit tests
│   └── benches/               # CU benchmarks
├── packages/splits-sdk/       # TypeScript SDK (Solana)
│   ├── src/                   # SDK source
│   └── tests/                 # Vitest tests
├── packages/splits-sdk-evm/   # TypeScript SDK (EVM)
├── apps/dashboard/            # Dashboard app
├── apps/docs/                 # Documentation site
├── tests/                     # Anchor integration tests
└── docs/                      # Documentation
```

## Questions?

- Open an [issue](https://github.com/cascade-protocol/splits/issues)
- Email: hello@cascade.fyi
