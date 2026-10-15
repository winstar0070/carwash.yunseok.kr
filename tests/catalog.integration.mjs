import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { importCatalog } from "../server/catalog.js";
import { catalogFixture } from "./catalog-fixture.mjs";

test("PostgreSQL: public catalog, idempotent imports, rollback and vault isolation", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const db = await openStore(process.env.TEST_DATABASE_URL);
  const vaultId = randomUUID();
  const app = createApp(db, { origin: "http://localhost:8766", rpID: "localhost" });
  const request = (path, method = "GET", origin) => app(new Request(`http://localhost:8787/api${path}`, { method, headers: origin ? { Origin: origin } : {} }));
  let ownsCatalog = false;
  try {
    assert.deepEqual((await db.all("SELECT version FROM schema_migrations ORDER BY version")).map((r) => r.version), [1, 2]);
    assert.deepEqual(await (await request("/products")).json(), { products: [] });
    ownsCatalog = true;
    await db.run("INSERT INTO vaults(id, presets, created_at) VALUES (?, ?, ?)", vaultId, '[{"name":"keep"}]', Date.now());
    const source = catalogFixture();
    assert.equal((await importCatalog(db, JSON.stringify(source))).imported, 1);
    assert.deepEqual(await (await request("/products")).json(), source);
    assert.deepEqual(await (await request("/products/test-shampoo")).json(), source.products[0]);
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

    await db.run("ALTER TABLE catalog_products ADD CONSTRAINT reject_test_product CHECK (id <> 'rejected-product')");
    const rejected = structuredClone(source);
    rejected.products[0].name = "must roll back";
    rejected.products.push({ ...structuredClone(source.products[0]), product_id: "rejected-product" });
    await assert.rejects(importCatalog(db, JSON.stringify(rejected)));
    assert.deepEqual(await (await request("/products")).json(), source, "a DB failure rolls back the whole import");
  } finally {
    if (ownsCatalog) {
      await db.run("ALTER TABLE catalog_products DROP CONSTRAINT IF EXISTS reject_test_product");
      await db.run("DELETE FROM catalog_products");
      await db.run("DELETE FROM catalog_metadata");
    }
    await db.run("DELETE FROM vaults WHERE id = ?", vaultId);
    await db.close();
  }
});
