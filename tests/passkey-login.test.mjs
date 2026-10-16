import test from "node:test";
import assert from "node:assert/strict";
import { createPasskeyLogin, AUTO_LOGIN_KEY } from "../passkey-login.js";
import { SYNC_KEYS } from "../vault-sync.js";

function harness({ remembered = false, owner = "", immediate = false, fail, storageFails = false } = {}) {
  const values = new Map([[SYNC_KEYS.owner, owner]]);
  if (remembered) values.set(AUTO_LOGIN_KEY, "enabled");
  const calls = [];
  const storage = {
    getItem(key) { if (storageFails) throw Error("blocked"); return values.get(key); },
    setItem(key, value) { if (storageFails) throw Error("blocked"); values.set(key, value); },
  };
  const credential = { id: "signed-assertion" };
  const login = createPasskeyLogin({ storage,
    api: async path => { calls.push(path); if (fail) throw fail; return path.endsWith("options") ? { options: { challenge: "challenge" } } : { vaultId: "vault-a" }; },
    authenticate: async options => { calls.push(["authenticate", options]); return credential; },
    connect: async id => { calls.push(["connect", id]); },
    publicKeyCredential: {
      getClientCapabilities: async () => ({ immediateGet: immediate }),
      parseRequestOptionsFromJSON: options => ({ ...options, parsed: true }),
    },
    credentials: { get: async options => { calls.push(["get", options]); return { toJSON: () => credential }; } },
  });
  return { login, values, calls };
}

test("returning passkey users authenticate and connect without clicking login", async () => {
  for (const options of [{ remembered: true }, { owner: "existing-vault" }]) {
    const h = harness(options);
    await h.login.automatic();
    assert.deepEqual(h.calls.map(call => Array.isArray(call) ? call[0] : call), ["/login/options", "authenticate", "/login/verify", "connect"]);
    assert.equal(h.values.get(AUTO_LOGIN_KEY), "enabled");
    await h.login.automatic();
    assert.equal(h.calls.length, 4, "only once per page load");
  }
});

test("first-time visitors without immediate support are not prompted", async () => {
  const h = harness(); await h.login.automatic(); assert.deepEqual(h.calls, []);
});

test("immediate-capable browsers discover synced passkeys without a local hint", async () => {
  const h = harness({ immediate: true }); await h.login.automatic();
  assert.deepEqual(h.calls[1], ["get", { publicKey: { challenge: "challenge", parsed: true }, uiMode: "immediate" }]);
  assert.deepEqual(h.calls.at(-1), ["connect", "vault-a"]);
});

test("explicit logout pauses automatic login across reloads until manual authentication", async () => {
  const h = harness({ remembered: true, immediate: true }); h.login.pause();
  await h.login.automatic(); assert.deepEqual(h.calls, []);
  await h.login.manual(); assert.equal(h.values.get(AUTO_LOGIN_KEY), "enabled");
});

test("cancelled or failed authentication never connects or retries automatically", async () => {
  for (const fail of [Object.assign(Error("cancelled"), { name: "NotAllowedError" }), Error("offline")]) {
    const h = harness({ remembered: true, fail });
    await assert.rejects(h.login.automatic(), fail);
    await h.login.automatic();
    assert.deepEqual(h.calls, ["/login/options"]);
  }
});

test("blocked local storage cannot break manual authentication", async () => {
  const h = harness({ storageFails: true });
  await h.login.automatic(); assert.deepEqual(h.calls, []);
  await h.login.manual(); assert.deepEqual(h.calls.at(-1), ["connect", "vault-a"]);
});
