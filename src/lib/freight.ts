// Rough freight estimate helpers shared by quote creation + edit flows.
// "Sea" mode: amount = totalCbm * ratePerCbm
// "Air" mode: chargeable kg = max(actual kg, dim kg).
//   dim kg per unit = (W_cm * D_cm * H_cm) / divisor   (typical divisor = 5000)
//   1 inch = 2.54 cm

export type FreightMode = 'sea' | 'air';

export interface FreightInput {
  mode: FreightMode;
  rate: number;          // per CBM (sea) or per kg (air), in display currency
  dim_divisor?: number;  // air only; default 5000
}

export interface FreightSnapshot extends FreightInput {
  amount: number;
  total_cbm: number;
  total_actual_kg: number;
  total_dim_kg: number;
  total_chargeable_kg: number;
}

const IN_TO_CM = 2.54;

export function dimKgPerUnit(
  w_inch?: number | null,
  d_inch?: number | null,
  h_inch?: number | null,
  divisor = 5000,
): number {
  const w = Number(w_inch || 0) * IN_TO_CM;
  const d = Number(d_inch || 0) * IN_TO_CM;
  const h = Number(h_inch || 0) * IN_TO_CM;
  if (!w || !d || !h) return 0;
  return (w * d * h) / (divisor || 5000);
}

export interface FreightLine {
  quantity: number;
  unit_cbm?: number | null;
  weight_kg?: number | null;       // per unit
  width_inch?: number | null;
  depth_inch?: number | null;
  height_inch?: number | null;
  // For assembly lines: per-unit dim kg already aggregated from components.
  dim_kg_per_unit_override?: number | null;
}

export function computeFreight(lines: FreightLine[], input: FreightInput): FreightSnapshot {
  const divisor = input.dim_divisor || 5000;
  let totalCbm = 0;
  let totalActual = 0;
  let totalDim = 0;
  let totalChargeable = 0;

  for (const l of lines) {
    const qty = Number(l.quantity || 0);
    if (qty <= 0) continue;
    totalCbm += Number(l.unit_cbm || 0) * qty;
    const actualUnit = Number(l.weight_kg || 0);
    const dimUnit = l.dim_kg_per_unit_override != null
      ? Number(l.dim_kg_per_unit_override || 0)
      : dimKgPerUnit(l.width_inch, l.depth_inch, l.height_inch, divisor);
    totalActual += actualUnit * qty;
    totalDim += dimUnit * qty;
    totalChargeable += Math.max(actualUnit, dimUnit) * qty;
  }

  const rate = Number(input.rate || 0);
  const amount = input.mode === 'sea' ? totalCbm * rate : totalChargeable * rate;

  return {
    mode: input.mode,
    rate,
    dim_divisor: divisor,
    amount,
    total_cbm: totalCbm,
    total_actual_kg: totalActual,
    total_dim_kg: totalDim,
    total_chargeable_kg: totalChargeable,
  };
}
