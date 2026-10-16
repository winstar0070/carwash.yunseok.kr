import test from "node:test";
import assert from "node:assert/strict";
import { createVaultSync, SYNC_KEYS } from "../vault-sync.js";

const clone = value => structuredClone(value);
const row = id => ({ id, name: id, category: "카샴푸", ratio: 500, waterL: 15, pumpMl: null, note: "" });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness({ local = [], remote = [], revision = 0, owner = "", saved, request, canApplyRemote } = {}) {
  const values = new Map([[SYNC_KEYS.presets, JSON.stringify(local)], [SYNC_KEYS.owner, owner]]);
  if (saved) values.set(SYNC_KEYS.queue, JSON.stringify(saved));
  const storageWrites = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { storageWrites.push({ key, value }); values.set(key, value); } };
  const server = { presets: clone(remote), revision };
  const calls = [], states = [], applied = [], timers = new Map();
  let timerID = 0;
  const api = async (path, method = "GET", body) => {
    calls.push({ path, method, body: clone(body) });
    const override = await request?.({ path, method, body, server });
    if (override !== undefined) return override;
    if (path === "/session") return { vaultId: "vault-a" };
    if (method === "GET") return clone(server);
    if (body.revision !== server.revision) throw Object.assign(new Error("conflict"), { statusCode: 409 });
    server.presets = clone(body.presets); server.revision++;
    return clone(server);
  };
  const sync = createVaultSync({ storage, api, canApplyRemote,
    applyPresets: (rows, id) => { applied.push(clone(rows)); storage.setItem(SYNC_KEYS.presets, JSON.stringify(rows)); storage.setItem(SYNC_KEYS.owner, id || ""); },
    onState: state => states.push(state),
    setTimer: (callback, delay) => { timers.set(++timerID, { callback, delay }); return timerID; },
    clearTimer: id => timers.delete(id),
  });
  return { sync, storage, storageWrites, server, calls, states, applied, timers,
    edit: rows => storage.setItem(SYNC_KEYS.presets, JSON.stringify(rows)),
    local: () => JSON.parse(storage.getItem(SYNC_KEYS.presets)),
    queue: id => JSON.parse(storage.getItem(SYNC_KEYS.queue) || "{}")[id],
    puts: () => calls.filter(call => call.method === "PUT"),
  };
}

test("authenticated add, edit and delete immediately reach the server, including an empty list", async () => {
  const h = harness({ local: [row("guest")] });
  await h.sync.connect("vault-a");
  assert.deepEqual(h.local(), []);
  h.edit([row("new")]); await h.sync.changed();
  h.edit([{ ...row("new"), ratio: 1000 }]); await h.sync.changed();
  h.edit([]); await h.sync.changed();
  assert.deepEqual(h.puts().map(call => call.body.presets), [[row("new")], [{ ...row("new"), ratio: 1000 }], []]);
  assert.equal(h.server.revision, 3);
  assert.equal(h.queue("vault-a").dirty, false);
  await h.sync.resume();
  assert.deepEqual(h.local(), [], "a deleted final product must not return on reconnect");
  assert.equal(h.states.at(-1).phase, "saved");
});

test("a newly created vault starts automatic sync with the device list without a list-choice step", async () => {
  const h = harness({ local: [row("device")] });
  await h.sync.connect("vault-a", { created: true });
  assert.deepEqual(h.server.presets, [row("device")]);
  assert.equal(h.states.some(state => state.phase === "conflict"), false);
  assert.deepEqual(JSON.parse(h.storage.getItem(SYNC_KEYS.guest)), [row("device")]);
});

test("rapid changes during an in-flight save are sent serially with the latest revision", async () => {
  const waiting = deferred(), started = deferred();
  let writes = 0;
  const h = harness({ request: async ({ method }) => {
    if (method === "PUT" && ++writes === 1) { started.resolve(); await waiting.promise; }
  } });
  await h.sync.connect("vault-a");
  h.edit([row("first")]); const first = h.sync.changed(); await started.promise;
  h.edit([row("second")]); const second = h.sync.changed();
  waiting.resolve(); await Promise.all([first, second]);
  assert.deepEqual(h.puts().map(call => call.body.revision), [0, 1]);
  assert.deepEqual(h.server.presets, [row("second")]);
  assert.equal(h.queue("vault-a").dirty, false);
});

test("reload recovers a change written before the change event listener was ready", async () => {
  const old = row("old");
  const h = harness({ local: [], remote: [old], revision: 4, owner: "vault-a", saved: { "vault-a": { presets: [old], revision: 4, dirty: false } } });
  await h.sync.resume();
  assert.deepEqual(h.server.presets, []);
  assert.equal(h.server.revision, 5);
});

test("offline deletion stays queued and retries automatically after a temporary failure", async () => {
  let offline = false;
  const h = harness({ remote: [row("old")], request: ({ method }) => { if (offline && method === "PUT") throw new TypeError("offline"); } });
  await h.sync.connect("vault-a"); offline = true;
  h.edit([]); await h.sync.changed();
  assert.equal(h.queue("vault-a").dirty, true);
  assert.equal(h.states.at(-1).phase, "offline");
  assert.equal(h.timers.size, 1);
  offline = false;
  const timer = h.timers.values().next().value; h.timers.clear(); await timer.callback();
  assert.deepEqual(h.server.presets, []);
  assert.equal(h.queue("vault-a").dirty, false);
});

test("a pending account-specific deletion resumes after signing in again", async () => {
  const h = harness({ local: [row("guest")], remote: [row("old")], revision: 2, saved: { "vault-a": { presets: [], revision: 2, dirty: true } } });
  await h.sync.connect("vault-a");
  assert.deepEqual(h.server.presets, []);
  assert.deepEqual(JSON.parse(h.storage.getItem(SYNC_KEYS.guest)), [row("guest")]);
});

test("remote changes cause a visible conflict instead of restoring deleted products silently", async () => {
  const h = harness({ remote: [row("old")] });
  await h.sync.connect("vault-a");
  h.server.presets.push(row("other-device")); h.server.revision++;
  h.edit([]); await h.sync.changed();
  assert.equal(h.states.at(-1).phase, "conflict");
  assert.deepEqual(h.local(), []);
  assert.equal(h.queue("vault-a").dirty, true);
  await h.sync.choose("local");
  assert.deepEqual(h.server.presets, []);
  assert.equal(h.states.at(-1).phase, "saved");
});

test("choosing cloud or merge remains available for an actual conflict", async () => {
  for (const mode of ["cloud", "merge"]) {
    const h = harness({ remote: [row("remote")] });
    await h.sync.connect("vault-a");
    h.server.revision++; h.edit([row("local")]); await h.sync.changed();
    await h.sync.choose(mode);
    assert.deepEqual(h.local().map(item => item.name).sort(), mode === "cloud" ? ["remote"] : ["local", "remote"]);
    assert.equal(h.queue("vault-a").dirty, false);
  }
});

test("a late response after logout cannot replace guest data or mark unsaved work clean", async () => {
  const waiting = deferred(), started = deferred();
  const h = harness({ local: [row("guest")], request: async ({ method }) => { if (method === "PUT") { started.resolve(); await waiting.promise; } } });
  await h.sync.connect("vault-a");
  h.edit([row("private")]); const saving = h.sync.changed(); await started.promise;
  h.sync.disconnect(); waiting.resolve(); await saving;
  assert.equal(h.sync.vaultId, null);
  assert.deepEqual(h.local(), [row("guest")]);
  assert.equal(h.queue("vault-a").dirty, true);
  assert.equal(h.queue("vault-a").revision, 0);
});

test("signing into another account does not upload the previous account's pending data", async () => {
  const saved = { "vault-a": { presets: [row("private-a")], revision: 7, dirty: true } };
  const h = harness({ local: [row("private-a")], owner: "vault-a", saved, remote: [row("private-b")], revision: 3 });
  await h.sync.connect("vault-b");
  assert.deepEqual(h.local(), [row("private-b")]);
  assert.deepEqual(h.queue("vault-a"), saved["vault-a"]);
  assert.equal(h.puts().length, 0);
});

test("expired authentication preserves pending changes and stops authenticated writes", async () => {
  const h = harness({ request: ({ method }) => { if (method === "PUT") throw Object.assign(new Error("expired"), { statusCode: 401 }); } });
  await h.sync.connect("vault-a");
  h.edit([row("pending")]); await h.sync.changed();
  assert.equal(h.sync.vaultId, null);
  assert.equal(h.states.at(-1).phase, "expired");
  assert.equal(h.queue("vault-a").dirty, true);
  await h.sync.flush(); assert.equal(h.puts().length, 1);
});

test("a local edit made while fetching the server list is not overwritten", async () => {
  const waiting = deferred(), started = deferred();
  let reads = 0;
  const old = row("old");
  const h = harness({ local: [old], remote: [old], owner: "vault-a", saved: { "vault-a": { presets: [old], revision: 0, dirty: false } }, request: async ({ path, method }) => {
    if (path === "/presets" && method === "GET" && ++reads === 1) { started.resolve(); await waiting.promise; }
  } });
  const connecting = h.sync.connect("vault-a"); await started.promise;
  h.edit([]); await h.sync.changed(); waiting.resolve(); await connecting;
  assert.deepEqual(h.local(), []); assert.deepEqual(h.server.presets, []);
});

test("changes made during a conflict choice keep both accepted server rows and the latest local edits", async () => {
  const waiting = deferred(), started = deferred(); let delay = false;
  const h = harness({ remote: [row("remote")], request: async ({ method }) => { if (delay && method === "PUT") { delay = false; started.resolve(); await waiting.promise; } } });
  await h.sync.connect("vault-a"); h.server.revision++;
  h.edit([row("local")]); await h.sync.changed(); delay = true;
  const choosing = h.sync.choose("merge"); await started.promise;
  h.edit([row("local"), row("late")]); await h.sync.changed(); waiting.resolve(); await choosing;
  assert.deepEqual(h.server.presets.map(item => item.name).sort(), ["late", "local", "remote"]);
  assert.equal(h.queue("vault-a").dirty, false);
});

test("echoed import events and unchanged lists do not write to the server", async () => {
  const h = harness({ remote: [row("remote")] }); await h.sync.connect("vault-a");
  await h.sync.changed(); await h.sync.changed();
  assert.equal(h.puts().length, 0);
});

test("a delayed refresh cannot resurrect a product deleted by a newer acknowledged save", async () => {
  const waiting = deferred(), started = deferred(); let delay = false;
  const h = harness({ remote: [row("old")], request: async ({ path, method, server }) => {
    if (delay && path === "/presets" && method === "GET") {
      delay = false; const snapshot = clone(server); started.resolve(); await waiting.promise; return snapshot;
    }
  } });
  await h.sync.connect("vault-a"); delay = true;
  const refreshing = h.sync.refresh(); await started.promise;
  h.edit([]); await h.sync.changed(); waiting.resolve(); await refreshing;
  assert.deepEqual(h.local(), []);
  assert.equal(h.queue("vault-a").revision, h.server.revision);
});

test("creating another vault never seeds it with the previous account's private list", async () => {
  const h = harness({ owner: "vault-a", local: [row("private-a")], saved: { "vault-a": { presets: [row("private-a")], revision: 3, dirty: false } } });
  await h.sync.connect("vault-b", { created: true });
  assert.deepEqual(h.local(), []); assert.equal(h.puts().length, 0);
});

test("a missing baseline requires an explicit choice even after reconnecting", async () => {
  const h = harness({ owner: "vault-a", local: [row("local")], remote: [row("remote")] });
  await h.sync.connect("vault-a");
  assert.equal(h.states.at(-1).phase, "conflict");
  await h.sync.resume(); await h.sync.connect("vault-a");
  assert.equal(h.states.at(-1).phase, "conflict");
  assert.equal(h.puts().length, 0);
  await h.sync.choose("cloud"); assert.deepEqual(h.local(), [row("remote")]);
});

test("a first guest visit is not shown as an expired authenticated session", async () => {
  const h = harness({ request: () => { throw Object.assign(new Error("no session"), { statusCode: 401 }); } });
  await h.sync.resume(); assert.equal(h.states.at(-1).phase, "guest");
});

test("a storage failure stops automatic writes until the pending change can be retained", async () => {
  const h = harness(); await h.sync.connect("vault-a"); h.edit([row("pending")]);
  const set = h.storage.setItem;
  h.storage.setItem = (key, value) => { if (key === SYNC_KEYS.queue) throw new Error("quota"); set(key, value); };
  await h.sync.changed(); assert.equal(h.states.at(-1).phase, "error"); assert.equal(h.puts().length, 0);
});

test("a permanent validation error keeps the local edit without an endless retry loop", async () => {
  const h = harness({ request: ({ method }) => { if (method === "PUT") throw Object.assign(new Error("invalid product"), { statusCode: 400 }); } });
  await h.sync.connect("vault-a"); h.edit([row("invalid")]); await h.sync.changed();
  assert.equal(h.states.at(-1).phase, "error"); assert.equal(h.timers.size, 0);
  assert.equal(h.queue("vault-a").dirty, true);
});

test("checking for server changes refreshes only a changed list and reports that it was fetched", async () => {
  const h = harness({ remote: [row("old")] }); await h.sync.connect("vault-a");
  const count = h.applied.length;
  await h.sync.refresh(); assert.equal(h.applied.length, count);
  h.server.presets.push(row("new")); h.server.revision++;
  await h.sync.refresh();
  assert.deepEqual(h.local(), [row("old"), row("new")]);
  assert.equal(h.states.at(-1).phase, "updated");
  await h.sync.refresh(); assert.equal(h.applied.length, count + 1);
});

test("new server data is deferred while a product is being edited, then applied on close", async () => {
  let editing = false;
  const h = harness({ remote: [row("old")], canApplyRemote: () => !editing });
  await h.sync.connect("vault-a"); editing = true;
  h.server.presets = []; h.server.revision++;
  await h.sync.refresh();
  assert.equal(h.states.at(-1).phase, "remotePending"); assert.deepEqual(h.local(), [row("old")]);
  editing = false; await h.sync.refresh();
  assert.deepEqual(h.local(), []); assert.equal(h.queue("vault-a").revision, 1);
});

test("a new vault keeps its initial device list queued if the first server read fails", async () => {
  let failed = false;
  const h = harness({ local: [row("device")], request: ({ path }) => {
    if (path === "/presets" && !failed) { failed = true; throw new TypeError("offline"); }
  } });
  await h.sync.connect("vault-a", { created: true });
  assert.equal(h.queue("vault-a")?.dirty, true);
  await h.sync.resume(); assert.deepEqual(h.server.presets, [row("device")]);
});

test("a failed conflict resolution keeps the choice available for another attempt", async () => {
  let offline = false;
  const h = harness({ request: () => { if (offline) throw new TypeError("offline"); } });
  await h.sync.connect("vault-a"); h.server.revision++;
  h.edit([row("local")]); await h.sync.changed(); offline = true;
  await h.sync.choose("local");
  assert.equal(h.states.at(-1).needsChoice, true);
  offline = false; await h.sync.choose("local");
  assert.deepEqual(h.server.presets, [row("local")]);
});


test("concurrent refresh and reconnect share one preset read without rewriting unchanged storage", async () => {
  const waiting = deferred(), started = deferred(); let delay = false;
  const h = harness({ remote: [row("old")], request: async ({ path, method }) => {
    if (delay && path === "/presets" && method === "GET") { started.resolve(); await waiting.promise; }
  } });
  await h.sync.connect("vault-a");
  h.calls.length = 0; h.storageWrites.length = 0; delay = true;
  const first = h.sync.refresh(); await started.promise;
  const second = h.sync.refresh(), third = h.sync.refresh(), reconnecting = h.sync.resume();
  // Let the session lookup join the already-running refresh.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call.path === "/presets").length, 1);
  waiting.resolve(); await Promise.all([first, second, third, reconnecting]);
  assert.equal(h.storageWrites.filter(write => write.key === SYNC_KEYS.queue).length, 0);
  assert.equal(h.states.at(-1).phase, "saved");
});

test("a newer server revision is persisted once even if the rows are unchanged", async () => {
  const h = harness({ remote: [row("old")] }); await h.sync.connect("vault-a");
  h.storageWrites.length = 0; const applied = h.applied.length;
  h.server.revision++;
  await Promise.all([h.sync.refresh(), h.sync.refresh()]);
  assert.equal(h.queue("vault-a").revision, 1);
  assert.equal(h.storageWrites.filter(write => write.key === SYNC_KEYS.queue).length, 1);
  assert.equal(h.applied.length, applied);
});

test("a failed shared refresh can retry and still receive server changes", async () => {
  let fail = false;
  const h = harness({ request: ({ path }) => { if (fail && path === "/presets") throw new TypeError("offline"); } });
  await h.sync.connect("vault-a"); fail = true; h.calls.length = 0;
  await Promise.all([h.sync.refresh(), h.sync.refresh(), h.sync.refresh()]);
  assert.equal(h.calls.length, 1); assert.equal(h.states.at(-1).phase, "offline");
  fail = false; h.server.presets = [row("new")]; h.server.revision++;
  await h.sync.refresh();
  assert.deepEqual(h.local(), [row("new")]); assert.equal(h.timers.size, 0);
});

test("an old account refresh neither blocks a new account nor clears its active refresh", async () => {
  const oldWaiting = deferred(), oldStarted = deferred(), newWaiting = deferred(), newStarted = deferred();
  let phase = "connect";
  const h = harness({ request: async ({ path, method, server }) => {
    if (path !== "/presets" || method !== "GET") return;
    if (phase === "old") { const snapshot = clone(server); oldStarted.resolve(); await oldWaiting.promise; return snapshot; }
    if (phase === "new") { newStarted.resolve(); await newWaiting.promise; }
  } });
  await h.sync.connect("vault-a"); phase = "old";
  const oldRefresh = h.sync.refresh(); await oldStarted.promise;
  phase = "connect"; h.server.presets = [row("private-b")];
  await h.sync.connect("vault-b"); phase = "new";
  const currentRefresh = h.sync.refresh(); await newStarted.promise;
  oldWaiting.resolve(); await oldRefresh;
  const reads = h.calls.length;
  const joined = h.sync.refresh(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, reads, "late old finalization must not clear the new flight");
  newWaiting.resolve(); await Promise.all([currentRefresh, joined]);
  assert.deepEqual(h.local(), [row("private-b")]); assert.equal(h.sync.vaultId, "vault-b");
});

test("logging out during a refresh preserves guest data and does not recreate a queue entry", async () => {
  const waiting = deferred(), started = deferred(); let delay = false;
  const h = harness({ local: [row("guest")], remote: [row("private")], request: async ({ path, method }) => {
    if (delay && path === "/presets" && method === "GET") { started.resolve(); await waiting.promise; }
  } });
  await h.sync.connect("vault-a"); delay = true;
  const refreshing = h.sync.refresh(); await started.promise;
  h.sync.disconnect(); h.storageWrites.length = 0;
  waiting.resolve(); await refreshing;
  assert.deepEqual(h.local(), [row("guest")]);
  assert.equal(h.storageWrites.length, 0); assert.equal(h.states.at(-1).phase, "guest");
});

test("a refresh waiting for an old account save never queries the next account", async () => {
  const waiting = deferred(), started = deferred();
  const h = harness({ request: async ({ method }) => {
    if (method === "PUT") { started.resolve(); await waiting.promise; }
  } });
  await h.sync.connect("vault-a");
  h.edit([row("pending-a")]); const saving = h.sync.changed(); await started.promise;
  const refreshing = h.sync.refresh();
  h.server.presets = [row("private-b")]; await h.sync.connect("vault-b");
  const reads = h.calls.filter(call => call.method === "GET").length;
  waiting.resolve(); await Promise.all([saving, refreshing]);
  assert.equal(h.calls.filter(call => call.method === "GET").length, reads);
  assert.deepEqual(h.local(), [row("private-b")]);
  assert.equal(h.queue("vault-a").dirty, true);
});

test("shared refresh preserves remotePending during editing and applies the remote deletion after closing", async () => {
  let editing = false;
  const h = harness({ remote: [row("old")], canApplyRemote: () => !editing });
  await h.sync.connect("vault-a"); editing = true;
  h.server.presets = []; h.server.revision++;
  h.calls.length = 0; h.storageWrites.length = 0;
  await Promise.all([h.sync.refresh(), h.sync.refresh(), h.sync.refresh()]);
  assert.equal(h.calls.length, 1); assert.equal(h.states.at(-1).phase, "remotePending");
  assert.deepEqual(h.local(), [row("old")]); assert.equal(h.storageWrites.length, 0);
  editing = false; await h.sync.refresh();
  assert.deepEqual(h.local(), []); assert.equal(h.queue("vault-a").revision, 1);
});
