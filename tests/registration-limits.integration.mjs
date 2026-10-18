import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { openStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { authenticator } from "./authenticator.mjs";

const origin = "http://localhost:8766";
test("registration quotas persist across instances and concurrent requests", async (t) => {
  assert.ok(process.env.TEST_DATABASE_URL, "Use a disposable PostgreSQL database");
  const admin = postgres(process.env.TEST_DATABASE_URL, { onnotice: () => {} });
  const schema = `registration_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE SCHEMA ${admin(schema)}`;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const db = await openStore(url.toString());
  const app = () => createApp(db, { origin, rpID: "localhost" });
  function client(address = randomUUID(), cookies = new Map(), fetch = app()) {
    return async (path, body = {}) => {
      const response = await fetch(new Request(`http://localhost/api${path}`, {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }, body: JSON.stringify(body),
      }), address);
      for (const cookie of response.headers.getSetCookie()) {
        const [name, value] = cookie.split(";", 1)[0].split("=");
        cookies.set(name, value);
      }
      return { status: response.status, data: await response.json(), headers: response.headers };
    };
  }
  async function register(request, vaultId = null) {
    const options = await request("/register/options", { vaultId });
    assert.equal(options.status, 200);
    return request("/register/verify", { ...authenticator().register(options.data.options), vaultId });
  }
  try {
    await t.test("IP options quota survives cookies, headers and app restarts", async () => {
      const address = randomUUID();
      for (let i = 0; i < 10; i++) assert.equal((await client(address)("/register/options", { vaultId: null })).status, 200);
      const blocked = await client(address)("/register/options", { vaultId: null });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
      assert.equal(Number((await db.get("SELECT count(*) AS count FROM challenges")).count), 10);
      assert.equal((await client(address)("/login/options")).status, 200, "registration limits do not block login");
      assert.equal((await client()("/register/options", { vaultId: null })).status, 200);
    });
    await db.run("TRUNCATE rate_limits, challenges");
    await t.test("global options quota bounds anonymous challenge creation", async () => {
      for (let i = 0; i < 100; i++) assert.equal((await client()("/register/options", { vaultId: null })).status, 200);
      assert.equal((await client()("/register/options", { vaultId: null })).status, 429);
      assert.equal(Number((await db.get("SELECT count(*) AS count FROM challenges")).count), 100);
    });
    await db.run("TRUNCATE rate_limits, challenges");
    await t.test("same IP can create only five vaults per day even concurrently", async () => {
      const address = randomUUID();
      const results = await Promise.all(Array.from({ length: 7 }, () => register(client(address))));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 429, 429]);
      assert.equal(Number((await db.get("SELECT count(*) AS count FROM vaults")).count), 5);
      assert.equal((await register(client())).status, 200);
    });
    await db.run("TRUNCATE rate_limits, challenges");
    await t.test("global daily quota bounds vaults across IPs", async () => {
      for (let i = 0; i < 100; i++) {
        const result = await register(client());
        assert.equal(result.status, 200, JSON.stringify(result.data));
        // This test targets the daily creation budget, independently of the hourly options budget.
        await db.run("DELETE FROM rate_limits WHERE expires_at < ?", Date.now() + 7200000);
      }
      assert.equal((await register(client())).status, 429);
      assert.equal(Number((await db.get("SELECT count(*) AS count FROM vaults")).count), 106);
    });
    await db.run("TRUNCATE rate_limits, challenges");
    await t.test("concurrent additions cannot exceed ten keys in one vault", async () => {
      const cookies = new Map();
      const owner = client(randomUUID(), cookies);
      const created = await register(owner);
      assert.equal(created.status, 200);
      for (let i = 1; i < 9; i++) assert.equal((await register(client(randomUUID(), new Map(cookies)), created.data.vaultId)).status, 200);
      const pending = await Promise.all(Array.from({ length: 3 }, async () => {
        const request = client(randomUUID(), new Map(cookies));
        const vaultId = created.data.vaultId;
        const options = await request("/register/options", { vaultId });
        assert.equal(options.status, 200);
        return () => request("/register/verify", { ...authenticator().register(options.data.options), vaultId });
      }));
      assert.deepEqual((await Promise.all(pending.map((verify) => verify()))).map((r) => r.status).sort(), [200, 400, 400]);
      assert.equal(Number((await db.get("SELECT count(*) AS count FROM credentials WHERE vault_id = ?", created.data.vaultId)).count), 10);
      assert.equal((await owner("/register/options", { vaultId: created.data.vaultId })).status, 400);
    });
    await db.run("TRUNCATE rate_limits, challenges");
    await t.test("hourly and daily budgets reopen at the next UTC window", async (t) => {
      const now = Date.UTC(2026, 9, 16, 12, 30);
      t.mock.timers.enable({ apis: ["Date"], now });
      const address = randomUUID();
      for (let i = 0; i < 10; i++) assert.equal((await client(address)("/register/options", { vaultId: null })).status, 200);
      assert.equal((await client(address)("/register/options", { vaultId: null })).status, 429);
      t.mock.timers.setTime(now + 3600000);
      for (let i = 0; i < 5; i++) assert.equal((await register(client(address))).status, 200);
      assert.equal((await register(client(address))).status, 429);
      t.mock.timers.setTime(now + 86400000);
      assert.equal((await register(client(address))).status, 200);
    });
    await db.run("TRUNCATE rate_limits, challenges");
    await t.test("invalid verification writes no vault and spends no creation budget", async () => {
      const address = randomUUID();
      const request = client(address);
      const before = Number((await db.get("SELECT count(*) AS count FROM vaults")).count);
      assert.equal((await request("/register/options", { vaultId: null })).status, 200);
      assert.equal((await request("/register/verify", { id: "invalid", vaultId: null })).status, 400);
      assert.equal(Number((await db.get("SELECT count(*) AS count FROM vaults")).count), before);
      for (let i = 0; i < 5; i++) assert.equal((await register(client(address))).status, 200);
      assert.equal((await register(client(address))).status, 429);
    });
  } finally {
    await db.close();
    await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    await admin.end();
  }
});
