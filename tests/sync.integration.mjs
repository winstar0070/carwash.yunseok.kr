import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { createVaultSync, SYNC_KEYS } from "../vault-sync.js";
import { authenticator } from "./authenticator.mjs";

test("PostgreSQL: authenticated automatic changes, reconnect, cross-device refresh and conflicts", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const db = await openStore(process.env.TEST_DATABASE_URL);
  const app = createApp(db, { origin: "http://localhost:8766", rpID: "localhost" });
  const ids = [];
  const row = id => ({ id, name: id, category: "카샴푸", ratio: 500, waterL: 15, pumpMl: 2, note: "" });
  function client() {
    const cookies = new Map(), address = randomUUID();
    let offline = false;
    const api = async (path, method = "GET", body) => {
      if (offline) throw new TypeError("offline");
      const headers = { Origin: "http://localhost:8766", Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await app(new Request(`http://localhost:8787/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), address);
      for (const cookie of response.headers.getSetCookie()) {
        const [name, value] = cookie.split(";", 1)[0].split("="); cookies.set(name, value);
      }
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error), { statusCode: response.status });
      return data;
    };
    const values = new Map([[SYNC_KEYS.presets, JSON.stringify([row("guest")])]]);
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    const states = [];
    const makeSync = () => createVaultSync({ api, storage,
      applyPresets: (rows, id) => { storage.setItem(SYNC_KEYS.presets, JSON.stringify(rows)); storage.setItem(SYNC_KEYS.owner, id || ""); },
      onState: state => states.push(state), setTimer: () => 1, clearTimer() {},
    });
    return { api, storage, states, makeSync, edit: rows => storage.setItem(SYNC_KEYS.presets, JSON.stringify(rows)), local: () => JSON.parse(storage.getItem(SYNC_KEYS.presets)), offline: value => { offline = value; } };
  }
  try {
    const a = client(), b = client(), other = client();
    const device = authenticator();
    const options = await a.api("/register/options", "POST", {});
    const account = await a.api("/register/verify", "POST", device.register(options.options)); ids.push(account.vaultId);
    const syncA = a.makeSync(); await syncA.connect(account.vaultId, { created: true });
    assert.deepEqual((await a.api("/presets")).presets, [row("guest")]);
    a.edit([row("guest"), row("added")]); await syncA.changed();
    assert.equal((await a.api("/presets")).presets.length, 2);
    a.edit([{ ...row("added"), ratio: 1000 }]); await syncA.changed();
    assert.equal((await a.api("/presets")).presets[0].ratio, 1000);
    a.edit([]); await syncA.changed();
    assert.deepEqual((await a.api("/presets")).presets, []);
    await a.makeSync().resume(); assert.deepEqual(a.local(), []);

    const login = await b.api("/login/options", "POST", {});
    await b.api("/login/verify", "POST", device.login(login.options));
    const syncB = b.makeSync(); await syncB.resume();
    assert.deepEqual(b.local(), []);
    a.edit([row("cross-device")]); await syncA.changed();
    await syncB.refresh(); assert.deepEqual(b.local(), [row("cross-device")]);
    assert.equal(b.states.at(-1).phase, "updated");

    a.offline(true); a.edit([]); await syncA.changed();
    assert.equal(a.states.at(-1).phase, "offline");
    a.offline(false); await syncA.resume();
    assert.deepEqual((await b.api("/presets")).presets, []);
    b.edit([row("stale")]); await syncB.changed();
    assert.equal(b.states.at(-1).phase, "conflict");
    assert.deepEqual((await a.api("/presets")).presets, []);
    await syncB.choose("local");
    await syncA.refresh(); assert.deepEqual(a.local(), [row("stale")]);

    const otherOptions = await other.api("/register/options", "POST", {});
    const otherAccount = await other.api("/register/verify", "POST", authenticator().register(otherOptions.options)); ids.push(otherAccount.vaultId);
    assert.deepEqual((await other.api("/presets")).presets, []);
    await a.api("/logout", "POST", {}); syncA.disconnect();
    assert.deepEqual(a.local(), [row("guest")]);
  } finally {
    for (const id of ids) await db.run("DELETE FROM vaults WHERE id = ?", id);
    await db.close();
  }
});
