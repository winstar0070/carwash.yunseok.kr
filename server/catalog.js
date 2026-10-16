import { createHash } from "node:crypto";

const maxBytes = 5 * 1024 * 1024;
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const positiveOrNull = (value) => value === null || (Number.isFinite(value) && value > 0);
const ordered = (min, max) => min === null || max === null || min <= max;

export function parseCatalog(text) {
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("카탈로그 파일은 5MB 이하여야 합니다.");
  const data = JSON.parse(text);
  if (!object(data) || data.schema_version !== "1.0.0" || !object(data.scope)
    || typeof data.ratio_convention !== "string"
    || !Array.isArray(data.products) || data.products.length === 0 || data.products.length > 5000) {
    throw new Error("지원하지 않는 제품 카탈로그 형식입니다.");
  }
  const ids = new Set();
  for (const product of data.products) {
    if (!object(product) || typeof product.product_id !== "string" || !identifier.test(product.product_id)
      || ids.has(product.product_id) || typeof product.name !== "string" || !product.name.trim() || product.name.length > 200
      || !["liquid", "accessory", "bundle"].includes(product.category)
      || !["unknown", "neutral", "acidic", "alkaline"].includes(product.ph_class)
      || !["ph_evidence", "source_product_ids", "dilution_profiles", "pump_profiles", "variants"].every((key) => Array.isArray(product[key]))) {
      throw new Error("제품 식별자·이름·분류·상세 목록을 확인해 주세요.");
    }
    ids.add(product.product_id);
    for (const profile of product.dilution_profiles) {
      if (!object(profile) || typeof profile.calculation_allowed !== "boolean"
        || !positiveOrNull(profile.dilution_min) || !positiveOrNull(profile.dilution_max)
        || !ordered(profile.dilution_min, profile.dilution_max)
        || (profile.calculation_allowed && (profile.ratio_basis !== "concentrate_to_water"
          || (profile.dilution_min === null && profile.dilution_max === null)))) {
        throw new Error("희석비율과 계산 허용 근거를 확인해 주세요.");
      }
    }
    for (const profile of product.pump_profiles) {
      if (!object(profile) || !positiveOrNull(profile.pump_ml_min) || !positiveOrNull(profile.pump_ml_max)
        || !ordered(profile.pump_ml_min, profile.pump_ml_max)) {
        throw new Error("펌프 토출량을 확인해 주세요.");
      }
    }
  }
  return data;
}

export async function importCatalog(db, text) {
  const { products, ...metadata } = parseCatalog(text);
  const sha256 = createHash("sha256").update(text).digest("hex");
  await db.transaction(async () => {
    await db.run("SELECT pg_advisory_xact_lock(hashtext('carwash-catalog-import'))");
    // Expand one bound JSONB array inside PostgreSQL instead of one round trip per product.
    // WITH ORDINALITY is one based; stored positions retain the original zero-based order.
    await db.run(`INSERT INTO catalog_products(id, position, data)
      SELECT product->>'product_id', (ordinal - 1)::integer, product
      FROM jsonb_array_elements(?::jsonb) WITH ORDINALITY AS entries(product, ordinal)
      WHERE TRUE
      ON CONFLICT(id) DO UPDATE SET position = EXCLUDED.position, data = EXCLUDED.data`, products);
    await db.run("INSERT INTO catalog_metadata(id, metadata, source_sha256, imported_at) VALUES (1, ?::jsonb, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata = EXCLUDED.metadata, source_sha256 = EXCLUDED.source_sha256, imported_at = EXCLUDED.imported_at", metadata, sha256, Date.now());
  });
  return { imported: products.length, variants: products.reduce((count, product) => count + product.variants.length, 0), sha256 };
}

export async function listCatalog(db, { picker = false } = {}) {
  // Only discard research history; all usage instructions and source evidence remain available offline.
  const metadata = picker ? "metadata - 'research_log'" : "metadata";
  const product = picker ? "data - 'research_log'" : "data";
  const row = await db.get(`SELECT ${metadata} AS metadata, COALESCE((SELECT jsonb_agg(${product} ORDER BY position, id) FROM catalog_products), '[]'::jsonb) AS products FROM catalog_metadata WHERE id = 1`);
  return row ? { ...row.metadata, products: row.products } : { products: [] };
}

export async function getCatalogProduct(db, id) {
  if (!identifier.test(id)) return null;
  return (await db.get("SELECT data FROM catalog_products WHERE id = ?", id))?.data || null;
}
