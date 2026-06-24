// Merge global_settings with optional per-inquiry overrides.
// If an override field is null/undefined, the global value is used.

export type InquiryOverrideRow = {
  exchange_rate_override?: number | null;
  markup_percent_override?: number | null;
  shipping_type_id_override?: string | null;
  indirect_overhead_per_mh_override?: number | null;
  packaging_cost_per_cbm_override?: number | null;
  auto_transport_cost_per_cbm_override?: number | null;
  local_transport_cost_per_cbm_override?: number | null;
} | null | undefined;

export function mergeSettingsWithInquiry<T extends Record<string, any>>(
  gs: T | null | undefined,
  inq: InquiryOverrideRow,
): T {
  const base = (gs || {}) as any;
  if (!inq) return base as T;
  const pick = <V>(o: V | null | undefined, fallback: any) => (o === null || o === undefined ? fallback : o);
  return {
    ...base,
    exchange_rate: pick(inq.exchange_rate_override, base.exchange_rate),
    indirect_overhead_per_mh: pick(inq.indirect_overhead_per_mh_override, base.indirect_overhead_per_mh),
    packaging_cost_per_cbm: pick(inq.packaging_cost_per_cbm_override, base.packaging_cost_per_cbm),
    auto_transport_cost_per_cbm: pick(inq.auto_transport_cost_per_cbm_override, base.auto_transport_cost_per_cbm),
    local_transport_cost_per_cbm: pick(inq.local_transport_cost_per_cbm_override, base.local_transport_cost_per_cbm),
  } as T;
}

export const OVERRIDE_FIELDS = [
  'exchange_rate_override',
  'markup_percent_override',
  'shipping_type_id_override',
  'indirect_overhead_per_mh_override',
  'packaging_cost_per_cbm_override',
  'auto_transport_cost_per_cbm_override',
  'local_transport_cost_per_cbm_override',
] as const;
