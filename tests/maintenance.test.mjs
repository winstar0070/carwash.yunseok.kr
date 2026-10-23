import test from 'node:test';
import assert from 'node:assert/strict';
import { startMaintenance } from '../src/server/maintenance.js';

test('maintenance sweeps on startup and periodically, never overlaps, and stops before closing the DB', async () => {
  let tick, stopped = false, release;
  const queries = [];
  const db = { run: async (query, now) => { queries.push({ query, now }); if (queries.length === 1) await new Promise(resolve => { release = resolve; }); } };
  const stop = startMaintenance(db, { setTimer(fn, ms) { tick = fn; assert.equal(ms, 60000); return { unref() {} }; }, clearTimer() { stopped = true; } });
  const overlapping = tick();
  assert.equal(queries.length, 1, 'a slow sweep must not overlap with another tick');
  const stopping = stop();
  assert.equal(stopped, true);
  release(); await Promise.all([stopping, overlapping]);
  assert.equal(queries.length, 3);
  assert.ok(queries.every(row => row.now === queries[0].now));
  await tick();
  assert.equal(queries.length, 3, 'no sweeps after shutdown');
});

test('a failed sweep is reported and a later tick retries successfully', async () => {
  let tick, fail = true;
  const queries = [], errors = [];
  const stop = startMaintenance({ run: async query => { if (fail) throw new Error('db down'); queries.push(query); } }, {
    setTimer(fn) { tick = fn; return { unref() {} }; }, clearTimer() {}, onError: error => errors.push(error.message),
  });
  await tick();
  assert.deepEqual(errors, ['db down']);
  fail = false; await tick();
  assert.equal(queries.length, 3);
  await stop();
});
