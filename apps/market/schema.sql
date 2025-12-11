-- Cascade Market Database Schema
-- D1 SQLite database for service registry

-- Services table (one per MCP registration)
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,              -- Subdomain: "twitter-research"
  owner_address TEXT NOT NULL,            -- Developer's Solana wallet

  -- Cascade Split
  split_config TEXT NOT NULL,             -- SplitConfig PDA
  split_vault TEXT NOT NULL,              -- Vault ATA (payTo address)

  -- Pricing
  price TEXT NOT NULL,                    -- USDC base units per call

  -- State
  status TEXT DEFAULT 'offline',          -- online/offline
  tunnel_id TEXT,                         -- Active tunnel connection

  -- Stats (denormalized for fast reads)
  total_calls INTEGER DEFAULT 0,
  total_revenue TEXT DEFAULT '0',
  pending_balance TEXT DEFAULT '0',

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  last_connected_at TEXT,
  last_executed_at TEXT                   -- Last execute_split
);

-- Index for owner queries
CREATE INDEX IF NOT EXISTS idx_services_owner ON services(owner_address);

-- Index for split executor (find services with pending balance)
CREATE INDEX IF NOT EXISTS idx_services_pending ON services(pending_balance, last_executed_at)
  WHERE pending_balance > '0';

-- Index for subdomain lookups (gateway)
CREATE INDEX IF NOT EXISTS idx_services_name ON services(name);

-- API tokens table (for additional security, optional)
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,               -- SHA256 hash of token
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tokens_service ON tokens(service_id);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
