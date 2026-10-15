CREATE TABLE catalog_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  metadata JSONB NOT NULL,
  source_sha256 TEXT NOT NULL,
  imported_at BIGINT NOT NULL
);
CREATE TABLE catalog_products (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data->>'product_id' = id)
);
