-- Cascade Market Database Schema
-- D1 SQLite database for OAuth only
-- Service data is on-chain + service tokens (per ADR-0004 §4.7)

-- OAuth authorization codes (10-minute TTL, one-time use)
CREATE TABLE IF NOT EXISTS auth_codes (
  code TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,             -- Solana wallet that authorized
  client_id TEXT NOT NULL,                -- MCP client URL
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,           -- PKCE S256 challenge
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT                            -- Set when exchanged for tokens
);

CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);

-- OAuth refresh tokens (30-day TTL)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  token_hash TEXT NOT NULL,               -- SHA256 hash of token
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash, client_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_address);
