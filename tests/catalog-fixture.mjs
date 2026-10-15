export function catalogFixture() {
  return {
    schema_version: "1.0.0",
    prepared_at: "2026-10-15",
    source_snapshot_date: "2026-10-14",
    scope: { source_url: "https://example.com/products", notes: "확인하지 못한 값은 null" },
    ratio_convention: "원액 1에 대한 물의 부피배수",
    products: [{
      product_id: "test-shampoo",
      name: "테스트 샴푸 '원문'",
      category: "liquid",
      ph_class: "unknown",
      ph_evidence: [{ ph_class: "unknown", raw_claim: null }],
      source_product_ids: [1],
      normalization_note: "모델을 추정하지 않음",
      dilution_profiles: [
        { profile_id: "test-d1", method: "bucket", ratio_basis: "unknown", dilution_min: null, dilution_max: null, calculation_allowed: false, status: "unknown_basis" },
        { profile_id: "test-d2", method: "foam_lance", ratio_basis: "concentrate_to_water", dilution_min: null, dilution_max: 20, calculation_allowed: true, status: "verified_existing_one_sided" },
      ],
      pump_profiles: [{ pump_ml_min: null, pump_ml_max: null, status: "unverified", note: "null은 펌프 미제공을 뜻하지 않음" }],
      variants: [{ variant_id: "test-1", volume_ml: 500, snapshot_price_krw: 10000 }],
    }],
  };
}
