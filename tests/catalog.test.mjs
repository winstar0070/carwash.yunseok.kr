import test from "node:test";
import assert from "node:assert/strict";
import { parseCatalog } from "../server/catalog.js";
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
