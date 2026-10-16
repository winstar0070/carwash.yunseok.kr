import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseCatalog, importCatalog } from "../server/catalog.js";
import { catalogFixture } from "./catalog-fixture.mjs";

test("catalog preserves evidence, nulls, one-sided ratios and all source fields", () => {
  const source = catalogFixture();
  assert.deepEqual(parseCatalog(JSON.stringify(source)), source);
});

test("catalog rejects invalid JSON, unsupported schema, empty or oversized input", () => {
  for (const text of ["{", "null", "[]", JSON.stringify({ ...catalogFixture(), schema_version: "2.0.0" }), JSON.stringify({ ...catalogFixture(), products: [] }), " ".repeat(5 * 1024 * 1024 + 1)]) {
    assert.throws(() => parseCatalog(text));
  }
});

test("catalog rejects malformed or duplicate product identifiers and missing collections", () => {
  const changes = [
    (d) => { d.products[0].product_id = "../product"; },
    (d) => { d.products.push(structuredClone(d.products[0])); },
    (d) => { d.products[0].name = " "; },
    (d) => { d.products[0].category = "guessed"; },
    (d) => { d.products[0].ph_class = "guessed"; },
    (d) => { d.products[0].variants = null; },
    (d) => { d.products[0].pump_profiles = {}; },
  ];
  for (const change of changes) {
    const data = catalogFixture(); change(data);
    assert.throws(() => parseCatalog(JSON.stringify(data)));
  }
});

test("catalog rejects unsafe calculation flags and invalid dilution or pump numbers", () => {
  const changes = [
    (p) => { p.dilution_profiles[0].calculation_allowed = true; },
    (p) => { p.dilution_profiles[1].dilution_max = null; },
    (p) => { p.dilution_profiles[1].dilution_max = 0; },
    (p) => { p.dilution_profiles[1].dilution_min = 30; },
    (p) => { p.dilution_profiles[1].dilution_max = "20"; },
    (p) => { p.dilution_profiles[1].calculation_allowed = "true"; },
    (p) => { p.pump_profiles[0].pump_ml_min = -1; },
    (p) => { p.pump_profiles[0].pump_ml_min = 5; p.pump_profiles[0].pump_ml_max = 2; },
  ];
  for (const change of changes) {
    const data = catalogFixture(); change(data.products[0]);
    assert.throws(() => parseCatalog(JSON.stringify(data)));
  }
});


test("catalog import uses bounded parameterized statements and preserves the source hash/metadata", async () => {
  const source = catalogFixture();
  source.products = Array.from({ length: 192 }, (_, index) => ({ ...structuredClone(source.products[0]), product_id: `product-${index}`, name: `샴푸 '${index}; DROP TABLE nope` }));
  source.research_log = ["원본 기록"];
  const text = JSON.stringify(source, null, 2);
  const calls = [];
  let transactions = 0;
  let inTransaction = false;
  const db = {
    transaction: async callback => { transactions++; inTransaction = true; try { return await callback(); } finally { inTransaction = false; } },
    run: async (sql, ...parameters) => { assert.equal(inTransaction, true); calls.push({ sql, parameters }); },
  };
  const result = await importCatalog(db, text);
  assert.equal(transactions, 1);
  assert.equal(calls.length, 3, "one advisory lock, one products statement, one metadata statement regardless of catalog size");
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.equal(calls[1].sql.includes(source.products[0].name), false, "product text must remain a bound parameter");
  const { products, ...metadata } = source;
  assert.deepEqual(calls[1].parameters, [products]);
  assert.deepEqual(calls[2].parameters[0], metadata);
  assert.deepEqual(result, { imported: 192, variants: 192, sha256: createHash("sha256").update(text).digest("hex") });
  assert.equal(calls[2].parameters[1], result.sha256);
});

test("invalid catalog imports fail before starting a transaction", async () => {
  let transactions = 0;
  const db = { transaction: async () => { transactions++; } };
  for (const text of ["{", JSON.stringify({ ...catalogFixture(), products: [] })]) await assert.rejects(importCatalog(db, text));
  assert.equal(transactions, 0);
});
