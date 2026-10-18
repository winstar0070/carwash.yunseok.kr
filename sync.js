import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { createVaultSync, SYNC_KEYS } from "./vault-sync.js";
import { createPasskeyLogin } from "./passkey-login.js";

const key = "carwash_yunseok_presets_v1";
const status = document.getElementById("syncStatus");
const guestActions = document.getElementById("syncGuestActions");
const accountActions = document.getElementById("syncAccountActions");
const choice = document.getElementById("syncChoice");
const recoveryBox = document.getElementById("recoveryCodeBox");
const codeOutput = document.getElementById("recoveryCodeOutput");
const base = (window.CARWASH_API_BASE || "/api").replace(/\/$/, "");
let busy = false;
let interacted = false;
let sessionMissing = false;

class ApiError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; }
}
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
  localStorage.setItem(SYNC_KEYS.owner, owner || "");
  window.dispatchEvent(new Event("carwash-presets-imported"));
}

function showSession(connected) {
  guestActions.hidden = !!connected;
  accountActions.hidden = !connected;
  document.getElementById("vaultLabel").textContent = connected ? `보관함 ${connected.slice(0, 8)}` : "패스키로 내 보관함 열기";
}

const sync = createVaultSync({ storage: localStorage, api, applyPresets,
  canApplyRemote: () => !document.getElementById("presetForm").classList.contains("is-open"),
  onState({ vaultId, phase, message, needsChoice }) {
    sessionMissing = phase === "guest" || phase === "expired";
    showSession(vaultId);
    if (!sync.canManageAccount) accountActions.hidden = true;
    choice.hidden = !needsChoice;
    if (phase === "conflict") {
      document.getElementById("syncPanel").open = true;
      document.getElementById("syncChoiceText").textContent = message;
    }
    if (!vaultId) { recoveryBox.hidden = true; codeOutput.value = ""; }
    const labels = {
      loading: "보관함 연결 중 · 기기에도 저장됩니다.", saving: "서버에 자동 저장 중입니다.",
      saved: "서버에 자동 저장되었습니다.", updated: "서버의 최신 목록을 반영했습니다.",
      remotePending: "서버에 새 목록이 있습니다. 작성이 끝나면 갱신합니다.",
      offline: "이 기기에 저장됨 · 연결되면 자동 동기화합니다.",
      conflict: "이 기기에 저장됨 · 동기화할 목록을 선택해 주세요.",
      expired: "이 기기에 저장됨 · 패스키로 다시 연결해 주세요.", error: "이 기기에 저장됨 · 동기화 상태를 확인해 주세요.",
    };
    document.getElementById("presetStorageStatus").textContent = labels[phase] || "이 기기의 브라우저에 저장됩니다.";
    showStatus(message);
  },
});

const login = createPasskeyLogin({ storage: localStorage, api, authenticate: startAuthentication,
  connect: id => sync.connect(id),
});

function showRecovery(code) {
  if (!code) return;
  codeOutput.value = code;
  recoveryBox.hidden = false;
  document.getElementById("syncPanel").open = true;
}

async function register() {
  const vaultId = sync.vaultId;
  if (vaultId) requireAccount();
  const resultOptions = await api("/register/options", "POST", { vaultId });
  if (resultOptions.vaultId === undefined) throw new ApiError(428, "동기화 서버 업데이트가 필요합니다. 변경사항은 이 기기에 보관됩니다.");
  if (resultOptions.vaultId !== vaultId) throw new ApiError(401, "보관함이 바뀌었습니다. 다시 열어 주세요.");
  const { options } = resultOptions;
  const credential = await startRegistration({ optionsJSON: options });
  const result = await api("/register/verify", "POST", { ...credential, vaultId });
  login.remember();
  showRecovery(result.recoveryCode);
  if (sync.vaultId === result.vaultId) showStatus("이 보관함에 패스키를 추가했습니다.");
  else await sync.connect(result.vaultId, { created: !!result.recoveryCode });
}

function requireAccount() {
  if (!sync.canManageAccount) throw new ApiError(428, "보관함 연결과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.");
  return sync.vaultId;
}

async function runAction(action, automatic = false) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("#syncPanel button").forEach((button) => { button.disabled = true; });
  try { await action(); }
  catch (error) {
    if (automatic && (error?.name === "NotAllowedError" || error?.name === "AbortError")) return;
    if (error?.name === "NotAllowedError" || error?.name === "AbortError") showStatus("인증이 취소되었거나 시간이 초과됐어요. 다시 시도할 수 있습니다.");
    else showStatus(error instanceof Error ? error.message : "처리하지 못했어요. 다시 시도해 주세요.");
  } finally {
    busy = false;
    document.querySelectorAll("#syncPanel button").forEach((button) => { button.disabled = false; });
  }
}

function bind(id, action) {
  document.getElementById(id).addEventListener("click", () => {
    interacted = true;
    void runAction(action);
  });
}

bind("createVaultBtn", register);
bind("addPasskeyBtn", register);
bind("openVaultBtn", login.manual);
bind("mergeCloudBtn", () => sync.choose("merge"));
bind("useCloudBtn", () => sync.choose("cloud"));
bind("useLocalBtn", () => sync.choose("local"));
bind("refreshCloudBtn", () => sync.refresh());
bind("logoutVaultBtn", async () => {
  const vaultId = requireAccount();
  await sync.flush();
  requireAccount();
  await api("/logout", "POST", { vaultId });
  login.pause();
  sync.disconnect();
});
bind("rotateRecoveryBtn", async () => { const result = await api("/recovery-code", "POST", { vaultId: requireAccount() }); showRecovery(result.recoveryCode); showStatus("새 복구 코드가 발급되었습니다. 이전 코드는 사용할 수 없습니다."); });
bind("recoverVaultBtn", async () => {
  const result = await api("/recover", "POST", { code: document.getElementById("recoveryInput").value });
  login.pause(); // Recovery revokes every old passkey; registering a new one enables it again.
  document.getElementById("recoveryInput").value = "";
  showRecovery(result.recoveryCode);
  await sync.connect(result.vaultId);
  showStatus("보관함을 복구했습니다. 기존 패스키는 해제되었습니다. 패스키를 새로 추가하고 새 복구 코드를 보관해 주세요.");
});
bind("saveRecoveryBtn", async () => {
  const url = URL.createObjectURL(new Blob([`세차 계산기 복구 코드\n${codeOutput.value}\n한 번 사용하면 새 코드가 발급됩니다. 다른 사람에게 공유하지 마세요.\n`], { type: "text/plain" }));
  const link = document.createElement("a"); link.href = url; link.download = "carwash-recovery-code.txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
bind("hideRecoveryBtn", async () => { recoveryBox.hidden = true; codeOutput.value = ""; });
window.addEventListener("carwash-presets-changed", () => { void sync.changed(); });
window.addEventListener("carwash-presets-imported", () => { void sync.changed(); });
window.addEventListener("online", () => { void sync.resume(); });
window.addEventListener("focus", () => { void sync.resume(); });
window.addEventListener("storage", (event) => { if (event.key === key) void sync.changed(); });
document.getElementById("presetForm").addEventListener("carwash:preset-close", () => { void sync.refresh(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void sync.resume(); });
setInterval(() => { if (document.visibilityState === "visible") void sync.refresh(); }, 15000);

if (!browserSupportsWebAuthn()) {
  document.getElementById("createVaultBtn").disabled = true;
  document.getElementById("openVaultBtn").disabled = true;
  showStatus("이 브라우저에서는 패스키를 사용할 수 없습니다. 기기 내 저장은 사용할 수 있어요.");
} else {
  void (async () => {
    await sync.resume();
    if (sessionMissing && !sync.vaultId && !interacted) await runAction(() => login.automatic(), true);
  })();
}
