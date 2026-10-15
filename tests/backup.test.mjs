import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBackup, mergePresets } from "../backup-data.js";

const sample = { name: "내 카샴푸", category: "카샴푸", ratio: 500, waterL: 15, note: "버킷용", pumpMl: 2.5 };

test("exported envelope preserves product settings and pump volume", () => {
  const text = JSON.stringify({ format: "carwash-presets", version: 1, presets: [sample] });
  assert.deepEqual(parseBackup(text), [sample]);
});

test("merging skips duplicates, keeps existing records, and assigns trusted IDs", () => {
  const existing = [{ ...sample, id: "old-id" }];
  const incoming = parseBackup(JSON.stringify([sample, { ...sample, name: "다른 제품", id: '\" onclick=\"alert(1)' }]));
  const result = mergePresets(existing, incoming, () => "safe-id");
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.presets[0].id, "old-id");
  assert.equal(result.presets[1].id, "safe-id");
});

test("legacy backups without pump information remain usable", () => {
  const { pumpMl, ...legacy } = sample;
  assert.equal(parseBackup(JSON.stringify([legacy]))[0].pumpMl, null);
});

test("invalid values and unsupported versions are rejected before import", () => {
  for (const patch of [{ ratio: 0 }, { ratio: "500" }, { waterL: -1 }, { name: "" }, { pumpMl: 0 }, { pumpMl: 1001 }]) {
    assert.throws(() => parseBackup(JSON.stringify([{ ...sample, ...patch }])));
  }
  assert.throws(() => parseBackup('{"format":"carwash-presets","version":2,"presets":[]}'));
  assert.throws(() => parseBackup("not json"));
  assert.throws(() => parseBackup(JSON.stringify(Array(501).fill(sample))));
});
