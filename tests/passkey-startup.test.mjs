import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createPasskeyLogin, AUTO_LOGIN_KEY } from "../src/client/passkey-login.js";
import { createVaultSync } from "../src/client/vault-sync.js";

const source = (await readFile(new URL("../src/client/sync.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
async function page({ session = false, supported = true, remembered = true, offline = false, cancel = false, legacyServer = false } = {}) {
  const elements = new Map(), calls = [], listeners = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, value: "", textContent: "", classList: { contains: () => false },
      addEventListener(type, fn) { listeners.set(`${id}:${type}`, fn); },
    });
    return elements.get(id);
  };
  const values = new Map(); if (remembered) values.set(AUTO_LOGIN_KEY, "enabled");
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let authenticated = session;
  const context = {
    createPasskeyLogin, createVaultSync, SYNC_KEYS: (await import("../src/client/vault-sync.js")).SYNC_KEYS,
    startRegistration: async () => { calls.push("registrar"); return { id: "new-key" }; },
    startAuthentication: async () => { calls.push("authenticator"); if (cancel) throw Object.assign(Error("cancelled"), { name: "NotAllowedError" }); return { id: "assertion" }; },
    browserSupportsWebAuthn: () => supported,
    localStorage: storage, AbortController, Event, setTimeout, clearTimeout, setInterval() {},
    window: { addEventListener() {}, dispatchEvent() {} },
    document: { getElementById: element, querySelectorAll: () => [...elements.values()], addEventListener() {} },
    fetch: async (url, init) => {
      const parsed = new URL(url, "http://localhost");
      const path = parsed.pathname.replace("/api", ""); calls.push(path);
      if (offline) throw new TypeError("offline");
      let status = 200, data;
      if (path === "/session") { status = authenticated ? 200 : 401; data = authenticated ? { vaultId: "vault-a" } : { error: "login required" }; }
      if (path === "/login/options") data = { options: { challenge: "fresh" } };
      if (path === "/login/verify") { assert.deepEqual(JSON.parse(init.body), { id: "assertion" }); authenticated = true; data = { vaultId: "vault-a" }; }
      if (path === "/register/options") {
        assert.equal(JSON.parse(init.body).vaultId, authenticated ? "vault-a" : null);
        data = { options: {}, ...(legacyServer ? {} : { vaultId: authenticated ? "vault-a" : null }) };
      }
      if (path === "/register/verify") {
        assert.equal(JSON.parse(init.body).vaultId, authenticated ? "vault-a" : null);
        data = { vaultId: "vault-a", ...(authenticated ? {} : { recoveryCode: "new-recovery" }) }; authenticated = true;
      }
      if (path === "/presets") { assert.equal(parsed.searchParams.get("vaultId"), "vault-a"); data = { ...(legacyServer ? {} : { vaultId: "vault-a" }), presets: [], revision: 0 }; }
      if (path === "/logout") { assert.equal(JSON.parse(init.body).vaultId, "vault-a"); authenticated = false; data = {}; }
      return { ok: status === 200, status, json: async () => data };
    },
  };
  // Keep retry timers inert, but retain the API timeout cleanup behavior.
  const inertSync = options => createVaultSync({ ...options, setTimer: () => 1, clearTimer() {} });
  context.createVaultSync = inertSync;
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { calls, elements, values, click: id => listeners.get(`${id}:click`)(), settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test("page startup restores an active session without a passkey prompt", async () => {
  const h = await page({ session: true });
  assert.deepEqual(h.calls, ["/session", "/presets"]);
  assert.equal(h.elements.get("syncGuestActions").hidden, true);
});

test("page startup authenticates returning users, verifies on server and opens their vault", async () => {
  const h = await page();
  assert.deepEqual(h.calls, ["/session", "/login/options", "authenticator", "/login/verify", "/presets"]);
  assert.equal(h.elements.get("syncGuestActions").hidden, true);
  assert.match(h.elements.get("vaultLabel").textContent, /보관함 vault-a/);
  h.click("logoutVaultBtn"); await h.settle();
  assert.equal(h.values.get(AUTO_LOGIN_KEY), "paused");
  assert.equal(h.elements.get("syncAccountActions").hidden, true);
});

test("cancelling automatic login leaves manual retry usable", async () => {
  const h = await page({ cancel: true });
  assert.equal(h.calls.includes("/login/verify"), false);
  assert.equal(h.elements.get("openVaultBtn").disabled, false);
  h.click("openVaultBtn"); await h.settle();
  assert.equal(h.calls.filter(path => path === "authenticator").length, 2);
  assert.match(h.elements.get("syncStatus").textContent, /인증이 취소/);
});

test("new visitors, offline startup and unsupported browsers do not attempt authentication", async () => {
  for (const options of [{ remembered: false }, { offline: true }, { supported: false }]) {
    const h = await page(options);
    assert.equal(h.calls.includes("/login/options"), false);
    assert.equal(h.calls.includes("authenticator"), false);
  }
});

test("detecting an old server disables all account mutations, even direct stale button events", async () => {
  const h = await page({ session: true, legacyServer: true });
  const calls = h.calls.length;
  for (const id of ['addPasskeyBtn', 'rotateRecoveryBtn', 'logoutVaultBtn']) {
    h.click(id); await h.settle();
  }
  assert.equal(h.elements.get('syncAccountActions').hidden, true);
  assert.equal(h.calls.length, calls, 'unsupported account operations must never reach an old API');
});

test("new-vault and additional-passkey registration preserve their explicit target", async () => {
  for (const session of [false, true]) {
    const h = await page({ session, remembered: false });
    h.click(session ? 'addPasskeyBtn' : 'createVaultBtn'); await h.settle();
    assert.ok(h.calls.includes('registrar'));
    assert.ok(h.calls.includes('/register/verify'));
    assert.equal(h.elements.get('syncAccountActions').hidden, false);
  }
});

test("new visitors never verify registration against an old server with unknown target binding", async () => {
  const h = await page({ legacyServer: true, remembered: false });
  h.click('createVaultBtn'); await h.settle();
  assert.ok(h.calls.includes('/register/options'));
  assert.equal(h.calls.includes('registrar'), false);
  assert.equal(h.calls.includes('/register/verify'), false);
});
