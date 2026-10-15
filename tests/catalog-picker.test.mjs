import test from "node:test";
import assert from "node:assert/strict";
import { searchProducts, getProfiles, getRatioOptions, getPresetDefaults, getPumpOptions, loadCatalog } from "../catalog-data.js";

const fixed = { profile_id: "foam", method: "foam_lance", calculation_allowed: true, ratio_basis: "concentrate_to_water", dilution_min: 10, dilution_max: 10, applicable_variant_ids: ["small"] };
const product = { product_id: "wash", name: "AD 오토브라이트 ACID 워시", category: "liquid", variants: [{ variant_id: "small", option_name: "500ml", source_name: "Acid Wash 500ml" }, { variant_id: "large", option_name: "4L" }], dilution_profiles: [fixed, { ...fixed, profile_id: "range", method: "bucket", dilution_min: 400, dilution_max: 750, applicable_variant_ids: ["large"] }], pump_profiles: [{ pump_type: "optional", status: "verified_optional_nominal", pump_ml_min: 29.5735295625, pump_ml_max: 29.5735295625, applicable_variant_ids: ["large"] }] };

test("search matches spaced Korean, English aliases and variant names without offering bundles", () => {
  const products = [product, { ...product, product_id: "kit", category: "bundle" }];
  for (const query of ["오토 브라이트", "ＡＣＩＤ", "wash 500ml", "ad 워시"]) assert.deepEqual(searchProducts(products, query), [product]);
  assert.deepEqual(searchProducts(products, "없는제품"), []);
  assert.deepEqual(searchProducts(products, " "), []);
  assert.deepEqual(searchProducts(products, "!!!"), []);
  assert.deepEqual(searchProducts(products, "AD", 0), []);
});

test("profiles and pumps never cross variant boundaries or use uncertain evidence", () => {
  assert.deepEqual(getProfiles(product, "small"), [fixed]);
  assert.deepEqual(getProfiles(product, "missing"), []);
  assert.equal(getPumpOptions(product, "small").length, 0);
  assert.equal(getPumpOptions(product, "large")[0].pump_ml_min, 29.5735295625);
  for (const change of [{ status: "unverified" }, { pump_ml_max: 30 }, { pump_ml_min: 0 }, { pump_ml_max: null }, { pump_ml_min: 2000, pump_ml_max: 2000 }]) {
    assert.deepEqual(getPumpOptions({ ...product, pump_profiles: [{ ...product.pump_profiles[0], ...change }] }, "large"), []);
  }
});

test("only fixed verified ratios fill automatically; ranges and one-sided limits need a choice", () => {
  assert.deepEqual(getRatioOptions(fixed), [10]);
  assert.deepEqual(getRatioOptions(product.dilution_profiles[1]), [400, 750]);
  assert.deepEqual(getRatioOptions({ ...fixed, dilution_min: null, dilution_max: 400 }), [400]);
  for (const change of [{ calculation_allowed: false }, { calculation_allowed: "true" }, { ratio_basis: "unknown" }, { dilution_min: 0 }, { dilution_min: null, dilution_max: null }, { dilution_min: 20, dilution_max: 10 }]) assert.deepEqual(getRatioOptions({ ...fixed, ...change }), []);
  const defaults = getPresetDefaults(product, "small", "foam");
  assert.equal(defaults.ratio, 10);
  assert.equal(defaults.waterL, 1);
  assert.equal(defaults.category, "폼랜스");
  assert.match(defaults.name, /500ml/);
  assert.equal(getPresetDefaults(product, "large", "range").ratio, null);
  assert.equal(getPresetDefaults(product, "large", "range").waterL, 15);
  assert.equal(getPresetDefaults(product, "small", "range").ratio, null);
  assert.equal(getPresetDefaults(product, "missing", "foam").waterL, null);
  assert.equal(getPresetDefaults({ ...product, dilution_profiles: [{ ...fixed, method: "unknown_method" }] }, "small", "foam").waterL, null);
});

test("catalog reads omit credentials, reuse only endpoint-specific offline data, and reject malformed responses", async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let calls = 0;
  const data = { schema_version: "1.0.0", products: [product], source_snapshot_date: "2026-10-14" };
  const fresh = await loadCatalog("/api", { storage, fetcher: async (url, options) => { calls++; assert.equal(url, "/api/products"); assert.equal(options.credentials, "omit"); return { ok: true, json: async () => data }; } });
  assert.equal(fresh.cached, false);
  assert.deepEqual(fresh.data, data);
  const failing = async () => { throw new Error("offline"); };
  assert.equal((await loadCatalog("/api/", { storage, fetcher: failing })).cached, true);
  await assert.rejects(loadCatalog("https://other.example/api", { storage, fetcher: failing }));
  await assert.rejects(loadCatalog("/new-api", { storage, fetcher: async () => ({ ok: false }) }));
  await assert.rejects(loadCatalog("/new-api", { storage, fetcher: async () => ({ ok: true, json: async () => ({ products: [] }) }) }));
  await assert.rejects(loadCatalog("/new-api", { storage: { getItem: () => "invalid" }, fetcher: failing }));
  assert.equal((await loadCatalog("/api", { storage: { setItem: () => { throw new Error("quota"); } }, fetcher: async () => ({ ok: true, json: async () => data }) })).cached, false);
  assert.equal(calls, 1);
});

test("fixed capsules preserve the recommended water volume without deriving a scalable ratio", () => {
  const capsule = { ...fixed, profile_id: "capsule", method: "bucket", calculation_allowed: false, ratio_basis: "unknown", dilution_min: null, dilution_max: null, fixed_dose_calculation_allowed: true, proportional_scaling_allowed: false, recommended_water_ml: 16000, recommended_water_is_approximate: true };
  const defaults = getPresetDefaults({ ...product, dilution_profiles: [capsule] }, "small", "capsule");
  assert.equal(defaults.ratio, null);
  assert.equal(defaults.waterL, 16);
  assert.equal(defaults.waterSource, "catalog");
  assert.equal(defaults.waterApproximate, true);
  assert.equal(defaults.fixedDose, true);
  assert.deepEqual(getRatioOptions({ ...fixed, proportional_scaling_allowed: false }), []);
  assert.equal(getPresetDefaults(product, "small", "foam").waterSource, "equipment");
});
