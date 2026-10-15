import { METHODS, searchProducts, getProfiles, getRatioOptions, getPresetDefaults, getPumpOptions, loadCatalog } from "./catalog-data.js";

const $ = id => document.getElementById(id);
const form = $("presetForm");
const name = $("presetNameInput");
const results = $("catalogResults");
const status = $("catalogStatus");
const selection = $("catalogSelection");
const variant = $("catalogVariant");
const profile = $("catalogProfile");
const ratioChoice = $("catalogRatioChoice");
const pumpChoice = $("catalogPumpChoice");
const ratio = $("presetRatioInput");
const water = $("presetWaterInput");
const pump = $("presetPumpInput");
let catalog, loading, chosen, matches = [], active = -1, pumps = [];

function setOptions(select, rows, prompt) {
  select.replaceChildren();
  if (prompt) select.add(new Option(prompt, ""));
  for (const [value, label] of rows) select.add(new Option(label, value));
}

function setSourceLink(link, source) {
  link.hidden = true;
  link.removeAttribute("href");
  try {
    const url = new URL(source);
    if (["https:", "http:"].includes(url.protocol)) { link.href = url.href; link.hidden = false; }
  } catch { /* A missing or unsafe source is never turned into a link. */ }
}

function closeResults() {
  results.hidden = true;
  name.setAttribute("aria-expanded", "false");
  name.removeAttribute("aria-activedescendant");
  active = -1;
}

function clearSelection() {
  chosen = null;
  selection.hidden = true;
  $("catalogRatioHelp").hidden = true;
  $("catalogWaterHelp").hidden = true;
  ratio.disabled = false;
  water.readOnly = false;
  $("submitPresetFormBtn").disabled = false;
  closeResults();
}

function showMatches() {
  if (!catalog || chosen || document.activeElement !== name || !form.classList.contains("is-open")) return;
  matches = searchProducts(catalog.data.products, name.value);
  closeResults();
  results.replaceChildren();
  for (const [index, product] of matches.entries()) {
    const option = document.createElement("li");
    option.className = "catalog-option";
    option.id = `catalog-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = product.name;
    const detail = document.createElement("small");
    detail.textContent = product.variants.length > 1 ? `${product.variants.length}개 판매 옵션 · 선택 후 용량 확인` : product.variants[0]?.option_name || "판매 옵션 확인";
    option.append(detail);
    option.addEventListener("pointerdown", event => event.preventDefault());
    option.addEventListener("click", () => chooseProduct(product));
    results.append(option);
  }
  results.hidden = matches.length === 0;
  name.setAttribute("aria-expanded", String(matches.length > 0));
  const prefix = catalog.cached ? "연결할 수 없어 마지막으로 받은 목록을 사용해요. " : "";
  status.textContent = prefix + (!name.value.trim() ? "제품명·브랜드를 입력해 검색하세요. 직접 입력도 가능해요." : matches.length ? `${matches.length}개 검색 결과. 맞는 제품을 선택하세요. ↑↓ 키와 Enter로도 선택할 수 있어요.` : "일치하는 제품이 없어요. 다른 검색어를 입력하거나 직접 저장할 수 있어요.");
}

async function ensureCatalog() {
  if (catalog) { showMatches(); return; }
  if (loading) return loading;
  status.textContent = "공용 제품 목록을 불러오고 있어요…";
  $("catalogRetry").hidden = true;
  loading = (async () => {
    try {
      let storage;
      try { storage = localStorage; } catch { /* Manual entry also works without storage. */ }
      catalog = await loadCatalog(window.CARWASH_API_BASE || "/api", { storage });
      showMatches();
    } catch {
      status.textContent = "제품 목록에 연결할 수 없어요. 직접 입력하거나 다시 불러와 주세요.";
      $("catalogRetry").hidden = false;
    } finally { loading = null; }
  })();
  return loading;
}

function chooseProduct(product) {
  chosen = product;
  closeResults();
  name.value = product.name;
  ratio.value = "";
  water.value = "";
  pump.value = "";
  $("presetNoteInput").value = "";
  $("presetCategoryInput").value = "기타";
  selection.hidden = false;
  setOptions(variant, product.variants.map(row => [row.variant_id, row.option_name + (row.volume_ml ? ` · ${row.volume_ml.toLocaleString("ko")}ml 용기` : "")]), product.variants.length === 1 ? null : "사용 중인 용량·옵션을 선택하세요");
  updateVariant();
  status.textContent = "등록된 제품을 선택했어요. 판매 옵션과 사용 방법을 확인해 주세요.";
}

function updateVariant() {
  const profiles = getProfiles(chosen, variant.value);
  setOptions(profile, profiles.map(row => {
    const options = getRatioOptions(row);
    const label = row.fixed_dose_calculation_allowed === true && row.proportional_scaling_allowed === false ? "정량 투입 지침" : options.length ? options.map(value => `1:${value}`).join(" ~ ") : "비율 확인 필요";
    return [row.profile_id, `${METHODS[row.method]?.[0] || "기타 사용 방법"} · ${label}`];
  }), "사용 방법을 선택하세요");
  profile.disabled = profiles.length === 0;
  const usable = profiles.filter(row => getRatioOptions(row).length > 0 || (row.fixed_dose_calculation_allowed === true && row.proportional_scaling_allowed === false));
  if (usable.length === 1) profile.value = usable[0].profile_id;
  else if (profiles.length === 1) profile.value = profiles[0].profile_id;
  pumps = getPumpOptions(chosen, variant.value);
  setOptions(pumpChoice, pumps.map((row, index) => [String(index), `${row.pump_type === "optional" ? "별도 판매 펌프" : "확인된 펌프"} · ${row.pump_ml_min}ml/회`]), "미사용 / 직접 입력");
  $("catalogPumpChoiceField").hidden = pumps.length === 0;
  $("catalogPumpSummary").textContent = pumps.map(row => typeof row.note === "string" ? row.note.split(". ")[0] : "표시된 모델을 장착한 경우에만 선택하세요.").join(" ");
  $("catalogPumpNote").textContent = pumps.map(row => row.note || row.raw_claim || "펌프 모델과 토출량을 확인해 주세요.").join(" ");
  setSourceLink($("catalogPumpSourceLink"), pumps[0]?.source_url);
  pump.value = "";
  updateProfile();
}

function updateProfile() {
  const current = getProfiles(chosen, variant.value).find(row => row.profile_id === profile.value);
  const defaults = getPresetDefaults(chosen, variant.value, profile.value);
  name.value = defaults.name;
  ratio.value = defaults.ratio ?? "";
  ratio.disabled = defaults.fixedDose;
  water.readOnly = defaults.fixedDose;
  $("submitPresetFormBtn").disabled = defaults.fixedDose;
  water.value = defaults.waterL ?? "";
  $("presetCategoryInput").value = defaults.category;
  $("presetNoteInput").value = defaults.note;
  const options = getRatioOptions(current);
  const needsChoice = options.length > 0 && defaults.ratio === null;
  $("catalogRatioChoiceField").hidden = !needsChoice;
  setOptions(ratioChoice, options.map(value => [String(value), `원액 1 : 물 ${value}`]), "지침을 확인해 선택 / 직접 입력");
  $("catalogRatioHelp").hidden = false;
  $("catalogRatioHelp").textContent = defaults.fixedDose ? "정량 캡슐 투입 지침만 확인된 제품이에요. 물 양에 비례한 희석 계산이나 비율 프리셋 저장을 지원하지 않아요. 원문 지침을 확인하세요." : !current ? "사용 방법을 선택하면 해당 옵션의 비율을 불러와요." : !options.length ? "물 기준의 희석비율이 확인되지 않았어요. 제품 지침을 확인해 직접 입력하세요." : needsChoice ? "등록된 값은 범위 또는 한쪽 한계값이에요. 원문 조건을 확인해 선택하거나 직접 입력하세요." : "원액 1 : 물 기준의 확인된 비율이에요." + (current.method === "foam_lance" ? " 폼랜스 통 사전 혼합비이며 분사 후 농도가 아니에요." : "");
  $("catalogWaterHelp").hidden = false;
  $("catalogWaterHelp").textContent = defaults.waterSource === "catalog" ? `DB 사용 지침의 물 ${defaults.waterApproximate ? "약 " : ""}${defaults.waterL}L예요.` + (defaults.fixedDose ? " 정량 투입 제품이므로 물 양에 비례해 환산하지 마세요." : " 원문 사용 조건을 확인하세요.") : defaults.waterL === null ? "채울 물의 양을 직접 입력하세요." : `앱의 장비 기본값 ${defaults.waterL}L예요. 제조사 권장 물량이 아니며, 실제 채울 물의 양으로 바꿔 주세요.`;
  $("catalogSource").hidden = !current;
  $("catalogClaim").textContent = current?.raw_claim || "등록된 원문이 없어요.";
  $("catalogEvidence").textContent = current?.conversion_note || "";
  const selectedVariant = chosen.variants.find(row => row.variant_id === variant.value);
  $("catalogChecked").textContent = selectedVariant?.source_checked_at ? `출처 확인일 ${selectedVariant.source_checked_at} · 실제 제품의 최신 사용 지침을 확인하세요.` : "실제 제품의 최신 사용 지침을 확인하세요.";
  const source = current?.source_url || selectedVariant?.source_url;
  setSourceLink($("catalogSourceLink"), source);
}

name.addEventListener("focus", ensureCatalog);
name.addEventListener("input", () => {
  if (chosen) { clearSelection(); ratio.value = ""; pump.value = ""; $("presetNoteInput").value = ""; }
  if (catalog) showMatches(); else ensureCatalog();
});
name.addEventListener("blur", closeResults);
name.addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (event.key === "Escape") { closeResults(); return; }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (results.hidden) showMatches();
    if (results.hidden || !matches.length) return;
    event.preventDefault();
    active = active < 0 ? (event.key === "ArrowDown" ? 0 : matches.length - 1) : (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    for (const [index, option] of [...results.children].entries()) option.setAttribute("aria-selected", String(index === active));
    name.setAttribute("aria-activedescendant", `catalog-option-${active}`);
    results.children[active].scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && !results.hidden && active >= 0) {
    event.preventDefault();
    chooseProduct(matches[active]);
  }
});
variant.addEventListener("change", updateVariant);
profile.addEventListener("change", updateProfile);
ratioChoice.addEventListener("change", () => { ratio.value = ratioChoice.value; });
ratio.addEventListener("input", () => { ratioChoice.value = ""; });
pumpChoice.addEventListener("change", () => { pump.value = pumps[pumpChoice.value]?.pump_ml_min ?? ""; });
pump.addEventListener("input", () => { pumpChoice.value = ""; });
$("catalogRetry").addEventListener("click", async () => { await ensureCatalog(); name.focus(); });
form.addEventListener("carwash:preset-open", clearSelection);
form.addEventListener("carwash:preset-close", clearSelection);
