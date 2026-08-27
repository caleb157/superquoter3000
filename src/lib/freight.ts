// Rough freight estimate helpers shared by quote creation + edit flows.
//
// Sea:  amount = totalCbm * ratePerCbm
//
// Air:  carriers charge per SHIPPING CARTON, not per piece.
//         boxes            = ceil(order qty / units per carton)
//         dim kg per box   = (Wcm * Dcm * Hcm) / divisor        (divisor 5000 default)
//         actual kg per box= per-unit weight * units in that box
//         chargeable       = SUM over boxes of max(dim kg, actual kg)
//         amount           = chargeable kg * rate per kg
//       1 inch = 2.54 cm.
//       Legacy fallback (no carton data on the line): dim weight is derived from
//       the per-piece dimensions, which understates real air freight.

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
  total_boxes: number;
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
  // Shipping carton (master carton preferred, else inner carton).
  carton_width_inch?: number | null;
  carton_depth_inch?: number | null;
  carton_height_inch?: number | null;
  units_per_carton?: number | null;
  // For assembly lines: per-unit dim kg already aggregated from components.
  dim_kg_per_unit_override?: number | null;
}

export function computeFreight(lines: FreightLine[], input: FreightInput): FreightSnapshot {
  const divisor = input.dim_divisor || 5000;
  let totalCbm = 0;
  let totalActual = 0;
  let totalDim = 0;
  let totalChargeable = 0;
  let totalBoxes = 0;

  for (const l of lines) {
    const qty = Number(l.quantity || 0);
    if (qty <= 0) continue;
    totalCbm += Number(l.unit_cbm || 0) * qty;
    const unitWeight = Number(l.weight_kg || 0);
    totalActual += unitWeight * qty;

    const perCarton = Number(l.units_per_carton || 0);
    const cartonDim = dimKgPerUnit(l.carton_width_inch, l.carton_depth_inch, l.carton_height_inch, divisor);

    if (perCarton > 0 && cartonDim > 0) {
      // Carton-based (correct) air math.
      const fullBoxes = Math.floor(qty / perCarton);
      const remainder = qty - fullBoxes * perCarton;
      const boxes = fullBoxes + (remainder > 0 ? 1 : 0);
      totalBoxes += boxes;
      totalDim += cartonDim * boxes;
      totalChargeable += fullBoxes * Math.max(cartonDim, unitWeight * perCarton);
      if (remainder > 0) totalChargeable += Math.max(cartonDim, unitWeight * remainder);
      continue;
    }

    // Legacy / no carton data: per-piece dim weight.
    const dimUnit = l.dim_kg_per_unit_override != null
      ? Number(l.dim_kg_per_unit_override || 0)
      : dimKgPerUnit(l.width_inch, l.depth_inch, l.height_inch, divisor);
    totalDim += dimUnit * qty;
    totalChargeable += Math.max(unitWeight, dimUnit) * qty;
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
    total_boxes: totalBoxes,
  };
}

