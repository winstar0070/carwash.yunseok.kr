// Water volumes are editable equipment defaults, not manufacturer recommendations.
export const METHODS = {
  bucket: ["버킷 세차", "카샴푸", 15],
  foam_lance: ["폼랜스 용액통", "폼랜스", 1],
  pressure_sprayer: ["압축분무기", "프리워시", 1.5],
  pressure_foam_sprayer: ["압축 폼분무기", "프리워시", 1.5],
  wheel_bucket: ["휠 버킷", "휠/타이어", null],
  wheel_foam_sprayer: ["휠 폼분무기", "휠/타이어", 1],
  wheel_pressure_sprayer: ["휠 압축분무기", "휠/타이어", 1.5],
  prewash: ["프리워시", "프리워시", null],
  waterless: ["워터리스 세차", "기타", null],
  rinseless: ["린스리스 세차", "카샴푸", null],
  shampoo_additive: ["샴푸 첨가", "카샴푸", null],
  direct_spray: ["직접 분사", "기타", null],
  spray_coating: ["분사 코팅", "코팅/드라잉", null],
  iron_removal: ["철분 제거", "휠/타이어", null],
  wheel_cleaner: ["휠 세정", "휠/타이어", null],
  apc_mats_furniture: ["매트·가구 세정", "다목적(APC)", null],
  apc_interior_fabric: ["실내 직물 세정", "다목적(APC)", null],
  apc_interior: ["실내 세정", "다목적(APC)", null],
  apc_engine: ["엔진 세정", "다목적(APC)", null],
  nebula_sprayer: ["네뷸라 분무기", "프리워시", null],
  foam_gun_unspecified: ["폼건 (장비 미확인)", "폼랜스", null],
};

const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko").replace(/[^\p{L}\p{N}]/gu, "");
const applicable = (profile, variantID) => Array.isArray(profile?.applicable_variant_ids) && profile.applicable_variant_ids.includes(variantID);
const positive = value => Number.isFinite(value) && value > 0 && value <= 1000000;

// Build once per catalog snapshot. Public searchProducts remains safe for mutable callers.
export function createProductSearch(products) {
  const rows = products.filter(product => product.category === "liquid").map(product => ({
    product,
    text: normalize([product.name, ...product.variants.map(variant => `${variant.source_name || ""} ${variant.option_name || ""}`)].join(" ")),
  }));
  return (query, limit = 8) => {
    const terms = query.trim().split(/\s+/).map(normalize).filter(Boolean);
    if (!terms.length || limit <= 0) return [];
    const matches = [];
    for (const { product, text } of rows) {
      if (terms.every(term => text.includes(term))) {
        matches.push(product);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  };
}

export function searchProducts(products, query, limit = 8) {
  return createProductSearch(products)(query, limit);
}

export function getProfiles(product, variantID) {
  if (!product.variants.some(variant => variant.variant_id === variantID)) return [];
  return product.dilution_profiles.filter(profile => applicable(profile, variantID));
}

export function getRatioOptions(profile) {
  if (profile?.calculation_allowed !== true || profile.ratio_basis !== "concentrate_to_water" || profile.proportional_scaling_allowed === false) return [];
  const min = profile.dilution_min, max = profile.dilution_max;
  if ((min !== null && !positive(min)) || (max !== null && !positive(max)) || (min !== null && max !== null && min > max)) return [];
  return [...new Set([min, max].filter(positive))];
}

export function getPresetDefaults(product, variantID, profileID) {
  const variant = product.variants.find(variant => variant.variant_id === variantID);
  const profile = getProfiles(product, variantID).find(profile => profile.profile_id === profileID);
  const [method = "사용 방법 미확인", category = "기타", equipmentWater = null] = METHODS[profile?.method] || [];
  const fixedDose = profile?.fixed_dose_calculation_allowed === true && profile.proportional_scaling_allowed === false;
  const sourceWater = profile?.recommended_water_ml ?? profile?.water_ml;
  const catalogWater = (profile?.calculation_allowed === true || fixedDose) && positive(sourceWater);
  const waterL = catalogWater ? sourceWater / 1000 : equipmentWater;
  const waterSource = catalogWater ? "catalog" : equipmentWater === null ? null : "equipment";
  const ratio = getRatioOptions(profile).length === 1 && profile.dilution_min === profile.dilution_max ? profile.dilution_min : null;
  const name = product.name + (variant && product.variants.length > 1 ? ` · ${variant.option_name}` : "");
  return { name: name.slice(0, 80), ratio, waterL, waterSource, fixedDose, waterApproximate: profile?.recommended_water_is_approximate === true || profile?.approximate === true, category, note: profile ? method : "" };
}

export function getPumpOptions(product, variantID) {
  return product.pump_profiles.filter(profile => applicable(profile, variantID)
    && ["verified", "verified_optional_nominal", "verified_included_nominal"].includes(profile.status)
    && positive(profile.pump_ml_min) && profile.pump_ml_min <= 1000 && profile.pump_ml_min === profile.pump_ml_max);
}

function validCatalog(data) {
  return data?.schema_version === "1.0.0" && Array.isArray(data.products) && data.products.length <= 5000
    && data.products.every(product => typeof product?.name === "string" && typeof product.product_id === "string"
      && ["variants", "dilution_profiles", "pump_profiles"].every(key => Array.isArray(product[key]) && product[key].every(row => row && typeof row === "object")));
}

// Keep all selection evidence/profiles when talking to older servers or reading older caches.
function pickerCatalog(data) {
  const { research_log, ...metadata } = data;
  return { ...metadata, products: data.products.map(({ research_log, ...product }) => product) };
}

export async function loadCatalog(base, { fetcher = fetch, storage } = {}) {
  const endpoint = `${base.replace(/\/$/, "")}/products`;
  // Preserve the existing key so installed/offline clients can use their saved catalog.
  const key = `carwash-public-catalog-v1:${endpoint}`;
  let cached;
  try {
    const data = JSON.parse(storage?.getItem(key) || "null");
    if (validCatalog(data)) cached = pickerCatalog(data);
  } catch { /* Storage can be unavailable or contain an incomplete older response. */ }

  const refresh = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const options = { credentials: "omit", signal: controller.signal };
      let response = await fetcher(`${endpoint}?view=picker`, options);
      // Old servers normally ignore this query; tolerate those that reject it explicitly.
      if (!response.ok && [400, 404].includes(response.status)) response = await fetcher(endpoint, options);
      if (!response.ok) throw new Error("제품 목록을 불러올 수 없습니다.");
      const received = await response.json();
      if (!validCatalog(received)) throw new Error("제품 목록 형식을 확인할 수 없습니다.");
      const data = pickerCatalog(received);
      try { storage?.setItem(key, JSON.stringify(data)); } catch { /* Storage may be full or unavailable. */ }
      return { data, cached: false };
    } finally {
      clearTimeout(timeout);
    }
  };
  if (cached) return { data: cached, cached: true, refresh: refresh().catch(() => null) };
  return refresh();
}
