import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { createVaultSync, SYNC_KEYS } from "../vault-sync.js";
import { authenticator } from "./authenticator.mjs";

const row = id => ({ id, name: id, category: "카샴푸", ratio: 500, waterL: 15, pumpMl: null, note: "" });

test("PostgreSQL: shared-cookie account switches cannot redirect saves, reads, choices or account management", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Use a disposable PostgreSQL database");
  const db = await openStore(process.env.TEST_DATABASE_URL);
  const app = createApp(db, { origin: "http://localhost:8766", rpID: "localhost" });
  const ids = [];
  function client() {
    const cookies = new Map(), address = randomUUID();
    const request = async (path, method = "GET", body) => {
      const headers = { Origin: "http://localhost:8766", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await app(new Request(`http://localhost/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), address);
      for (const cookie of response.headers.getSetCookie()) {
        const [name, value] = cookie.split(";", 1)[0].split("="); cookies.set(name, value);
      }
      return { status: response.status, data: await response.json() };
    };
    const api = async (...args) => {
      const result = await request(...args);
      if (result.status !== 200) throw Object.assign(new Error(result.data.error), { statusCode: result.status });
      return result.data;
    };
    return { request, api, cookies };
  }
  async function register(c, key) {
    const options = await c.api("/register/options", "POST", { vaultId: null });
    const result = await c.api("/register/verify", "POST", { ...key.register(options.options), vaultId: null });
    ids.push(result.vaultId);
    return result.vaultId;
  }
  async function login(c, key) {
    const options = await c.api("/login/options", "POST", {});
    await c.api("/login/verify", "POST", key.login(options.options));
  }
  function device(api) {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const sync = createVaultSync({ api, storage, onState() {}, setTimer: () => 1, clearTimer() {},
      applyPresets(rows, id) { storage.setItem(SYNC_KEYS.presets, JSON.stringify(rows)); storage.setItem(SYNC_KEYS.owner, id || ""); },
    });
    return { sync, edit: rows => storage.setItem(SYNC_KEYS.presets, JSON.stringify(rows)),
      local: () => JSON.parse(storage.getItem(SYNC_KEYS.presets)),
      queue: id => JSON.parse(storage.getItem(SYNC_KEYS.queue))[id],
    };
  }
  try {
    const shared = client(), other = client(), keyA = authenticator(), keyB = authenticator();
    const a = await register(shared, keyA), b = await register(other, keyB);
    await shared.api("/presets", "PUT", { vaultId: a, presets: [row("private-a")], revision: 0 });
    await other.api("/presets", "PUT", { vaultId: b, presets: [row("private-b")], revision: 0 });
    const bBefore = await other.api(`/presets?vaultId=${b}`);
    const d = device(shared.api); await d.sync.connect(a);
    await login(shared, keyB); // Another tab changed the browser's shared cookie before updating localStorage.
    d.edit([row("private-a"), row("pending-a")]); await d.sync.changed();
    assert.equal(d.sync.vaultId, null);
    assert.equal(d.queue(a).dirty, true);
    assert.deepEqual(await other.api(`/presets?vaultId=${b}`), bBefore, "equal revisions must not allow A to overwrite B");
    assert.equal((await shared.request(`/presets?vaultId=${a}`)).status, 401);
    assert.equal((await shared.request("/presets")).status, 428, "cached legacy clients cannot read an unbound list");
    await d.sync.resume();
    assert.equal(d.sync.vaultId, b);
    assert.deepEqual(d.local(), [row("private-b")]);
    await login(shared, keyA); await d.sync.resume();
    assert.equal(d.queue(a).dirty, false, "pending A edits resume only after A authenticates again");
    assert.deepEqual(d.local().map(p => p.id), ["private-a", "pending-a"]);

    for (const action of ["connect", "refresh", "cloud", "local", "merge"]) {
      await login(shared, keyA);
      const tab = device(shared.api); await tab.sync.connect(a);
      const before = tab.queue(a);
      await login(shared, keyB);
      if (action === "connect") await tab.sync.connect(a);
      else if (action === "refresh") await tab.sync.refresh();
      else await tab.sync.choose(action);
      assert.deepEqual(tab.queue(a), before, action);
      assert.deepEqual(tab.local(), before.presets, action);
      assert.deepEqual(await other.api(`/presets?vaultId=${b}`), bBefore, action);
    }

    await login(shared, keyA);
    let switchAfterRead = false;
    const racing = device(async (...args) => {
      const result = await shared.api(...args);
      if (switchAfterRead && args[0].startsWith("/presets?") && args[1] === undefined) {
        switchAfterRead = false; await login(shared, keyB);
      }
      return result;
    });
    await racing.sync.connect(a); switchAfterRead = true;
    await racing.sync.choose("local");
    assert.equal(racing.sync.vaultId, null, "a cookie change between choice GET and PUT must stop the save");
    assert.deepEqual(await other.api(`/presets?vaultId=${b}`), bBefore);

    const recoveryBefore = await db.get("SELECT recovery_hash FROM vaults WHERE id = ?", b);
    for (const path of ["/logout", "/recovery-code", "/register/options"]) {
      assert.equal((await shared.request(path, "POST", { vaultId: a })).status, 401, path);
      assert.equal((await shared.request(path, "POST", {})).status, 428, path);
    }
    assert.equal((await shared.request("/register/options", "POST", { vaultId: null })).status, 401, "guest intent must not add a key to another tab's account");
    assert.equal((await shared.api("/session")).vaultId, b, "a stale tab must not log out B");
    assert.deepEqual(await db.get("SELECT recovery_hash FROM vaults WHERE id = ?", b), recoveryBefore);

    await login(shared, keyA);
    const adding = await shared.api("/register/options", "POST", { vaultId: a });
    const pendingFlow = shared.cookies.get("carwash_flow");
    const newKey = authenticator().register(adding.options);
    await login(shared, keyB);
    // A delayed options response can restore its flow cookie after B's login response.
    shared.cookies.set("carwash_flow", pendingFlow);
    assert.equal((await shared.request("/register/verify", "POST", { ...newKey, vaultId: a })).status, 401);
    assert.equal(Number((await db.get("SELECT count(*) AS count FROM credentials WHERE vault_id = ?", b)).count), 1);
    const rotated = await shared.api("/recovery-code", "POST", { vaultId: b });
    assert.ok(rotated.recoveryCode, "normal account management remains available for the matching target");
  } finally {
    for (const id of ids) await db.run("DELETE FROM challenges WHERE vault_id = ?", id);
    for (const id of ids) await db.run("DELETE FROM vaults WHERE id = ?", id);
    await db.close();
  }
});
