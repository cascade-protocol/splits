# Cascade CLI

Connect your local MCP server to [Cascade Market](https://cascade.fyi).

## Installation

### Homebrew (macOS/Linux)

```bash
brew install cascade-protocol/tap/cascade
```

### Go Install

```bash
go install github.com/cascade-protocol/splits/packages/golang/cli@latest
```

### Download Binary

Download from [GitHub Releases](https://github.com/cascade-protocol/splits/releases?q=cli-v).

## Usage

```bash
# Connect local MCP server to Cascade Market
cascade -t <service-token> localhost:3000

# Or explicitly use the serve subcommand
cascade serve -t <service-token> localhost:3000

# With debug output
cascade -t <service-token> -d localhost:3000
```

### Flags

| Flag | Env Var | Description |
|------|---------|-------------|
| `-t, --token` | `CASCADE_TOKEN` | Service token from Cascade Market (required) |
| `-d, --debug` | - | Enable debug output |

## How It Works

1. Get a service token from Cascade Market dashboard
2. Run `cascade` pointing to your local MCP server
3. Your MCP becomes available at `https://<service>.mcps.market.cascade.fyi`
4. Requests are proxied through WebSocket tunnel with x402 payment verification

## Development

### Build

```bash
cd packages/golang/cli
go build -o cascade .
```

### Test

```bash
./cascade --help
./cascade --version
```

## Release Process

Releases are automated via [GoReleaser](https://goreleaser.com/).

### Prerequisites

- [GoReleaser](https://goreleaser.com/install/) installed
- GitHub CLI (`gh`) authenticated with repo access

### Steps

```bash
cd packages/golang/cli

# 1. Update version in main.go if needed (optional - version comes from tag)

# 2. Commit any changes
git add -A && git commit -m "chore(cli): prepare release"
git push origin <branch>

# 3. Create and push tag (format: cli-vX.Y.Z)
git tag -a cli-v0.2.0 -m "cascade-cli v0.2.0: <description>"
git push origin cli-v0.2.0

# 4. Run goreleaser
GITHUB_TOKEN=$(gh auth token) \
HOMEBREW_TAP_TOKEN=$(gh auth token) \
goreleaser release --clean

# If git is dirty from other monorepo changes, add --skip=validate
```

### What Gets Released

- **GitHub Release**: Binaries for Linux/macOS/Windows (amd64 + arm64)
- **Homebrew**: Formula auto-pushed to [cascade-protocol/homebrew-tap](https://github.com/cascade-protocol/homebrew-tap)

### Tag Format

Use `cli-vX.Y.Z` format (e.g., `cli-v0.1.0`, `cli-v1.0.0`).

This differentiates CLI releases from other packages in the monorepo.

## License

Apache 2.0
