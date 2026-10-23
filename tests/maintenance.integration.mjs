import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { openStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { startMaintenance } from '../src/server/maintenance.js';

test('PostgreSQL: expiry remains enforced before a sweep, and indexed cleanup removes only expired rows', async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a disposable PostgreSQL database');
  const db = await openStore(process.env.TEST_DATABASE_URL);
  const id = randomUUID(), expired = Date.now() - 60000, live = Date.now() + 3600000;
  const token = randomUUID(), tokenHash = createHash('sha256').update(token).digest('hex');
  let stop;
  try {
    await db.run('INSERT INTO vaults(id, created_at) VALUES (?, ?)', id, Date.now());
    await db.run('INSERT INTO sessions VALUES (?, ?, ?)', tokenHash, id, expired);
    for (const [suffix, expiry] of [['old', expired], ['live', live]]) {
      await db.run('INSERT INTO challenges VALUES (?, ?, ?, ?, ?)', `${id}-${suffix}`, 'login', id, 'challenge', expiry);
      await db.run('INSERT INTO rate_limits VALUES (?, ?, ?)', `${id}-${suffix}`, 1, expiry);
    }
    const app = createApp(db, { origin: 'http://localhost:8766', rpID: 'localhost' });
    assert.equal((await app(new Request('http://localhost/api/session', { headers: { Cookie: `carwash_session=${token}` } }))).status, 401);
    assert.ok(await db.get('SELECT token_hash FROM sessions WHERE token_hash = ?', tokenHash), 'expiry does not require deleting the session first');
    stop = startMaintenance(db);
    await stop();
    assert.equal(await db.get('SELECT token_hash FROM sessions WHERE token_hash = ?', tokenHash), undefined);
    for (const [table, key] of [['challenges', 'token_hash'], ['rate_limits', 'bucket']]) {
      assert.equal(await db.get(`SELECT * FROM ${table} WHERE ${key} = ?`, `${id}-old`), undefined);
      assert.ok(await db.get(`SELECT * FROM ${table} WHERE ${key} = ?`, `${id}-live`));
    }
    const indexes = await db.all("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN ('sessions_expiry', 'challenges_expiry', 'rate_limits_expiry')");
    assert.equal(indexes.length, 3);
  } finally {
    await stop?.();
    await db.run('DELETE FROM challenges WHERE vault_id = ?', id);
    for (const suffix of ['old', 'live']) await db.run('DELETE FROM rate_limits WHERE bucket = ?', `${id}-${suffix}`);
    await db.run('DELETE FROM vaults WHERE id = ?', id);
    await db.close();
  }
});
