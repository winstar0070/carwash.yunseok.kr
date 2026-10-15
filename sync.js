import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { mergePresets } from "./backup-data.js";

const key = "carwash_yunseok_presets_v1";
const queueKey = "carwash_vault_queue_v1";
const ownerKey = "carwash_local_owner_v1";
const guestKey = "carwash_guest_presets_v1";
const status = document.getElementById("syncStatus");
const guestActions = document.getElementById("syncGuestActions");
const accountActions = document.getElementById("syncAccountActions");
const choice = document.getElementById("syncChoice");
const recoveryBox = document.getElementById("recoveryCodeBox");
const codeOutput = document.getElementById("recoveryCodeOutput");
const base = (window.CARWASH_API_BASE || "/api").replace(/\/$/, "");
let connected = null;
let enabled = false;
let busy = false;
let timer;
let conflict = false;

class ApiError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; }
}
const getPresets = () => JSON.parse(localStorage.getItem(key) || "[]");
const getQueue = () => JSON.parse(localStorage.getItem(queueKey) || "{}");
const writeQueue = (id, data) => localStorage.setItem(queueKey, JSON.stringify({ ...getQueue(), [id]: data }));
const fingerprint = (rows) => JSON.stringify(rows);
const showStatus = (message) => { status.textContent = message; };

async function api(path, method = "GET", body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${base}${path}`, { method, credentials: "include", cache: "no-store", signal: controller.signal, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let result;
    try { result = await response.json(); }
    catch { throw new ApiError(response.status, "동기화 서버에 연결하지 못했어요. 기기 내 저장은 계속 사용할 수 있습니다."); }
    if (!response.ok) throw new ApiError(response.status, result.error || "서버 요청에 실패했습니다.");
    return result;
  } finally { clearTimeout(timeout); }
}

function applyPresets(rows, owner) {
  localStorage.setItem(key, JSON.stringify(rows));
  localStorage.setItem(ownerKey, owner || "");
  window.dispatchEvent(new Event("carwash-presets-imported"));
}

function showSession() {
  guestActions.hidden = !!connected;
  accountActions.hidden = !connected;
  document.getElementById("vaultLabel").textContent = connected ? `보관함 ${connected.slice(0, 8)}` : "패스키로 내 보관함 열기";
}

function showRecovery(code) {
  if (!code) return;
  codeOutput.value = code;
  recoveryBox.hidden = false;
  document.getElementById("syncPanel").open = true;
}

async function connect(id) {
  const previousOwner = localStorage.getItem(ownerKey);
  if (!previousOwner) localStorage.setItem(guestKey, JSON.stringify(getPresets()));
  connected = id;
  enabled = false;
  conflict = false;
  showSession();
  const saved = getQueue()[id];
  if (saved?.dirty && previousOwner !== id) applyPresets(saved.presets, id);
  const remote = await api("/presets");
  const local = getPresets();
  if (previousOwner === id && saved && !saved.dirty && fingerprint(local) === fingerprint(remote.presets)) {
    enabled = true;
    writeQueue(id, { presets: local, revision: remote.revision, dirty: false });
    showStatus("제품과 펌프 설정이 동기화되어 있습니다.");
    return;
  }
  choice.hidden = false;
  document.getElementById("syncChoiceText").textContent = `기기 ${local.length}개 · 서버 ${remote.presets.length}개. 사용할 목록을 선택하세요. 합치기는 동일한 항목을 건너뜁니다.`;
  showStatus("보관함을 열었습니다. 목록을 선택하면 이후 변경사항은 자동 저장됩니다.");
}

async function flush() {
  if (!connected || !enabled || busy || conflict || localStorage.getItem(ownerKey) !== connected) return;
  const queued = getQueue()[connected];
  if (!queued?.dirty) return;
  busy = true;
  const id = connected;
  const snapshot = getPresets();
  try {
    const result = await api("/presets", "PUT", { presets: snapshot, revision: queued.revision });
    const changed = fingerprint(getPresets()) !== fingerprint(snapshot);
    writeQueue(id, { presets: getPresets(), revision: result.revision, dirty: changed });
    showStatus(changed ? "새 변경사항을 추가로 저장하고 있어요." : "제품과 펌프 설정을 서버에 저장했습니다.");
    if (changed) timer = setTimeout(flush, 700);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 409) {
      conflict = true;
      choice.hidden = false;
      document.getElementById("syncPanel").open = true;
      document.getElementById("syncChoiceText").textContent = "다른 기기에서도 목록이 바뀌었습니다. 합칠지, 어느 목록을 사용할지 선택하세요. 선택 전까지 기기 목록은 유지됩니다.";
      showStatus(error.message);
    } else if (error instanceof ApiError && error.statusCode === 401) {
      connected = null; enabled = false; showSession();
      showStatus("변경사항은 이 기기에 보관했습니다. 패스키로 다시 열면 동기화할 수 있어요.");
    } else {
      showStatus("변경사항은 이 기기에 보관했습니다. 연결되면 다시 저장합니다.");
    }
  } finally { busy = false; }
}

function localChanged() {
  const owner = localStorage.getItem(ownerKey);
  if (!owner) return;
  const queued = getQueue()[owner];
  if (!queued || fingerprint(queued.presets) === fingerprint(getPresets())) return;
  try { writeQueue(owner, { ...queued, presets: getPresets(), dirty: true }); }
  catch { showStatus("동기화 대기 목록을 저장하지 못했어요. 백업 파일을 내보내 주세요."); return; }
  clearTimeout(timer);
  timer = setTimeout(flush, 700);
}

async function chooseList(mode) {
  if (!connected) return;
  const remote = await api("/presets");
  const local = getPresets();
  const rows = mode === "cloud" ? remote.presets : mode === "merge" ? mergePresets(remote.presets, local, () => `preset-${crypto.randomUUID()}`).presets : local;
  const result = mode === "cloud" ? remote : await api("/presets", "PUT", { presets: rows, revision: remote.revision });
  if (fingerprint(getPresets()) !== fingerprint(local)) {
    writeQueue(connected, { presets: getPresets(), revision: result.revision, dirty: true });
    localStorage.setItem(ownerKey, connected);
    enabled = true; conflict = false; choice.hidden = true;
    showStatus("저장 중 추가된 변경사항을 이어서 동기화합니다.");
    timer = setTimeout(flush, 700);
    return;
  }
  writeQueue(connected, { presets: result.presets, revision: result.revision, dirty: false });
  applyPresets(result.presets, connected);
  enabled = true; conflict = false; choice.hidden = true;
  showStatus("동기화가 연결되었습니다. 오프라인 변경도 이 기기에 보관됩니다.");
}

async function register() {
  const { options } = await api("/register/options", "POST", {});
  const credential = await startRegistration({ optionsJSON: options });
  const result = await api("/register/verify", "POST", credential);
  showRecovery(result.recoveryCode);
  if (connected === result.vaultId) showStatus("이 보관함에 패스키를 추가했습니다.");
  else await connect(result.vaultId);
}

function bind(id, action) {
  document.getElementById(id).addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    document.querySelectorAll("#syncPanel button").forEach((button) => { button.disabled = true; });
    try { await action(); }
    catch (error) {
      if (error?.name === "NotAllowedError" || error?.name === "AbortError") showStatus("인증이 취소되었거나 시간이 초과됐어요. 다시 시도할 수 있습니다.");
      else showStatus(error instanceof Error ? error.message : "처리하지 못했어요. 다시 시도해 주세요.");
    } finally {
      busy = false;
      document.querySelectorAll("#syncPanel button").forEach((button) => { button.disabled = false; });
    }
  });
}

bind("createVaultBtn", register);
bind("addPasskeyBtn", register);
bind("openVaultBtn", async () => {
  const { options } = await api("/login/options", "POST", {});
  const credential = await startAuthentication({ optionsJSON: options });
  const result = await api("/login/verify", "POST", credential);
  await connect(result.vaultId);
});
bind("mergeCloudBtn", () => chooseList("merge"));
bind("useCloudBtn", () => chooseList("cloud"));
bind("useLocalBtn", () => chooseList("local"));
bind("refreshCloudBtn", async () => {
  if (!enabled || getQueue()[connected]?.dirty) {
    choice.hidden = false; conflict = true;
    document.getElementById("syncChoiceText").textContent = "이 기기에 아직 저장하지 못한 변경사항이 있습니다. 사용할 목록을 선택하세요.";
  } else {
    const snapshot = fingerprint(getPresets());
    const remote = await api("/presets");
    if (fingerprint(getPresets()) !== snapshot) {
      choice.hidden = false; conflict = true;
      document.getElementById("syncChoiceText").textContent = "불러오는 동안 기기 목록이 바뀌었습니다. 사용할 목록을 선택하세요.";
      return;
    }
    writeQueue(connected, { ...remote, dirty: false });
    applyPresets(remote.presets, connected);
    enabled = true; conflict = false; choice.hidden = true;
    showStatus("서버의 최신 목록을 불러왔습니다.");
  }
});
bind("logoutVaultBtn", async () => {
  await api("/logout", "POST", {});
  connected = null; enabled = false; conflict = false; choice.hidden = true;
  recoveryBox.hidden = true; codeOutput.value = "";
  applyPresets(JSON.parse(localStorage.getItem(guestKey) || "[]"), null);
  showSession();
  showStatus("보관함을 닫았습니다. 다시 열면 계정의 목록을 불러올 수 있습니다.");
});
bind("rotateRecoveryBtn", async () => { const result = await api("/recovery-code", "POST", {}); showRecovery(result.recoveryCode); showStatus("새 복구 코드가 발급되었습니다. 이전 코드는 사용할 수 없습니다."); });
bind("recoverVaultBtn", async () => {
  const result = await api("/recover", "POST", { code: document.getElementById("recoveryInput").value });
  document.getElementById("recoveryInput").value = "";
  showRecovery(result.recoveryCode);
  await connect(result.vaultId);
  showStatus("보관함을 복구했습니다. 기존 패스키는 해제되었습니다. 패스키를 새로 추가하고 새 복구 코드를 보관해 주세요.");
});
bind("saveRecoveryBtn", async () => {
  const url = URL.createObjectURL(new Blob([`세차 계산기 복구 코드\n${codeOutput.value}\n한 번 사용하면 새 코드가 발급됩니다. 다른 사람에게 공유하지 마세요.\n`], { type: "text/plain" }));
  const link = document.createElement("a"); link.href = url; link.download = "carwash-recovery-code.txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
bind("hideRecoveryBtn", async () => { recoveryBox.hidden = true; codeOutput.value = ""; });
window.addEventListener("carwash-presets-changed", localChanged);
window.addEventListener("carwash-presets-imported", localChanged);
window.addEventListener("online", () => { resume(); });
window.addEventListener("focus", () => { if (connected) flush(); });
window.addEventListener("storage", (event) => { if (event.key === key) localChanged(); });

if (!browserSupportsWebAuthn()) {
  document.getElementById("createVaultBtn").disabled = true;
  document.getElementById("openVaultBtn").disabled = true;
  showStatus("이 브라우저에서는 패스키를 사용할 수 없습니다. 기기 내 저장과 백업은 사용할 수 있어요.");
} else { resume(); }

async function resume() {
  try {
    const session = await api("/session");
    const saved = getQueue()[session.vaultId];
    if (localStorage.getItem(ownerKey) === session.vaultId && saved) {
      connected = session.vaultId; enabled = true; showSession();
      if (saved.dirty) await flush();
      else {
        const remote = await api("/presets");
        if (fingerprint(getPresets()) === fingerprint(saved.presets)) {
          writeQueue(connected, { ...remote, dirty: false }); applyPresets(remote.presets, connected);
        }
        showStatus("보관함이 연결되어 있습니다.");
      }
    } else await connect(session.vaultId);
  } catch (error) {
    showStatus(error instanceof ApiError && error.statusCode === 401 ? "계정 정보 입력 없이 패스키로 시작할 수 있어요." : "현재 기기에 저장 중입니다. 서버에 연결되면 패스키로 보관함을 열 수 있어요.");
  }
}
