export const SYNC_KEYS = Object.freeze({
  presets: "carwash_yunseok_presets_v1", queue: "carwash_vault_queue_v1",
  owner: "carwash_local_owner_v1", guest: "carwash_guest_presets_v1",
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const signature = row => JSON.stringify([row.name, row.category || "기타", row.ratio, row.waterL, row.note || "", row.pumpMl ?? null]);

// Keep stable IDs for local rows so edits/deletions made during a request can be replayed.
function mergeRows(remote, local) {
  const rows = [...remote], ids = new Map(), seen = new Map(remote.map(row => [signature(row), row.id]));
  const used = new Set(remote.map(row => row.id));
  for (const row of local) {
    let id = seen.get(signature(row));
    if (!id) {
      id = used.has(row.id) ? `preset-${crypto.randomUUID()}` : row.id;
      rows.push({ ...row, id }); used.add(id); seen.set(signature(row), id);
    }
    ids.set(row.id, id);
  }
  return { rows, ids };
}

function replayEdits(accepted, before, after, ids) {
  const previous = new Map(before.map(row => [row.id, row]));
  const latest = new Map(after.map(row => [row.id, row]));
  const rows = new Map(accepted.map(row => [row.id, row]));
  for (const row of before) if (!latest.has(row.id)) rows.delete(ids.get(row.id) || row.id);
  for (const row of after) {
    if (same(previous.get(row.id), row)) continue;
    const id = ids.get(row.id) || row.id;
    rows.set(id, { ...row, id });
  }
  return [...rows.values()];
}

export function createVaultSync({ storage, api, applyPresets, onState, canApplyRemote = () => true, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let vaultId = null, ready = false, conflict = false, resolving = false;
  let epoch = 0, flight = null, resuming = null, retryTimer, retryDelay = 1000;
  const read = (key, fallback) => JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
  const local = () => read(SYNC_KEYS.presets, []);
  const owner = () => storage.getItem(SYNC_KEYS.owner);
  const queued = id => read(SYNC_KEYS.queue, {})[id];
  const write = (id, entry) => storage.setItem(SYNC_KEYS.queue, JSON.stringify({ ...read(SYNC_KEYS.queue, {}), [id]: entry }));
  const valid = (version, id) => epoch === version && vaultId === id;
  const notify = (phase, message) => onState({ vaultId, phase, message, needsChoice: conflict });
  const clearRetry = () => { clearTimer(retryTimer); retryTimer = undefined; };
  const saved = (updated = false) => { clearRetry(); retryDelay = 1000; notify(updated ? "updated" : "saved", updated ? "서버에서 바뀐 제품 목록을 불러왔습니다. 변경사항은 자동 저장됩니다." : "제품 추가·수정·삭제가 서버에 자동 저장됩니다."); };
  const showConflict = () => {
    conflict = true; clearRetry();
    notify("conflict", "다른 기기에서도 목록이 바뀌었습니다. 사용할 목록을 선택하세요. 합치면 삭제한 제품이 다시 추가될 수 있습니다.");
  };
  function remember() {
    const id = owner();
    if (!id) return;
    const entry = queued(id);
    if (entry && !same(entry.presets, local())) write(id, { ...entry, presets: local(), dirty: true });
  }
  function failure(error) {
    if (error.statusCode === 401) {
      const hadAccount = !!vaultId || !!owner();
      epoch++; vaultId = null; ready = false; conflict = false; clearRetry();
      notify(hadAccount ? "expired" : "guest", hadAccount ? "변경사항은 이 기기에 보관했습니다. 패스키로 다시 열면 자동으로 저장합니다." : "계정 정보 입력 없이 패스키로 시작할 수 있어요.");
    } else if (error.statusCode === 409) showConflict();
    else if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
      notify("error", error.message);
    } else {
      notify("offline", "변경사항은 이 기기에 보관했습니다. 연결되면 자동으로 다시 저장합니다.");
      clearRetry();
      retryTimer = setTimer(() => { retryTimer = undefined; return resume(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  }
  function clean(remote, id) {
    const changed = !same(local(), remote.presets) || owner() !== id;
    write(id, { ...remote, dirty: false });
    if (changed) applyPresets(remote.presets, id);
    ready = true; conflict = false; saved(changed);
  }

  async function connect(id, { created = false } = {}) {
    const version = ++epoch;
    clearRetry(); vaultId = id; ready = false; conflict = false;
    notify("loading", "보관함을 연결하고 있어요. 연결 후 변경사항은 자동으로 저장됩니다.");
    try {
      const previousOwner = owner();
      remember();
      if (!previousOwner) storage.setItem(SYNC_KEYS.guest, JSON.stringify(local()));
      if (created && !previousOwner) {
        write(id, { presets: local(), revision: 0, dirty: true });
        storage.setItem(SYNC_KEYS.owner, id);
      }
      const entry = queued(id);
      if (previousOwner !== id && entry?.dirty) applyPresets(entry.presets, id);
      const initial = local();
      const remote = await api("/presets");
      if (!valid(version, id)) return;
      const current = local(), pending = queued(id);
      if (previousOwner === id || entry?.dirty) {
        if (same(current, remote.presets)) { clean(remote, id); return; }
        if (pending?.dirty || !same(current, initial)) {
          write(id, { presets: current, revision: pending ? pending.revision : null, dirty: true });
          storage.setItem(SYNC_KEYS.owner, id); ready = true;
          if (!pending || pending.revision !== remote.revision) showConflict();
          else await flush();
        } else if (!pending) {
          write(id, { presets: current, revision: null, dirty: true });
          showConflict();
        }
        else clean(remote, id);
      } else if (!same(current, initial)) {
        write(id, { presets: current, revision: null, dirty: true });
        storage.setItem(SYNC_KEYS.owner, id); ready = true; showConflict();
      } else clean(remote, id);
    } catch (error) { if (valid(version, id)) failure(error); }
  }

  function flush() {
    if (!vaultId || !ready || conflict || resolving || owner() !== vaultId) return Promise.resolve();
    if (flight?.epoch === epoch) return flight.promise;
    const id = vaultId, version = epoch;
    const promise = (async () => {
      try {
        remember();
        while (valid(version, id) && !conflict && owner() === id) {
          const entry = queued(id);
          if (!entry?.dirty) return;
          const snapshot = entry.presets;
          notify("saving", "변경사항을 서버에 저장하고 있어요.");
          const result = await api("/presets", "PUT", { presets: snapshot, revision: entry.revision });
          if (!valid(version, id) || owner() !== id) return;
          const latest = local(), changed = !same(latest, snapshot);
          write(id, { presets: changed ? latest : result.presets, revision: result.revision, dirty: changed });
          if (!changed) { if (!same(snapshot, result.presets)) applyPresets(result.presets, id); saved(); }
        }
      } catch (error) { if (valid(version, id)) failure(error); }
    })();
    flight = { epoch: version, promise };
    void promise.finally(() => { if (flight?.promise === promise) flight = null; });
    return promise;
  }

  function changed() {
    try { remember(); }
    catch { notify("error", "동기화 대기 목록을 저장하지 못했어요. 백업 파일을 내보내 주세요."); return Promise.resolve(); }
    return flush();
  }

  async function refresh() {
    if (!vaultId || !ready || conflict || resolving) return;
    await flush();
    if (!vaultId || conflict || queued(vaultId)?.dirty) return;
    const version = epoch, id = vaultId;
    try {
      const remote = await api("/presets");
      if (!valid(version, id)) return;
      remember();
      if (remote.revision < queued(id)?.revision) return;
      if (queued(id)?.dirty) {
        if (queued(id).revision !== remote.revision) showConflict();
        else await flush();
      } else if (!canApplyRemote() && !same(local(), remote.presets)) {
        notify("remotePending", "서버에 새 목록이 있습니다. 작성 중인 제품을 저장하거나 취소하면 목록을 갱신합니다.");
      } else clean(remote, id);
    } catch (error) { if (valid(version, id)) failure(error); }
  }

  function resume() {
    if (resuming) return resuming;
    const version = epoch;
    const promise = (async () => {
      try {
        const session = await api("/session");
        if (epoch !== version) return;
        if (vaultId === session.vaultId && conflict) return;
        if (vaultId === session.vaultId && ready) await refresh();
        else await connect(session.vaultId);
      } catch (error) { if (epoch === version) failure(error); }
    })();
    resuming = promise;
    void promise.finally(() => { if (resuming === promise) resuming = null; });
    return promise;
  }

  async function choose(mode) {
    if (!vaultId || resolving) return;
    if (!["cloud", "local", "merge"].includes(mode)) throw new Error("사용할 목록을 선택해 주세요.");
    const version = epoch, id = vaultId;
    resolving = true; clearRetry();
    try {
      const remote = await api("/presets");
      if (!valid(version, id)) return;
      const before = local();
      const selection = mode === "merge" ? mergeRows(remote.presets, before) : { rows: mode === "cloud" ? remote.presets : before, ids: new Map() };
      const result = mode === "cloud" ? remote : await api("/presets", "PUT", { presets: selection.rows, revision: remote.revision });
      if (!valid(version, id)) return;
      const latest = local();
      const rows = same(latest, before) ? result.presets : replayEdits(result.presets, before, latest, selection.ids);
      write(id, { presets: rows, revision: result.revision, dirty: !same(rows, result.presets) });
      applyPresets(rows, id); ready = true; conflict = false;
      if (!queued(id).dirty) saved();
    } catch (error) { if (valid(version, id)) failure(error); }
    finally { resolving = false; }
    if (valid(version, id)) await flush();
  }

  function disconnect() {
    remember(); epoch++; vaultId = null; ready = false; conflict = false; clearRetry();
    applyPresets(read(SYNC_KEYS.guest, []), null);
    notify("guest", "보관함을 닫았습니다. 다시 열면 계정의 목록을 불러올 수 있습니다.");
  }

  return { connect, changed, flush, resume, refresh, choose, disconnect, get vaultId() { return vaultId; } };
}
