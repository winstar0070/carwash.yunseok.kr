import { parseBackup, mergePresets } from "./backup-data.js";

const storageKey = "carwash_yunseok_presets_v1";
const fileInput = document.getElementById("backupFileInput");
const status = document.getElementById("backupStatus");
const preview = document.getElementById("backupPreview");
const previewNames = document.getElementById("backupPreviewNames");
const applyButton = document.getElementById("applyBackupBtn");
let pending = null;

document.getElementById("exportBackupBtn").addEventListener("click", () => {
  try {
    const presets = JSON.parse(localStorage.getItem(storageKey) || "[]");
    const data = { format: "carwash-presets", version: 1, exportedAt: new Date().toISOString(), presets };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `carwash-presets-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "백업 파일을 내보냈습니다. 다른 기기에서도 이 파일을 불러올 수 있어요.";
  } catch {
    status.textContent = "백업을 내보내지 못했어요. 브라우저의 저장 공간 설정을 확인해 주세요.";
  }
});

fileInput.addEventListener("change", async () => {
  pending = null;
  preview.hidden = true;
  const file = fileInput.files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("1MB 이하의 JSON 파일을 선택해 주세요.");
    const rows = parseBackup(await file.text());
    pending = rows;
    previewNames.textContent = rows.slice(0, 5).map((row) => row.name).join(", ") + (rows.length > 5 ? ` 외 ${rows.length - 5}개` : "");
    status.textContent = `${rows.length}개 제품을 확인했습니다. 기존 목록은 유지하고 동일한 항목은 건너뜁니다.`;
    preview.hidden = false;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "파일을 읽지 못했어요. JSON 백업 파일을 확인해 주세요.";
  } finally {
    fileInput.value = "";
  }
});

applyButton.addEventListener("click", () => {
  if (!pending) return;
  try {
    const current = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(current)) throw new Error("저장된 목록을 확인할 수 없습니다. 먼저 백업을 내보내 주세요.");
    const result = mergePresets(current, pending, () => `preset-${crypto.randomUUID()}`);
    localStorage.setItem(storageKey, JSON.stringify(result.presets));
    window.dispatchEvent(new Event("carwash-presets-imported"));
    pending = null;
    preview.hidden = true;
    status.textContent = `${result.added}개 추가, 동일한 항목 ${result.skipped}개 건너뜀. 이 기기에 저장했습니다.`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.";
  }
});

document.getElementById("cancelBackupBtn").addEventListener("click", () => {
  pending = null;
  preview.hidden = true;
  status.textContent = "불러오기를 취소했습니다. 기존 목록은 그대로입니다.";
});
