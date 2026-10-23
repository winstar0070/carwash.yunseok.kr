CREATE TABLE vaults (
  id TEXT PRIMARY KEY,
  recovery_hash TEXT UNIQUE,
  presets TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL,
  transports TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX credentials_vault ON credentials(vault_id);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE challenges (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  vault_id TEXT,
  challenge TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at BIGINT NOT NULL
);
