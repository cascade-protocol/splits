# GitHub MCP

Example MCP server for GitHub operations, designed for deployment on [Cascade Market](https://market.cascade.fyi).

## Quick Start

```bash
pnpm install
pnpm dev
```

Server runs at `http://localhost:3000/mcp`

## Deploy to Cascade Market

```bash
cascade --token <your-token> localhost:3000
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build for production |
| `pnpm start` | Run production build |
| `pnpm check` | Type-check and lint |
