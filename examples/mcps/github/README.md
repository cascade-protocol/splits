# GitHub MCP

Minimal MCP server for fast GitHub repository access. 3 tools, no bloat.

Designed for deployment on [Cascade Market](https://market.cascade.fyi).

## Tools

### `repo` - Repository Operations

Get repository info, files, tree structure, commits, branches, and releases.

```typescript
repo("owner/repo", ["readme", "tree"])           // Overview with tree
repo("owner/repo", [], "src/index.ts")           // Get specific file
repo("owner/repo", ["commits"], undefined, "main", 10)  // Recent commits
```

**Parameters:**
- `ref` - Repository reference: `"owner/repo"` or GitHub URL
- `include` - Optional: `["readme", "tree", "commits", "branches", "releases"]`
- `path` - Optional: Specific file or directory path
- `branch` - Optional: Branch or commit SHA
- `maxResults` - Optional: Max items (default 30)

### `search` - Search GitHub

Search repositories, code, or issues/PRs.

```typescript
search("payment splitter", "repos", { language: "rust", stars: ">100" })
search("createContext", "code", { repo: "facebook/react" })
search("bug label:help-wanted", "issues", { state: "open" })
```

**Parameters:**
- `query` - Search query
- `type` - `"repos"` | `"code"` | `"issues"`
- `filters` - Optional: `{ language, stars, state, repo, user, org, ... }`
- `maxResults` - Optional: Max results (default 30)

### `discussions` - Issues, PRs, Discussions

Get issues, pull requests, or discussions with comments, diffs, files, reviews.

```typescript
discussions("owner/repo#123", undefined, ["comments"])           // Issue with comments
discussions("https://github.com/org/repo/pull/456", "pr", ["diff", "reviews"])  // PR review
discussions("owner/repo/discussions/789", "discussion", ["comments"])  // Discussion
```

**Parameters:**
- `ref` - Reference: `"owner/repo#123"` or GitHub URL
- `type` - Optional: `"issue"` | `"pr"` | `"discussion"` (auto-detected from URL)
- `include` - Optional: `["comments", "diff", "files", "reviews"]`
- `maxResults` - Optional: Max items (default 50)

## Quick Start

```bash
# Install dependencies
pnpm install

# Run with GitHub token
GITHUB_TOKEN=ghp_xxx pnpm dev
```

Server runs at `http://localhost:3000/mcp`

## Deploy to Cascade Market

```bash
cascade --token <your-token> localhost:3000
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub personal access token |
| `PORT` | No | Server port (default: 3000) |

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build for production |
| `pnpm start` | Run production build |
| `pnpm check` | Type-check and lint |

## Architecture

```
src/
├── index.ts    # MCP server + 3 tools
├── client.ts   # Functional GitHub API client
└── types.ts    # TypeScript types
```

**Design principles:**
- Functional style (no classes)
- Direct GitHub API (no SDK dependencies)
- 3 composable tools covering 90% of use cases
- Follows Twitter MCP pattern from `exporter-x402`
