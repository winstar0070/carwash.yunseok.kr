import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../src/server/store.js";
import { createApp } from "../src/server/app.js";
import { importCatalog } from "../src/server/catalog.js";
import { catalogFixture } from "./catalog-fixture.mjs";

test("PostgreSQL: public catalog, idempotent imports, rollback and vault isolation", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const db = await openStore(process.env.TEST_DATABASE_URL);
  const vaultId = randomUUID();
  const app = createApp(db, { origin: "http://localhost:8766", rpID: "localhost" });
  const request = (path, method = "GET", origin) => app(new Request(`http://localhost:8787/api${path}`, { method, headers: origin ? { Origin: origin } : {} }));
  let ownsCatalog = false;
  try {
    assert.deepEqual((await db.all("SELECT version FROM schema_migrations ORDER BY version")).map((r) => r.version), [1, 2, 3]);
    assert.deepEqual(await (await request("/products")).json(), { products: [] });
    ownsCatalog = true;
    await db.run("INSERT INTO vaults(id, presets, created_at) VALUES (?, ?, ?)", vaultId, '[{"name":"keep"}]', Date.now());
    const source = catalogFixture();
    source.research_log = [{ note: "research history" }];
    source.products[0].research_log = [{ note: "product research history" }];
    assert.equal((await importCatalog(db, JSON.stringify(source))).imported, 1);
    assert.deepEqual(await (await request("/products")).json(), source);
    assert.deepEqual(await (await request("/products/test-shampoo")).json(), source.products[0]);
    const picker = structuredClone(source);
    delete picker.research_log;
    delete picker.products[0].research_log;
    assert.deepEqual(await (await request("/products?view=picker")).json(), picker);
    assert.deepEqual(await (await request("/products?view=unknown")).json(), source);
    assert.deepEqual(await (await request("/products?view=picker%27%3Bdrop%20table")).json(), source);
    assert.equal((await request("/products?view=picker", "GET", "https://other.example")).status, 403);
    assert.equal((await request("/products?view=picker", "PUT")).status, 405);
    assert.equal((await request("/products/missing")).status, 404);
    assert.equal((await request("/products/bad%27id")).status, 404);
    assert.equal((await request("/presets")).status, 401);
    assert.equal((await request("/products", "GET", "https://other.example")).status, 403);
    assert.equal((await request("/products", "GET", "http://localhost:8766")).headers.get("Access-Control-Allow-Origin"), "http://localhost:8766");
    assert.equal((await request("/products", "PUT", "http://localhost:8766")).status, 405);

    source.products[0].name = "更新 샴푸";
    await importCatalog(db, JSON.stringify(source));
    await importCatalog(db, JSON.stringify(source));
    assert.deepEqual(await (await request("/products")).json(), source, "reimport updates without duplicates");
    assert.equal((await db.get("SELECT presets FROM vaults WHERE id = ?", vaultId)).presets, '[{"name":"keep"}]');

    const original = structuredClone(source.products[0]);
    const zeta = { ...structuredClone(original), product_id: "zeta", name: "배치 마지막 제품" };
    const alpha = { ...structuredClone(original), product_id: "alpha", name: "배치 첫 제품" };
    const batch = { ...structuredClone(source), prepared_at: "2026-10-16", products: [zeta, alpha] };
    await importCatalog(db, JSON.stringify(batch));
    assert.deepEqual(Array.from(await db.all("SELECT id, position FROM catalog_products ORDER BY position, id")), [
      { id: original.product_id, position: 0 }, { id: "zeta", position: 0 }, { id: "alpha", position: 1 },
    ], "batch ordinality remains zero based and missing products stay intact");
    alpha.name = "배치 갱신 제품";
    batch.products = [alpha, zeta];
    await importCatalog(db, JSON.stringify(batch));
    assert.deepEqual(Array.from(await db.all("SELECT id, position FROM catalog_products ORDER BY position, id")), [
      { id: "alpha", position: 0 }, { id: original.product_id, position: 0 }, { id: "zeta", position: 1 },
    ], "upsert updates both content and ordering without deleting absent products");
    source.prepared_at = batch.prepared_at;
    source.products = [alpha, original, zeta];
    assert.deepEqual(await (await request("/products")).json(), source);
    const beforeFailure = await db.get("SELECT metadata, source_sha256, imported_at FROM catalog_metadata WHERE id = 1");

    await db.run("ALTER TABLE catalog_metadata ADD CONSTRAINT reject_test_metadata CHECK (metadata->>'prepared_at' <> 'reject-metadata')");
    const rejectedMetadata = structuredClone(source);
    rejectedMetadata.prepared_at = "reject-metadata";
    rejectedMetadata.products[0].name = "must roll back previously successful product batch";
    await assert.rejects(importCatalog(db, JSON.stringify(rejectedMetadata)));
    assert.deepEqual(await (await request("/products")).json(), source, "metadata failure rolls back a successful product batch");
    assert.deepEqual(await db.get("SELECT metadata, source_sha256, imported_at FROM catalog_metadata WHERE id = 1"), beforeFailure);

    await db.run("ALTER TABLE catalog_products ADD CONSTRAINT reject_test_product CHECK (id <> 'rejected-product')");
    const rejected = structuredClone(source);
    rejected.products[0].name = "must roll back";
    rejected.prepared_at = "must roll back metadata";
    rejected.products.splice(1, 0, { ...structuredClone(source.products[0]), product_id: "rejected-product" });
    await assert.rejects(importCatalog(db, JSON.stringify(rejected)));
    assert.deepEqual(await (await request("/products")).json(), source, "a DB failure rolls back the whole import");
    assert.deepEqual(await db.get("SELECT metadata, source_sha256, imported_at FROM catalog_metadata WHERE id = 1"), beforeFailure, "failed batch must preserve metadata and original source hash");
  } finally {
    if (ownsCatalog) {
      await db.run("ALTER TABLE catalog_metadata DROP CONSTRAINT IF EXISTS reject_test_metadata");
      await db.run("ALTER TABLE catalog_products DROP CONSTRAINT IF EXISTS reject_test_product");
      await db.run("DELETE FROM catalog_products");
      await db.run("DELETE FROM catalog_metadata");
    }
    await db.run("DELETE FROM vaults WHERE id = ?", vaultId);
    await db.close();
  }
});
