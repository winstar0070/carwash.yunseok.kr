import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../src/server/store.js";
import { createApp } from "../src/server/app.js";
import { authenticator } from "./authenticator.mjs";

test("PostgreSQL: passkey lifecycle, account isolation, revisions and recovery", async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  const db = await openStore(process.env.TEST_DATABASE_URL);
  const app = createApp(db, { origin: "http://localhost:8766", rpID: "localhost" });
  const ids = [];
  function client() {
    const cookies = new Map();
    const address = randomUUID();
    return async (path, method = "GET", body, origin = "http://localhost:8766") => {
      const headers = { Origin: origin, Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await app(new Request(`http://localhost:8787/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), address);
      for (const cookie of response.headers.getSetCookie()) {
        const [name, value] = cookie.split(";", 1)[0].split("=");
        cookies.set(name, value);
      }
      return { status: response.status, data: await response.json(), headers: response.headers };
    };
  }
  const register = async (request, device, vaultId = null) => {
    const options = await request("/register/options", "POST", { vaultId });
    assert.equal(options.status, 200);
    const credential = device.register(options.data.options);
    const result = await request("/register/verify", "POST", { ...credential, vaultId });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    ids.push(result.data.vaultId);
    return { ...result.data, credential };
  };
  try {
    const a = client(), b = client(), visitor = client();
    assert.equal((await visitor("/presets")).status, 401);
    assert.equal((await visitor("/register/options", "POST", {}, "https://other.example")).status, 403);
    const firstKey = authenticator();
    const accountA = await register(a, firstKey);
    assert.ok(accountA.recoveryCode);
    assert.equal((await a("/register/verify", "POST", accountA.credential)).status, 400, "challenge cannot be replayed");
    const accountB = await register(b, authenticator());
    assert.notEqual(accountA.vaultId, accountB.vaultId);
    const presets = [{ id: "pump-test", name: "펌프 제품", category: "카샴푸", ratio: 500, waterL: 15, pumpMl: 2.5, note: "" }];
    const aPresets = `/presets?vaultId=${accountA.vaultId}`;
    const bPresets = `/presets?vaultId=${accountB.vaultId}`;
    assert.equal((await a(aPresets)).data.vaultId, accountA.vaultId);
    assert.equal((await a("/presets")).status, 428);
    assert.equal((await a(bPresets)).status, 401);
    assert.equal((await a("/presets", "PUT", { presets, revision: 0 })).status, 428, "old unbound clients must refresh before writing");
    for (const vaultId of [accountB.vaultId, null, 123, { id: accountA.vaultId }]) {
      assert.equal((await a("/presets", "PUT", { vaultId, presets, revision: 0 })).status, 401);
    }
    assert.equal((await a(aPresets)).data.revision, 0, "rejected target IDs must never mutate a vault");
    const saved = await a("/presets", "PUT", { vaultId: accountA.vaultId, presets, revision: 0 });
    assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1);
    assert.equal((await b(bPresets)).data.presets.length, 0, "other accounts cannot read presets");
    assert.equal((await a("/presets", "PUT", { vaultId: accountA.vaultId, presets: [], revision: 0 })).status, 409);
    assert.equal((await a(aPresets)).data.presets[0].pumpMl, 2.5);
    const concurrent = await Promise.all([a("/presets", "PUT", { vaultId: accountA.vaultId, presets, revision: 1 }), a("/presets", "PUT", { vaultId: accountA.vaultId, presets, revision: 1 })]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await a("/presets", "PUT", { vaultId: accountA.vaultId, presets: [{ ...presets[0], pumpMl: -1 }], revision: 2 })).status, 400);
    const login = client();
    let options = await login("/login/options", "POST", {});
    const assertion = firstKey.login(options.data.options);
    assert.equal((await login("/login/verify", "POST", assertion)).status, 200);
    assert.equal((await login("/session")).data.vaultId, accountA.vaultId);
    assert.equal((await login("/login/verify", "POST", assertion)).status, 400);
    options = await visitor("/login/options", "POST", {});
    const tampered = firstKey.login(options.data.options);
    tampered.response.signature = Buffer.alloc(70).toString("base64url");
    assert.equal((await visitor("/login/verify", "POST", tampered)).status, 400);
    const extraKey = authenticator();
    const added = await register(a, extraKey, accountA.vaultId);
    assert.equal(added.vaultId, accountA.vaultId); assert.equal(added.recoveryCode, undefined);
    assert.equal(Number((await a("/session")).data.passkeys), 2);
    const recovery = client();
    const recovered = await recovery("/recover", "POST", { code: accountA.recoveryCode });
    assert.equal(recovered.status, 200); assert.notEqual(recovered.data.recoveryCode, accountA.recoveryCode);
    assert.equal((await a("/session")).status, 401, "recovery revokes existing sessions");
    assert.equal((await login("/session")).status, 401);
    assert.equal((await recovery(aPresets)).data.presets[0].name, "펌프 제품");
    assert.equal(Number((await recovery("/session")).data.passkeys), 0, "recovery revokes old passkeys");
    assert.equal((await visitor("/recover", "POST", { code: accountA.recoveryCode })).status, 400);
    options = await visitor("/login/options", "POST", {});
    assert.equal((await visitor("/login/verify", "POST", firstKey.login(options.data.options))).status, 400);
    const recoveredKey = await register(recovery, authenticator(), accountA.vaultId);
    assert.equal(recoveredKey.vaultId, accountA.vaultId);
    assert.equal((await recovery("/logout", "POST", { vaultId: accountA.vaultId })).status, 200);
    assert.equal((await recovery("/presets")).status, 401);
    assert.equal((await b("/session")).status, 200);
  } finally {
    for (const id of new Set(ids)) await db.run("DELETE FROM vaults WHERE id = ?", id);
    await db.close();
  }
});
