export function parseWaterGuidance(value) {
  if (value == null) return undefined;
  if (typeof value !== "object" || !Number.isFinite(value.waterL) || value.waterL <= 0 || value.waterL > 1000
    || typeof value.approximate !== "boolean" || typeof value.claim !== "string" || value.claim.length > 1000
    || typeof value.sourceUrl !== "string" || value.sourceUrl.length > 2000) throw new Error("제품의 권장 물량 정보를 확인해 주세요.");
  if (value.sourceUrl) {
    const source = new URL(value.sourceUrl);
    if (!["https:", "http:"].includes(source.protocol)) throw new Error("제품 출처 URL을 확인해 주세요.");
  }
  return { waterL: value.waterL, approximate: value.approximate, sourceUrl: value.sourceUrl, claim: value.claim };
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data) && (data?.format !== "carwash-presets" || data?.version !== 1)) {
    throw new Error("지원하지 않는 백업 형식입니다. 이 계산기에서 내보낸 JSON 파일을 선택해 주세요.");
  }
  const rows = Array.isArray(data) ? data : data.presets;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) {
    throw new Error("한 번에 1개부터 500개까지 불러올 수 있습니다.");
  }
  return rows.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`${index + 1}번째 제품 정보를 확인해 주세요.`);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const category = typeof row.category === "string" ? row.category.trim() : "기타";
    const note = typeof row.note === "string" ? row.note.trim() : "";
    const pumpMl = row.pumpMl ?? null;
    if (!name || name.length > 80 || category.length > 40 || note.length > 300
      || !Number.isFinite(row.ratio) || row.ratio <= 0 || row.ratio > 1000000
      || !Number.isFinite(row.waterL) || row.waterL <= 0 || row.waterL > 1000
      || (pumpMl !== null && (!Number.isFinite(pumpMl) || pumpMl <= 0 || pumpMl > 1000))) {
      throw new Error(`${index + 1}번째 제품의 이름·비율·물 용량·펌프 토출량을 확인해 주세요.`);
    }
    const waterGuidance = parseWaterGuidance(row.waterGuidance);
    return { name, category, note, ratio: row.ratio, waterL: row.waterL, pumpMl, ...(waterGuidance ? { waterGuidance } : {}) };
  });
}

export function mergePresets(existing, incoming, createId) {
  const signature = (row) => JSON.stringify([row.name, row.category || "기타", row.ratio, row.waterL, row.note || "", row.pumpMl ?? null, row.waterGuidance ?? null]);
  const seen = new Set(existing.map(signature));
  const added = [];
  for (const row of incoming) {
    const key = signature(row);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ ...row, id: createId() });
  }
  return { presets: [...existing, ...added], added: added.length, skipped: incoming.length - added.length };
}
