// Calculated FOB (origin) charges. Pure module; rates are editable in Settings → FOB Rates
// (loaded into this module via setFobRates). Defaults mirror the seeded rate cards.
// Settings → Shipping can instead set one flat ₹/CBM for LCL (fobSimpleSettings), and an inquiry
// can add a one-off FOB surcharge in USD, spread over the shipment's CBM like every FOB charge.

export type LclRates = {
  thc_per_cbm: number; acd_usd: number; seal_usd: number; vgm_usd: number; bl_fee: number;
  customs_clearance: number; passing_releasing: number; open_repacking: number;
  measurement_per_carton: number; measurement_min: number; sorting_per_carton: number; sorting_min: number;
  trucking_per_cbm: number;
};
export type FclLine = { label: string; c20: number; c40: number };
export type FclRates = {
  capacity_20: number; capacity_40: number; usd_per_container: number; lines: FclLine[];
  fumigation_normal: { c20: number; c40: number }; fumigation_ispm: { c20: number; c40: number };
  wlc_leather: number; wlc_bone_mop: number;
};
export type FobRates = { lcl: LclRates; fcl: FclRates };

export const DEFAULT_FOB_RATES: FobRates = {
  lcl: {
    thc_per_cbm: 1000, acd_usd: 35, seal_usd: 10, vgm_usd: 25, bl_fee: 3500,
    customs_clearance: 3500, passing_releasing: 800, open_repacking: 1500,
    measurement_per_carton: 2, measurement_min: 250, sorting_per_carton: 3, sorting_min: 300,
    trucking_per_cbm: 1000,
  },
  fcl: {
    capacity_20: 28, capacity_40: 68, usd_per_container: 75.25,
    lines: [
      { label: 'Local transport (factory → ICD)', c20: 3500, c40: 3500 },
      { label: 'Agency / clearing', c20: 3500, c40: 3500 },
      { label: 'Supervision', c20: 1300, c40: 2600 },
      { label: 'VGM', c20: 500, c40: 500 },
      { label: 'EDI', c20: 350, c40: 350 },
      { label: 'IHC Jodhpur → Mundra', c20: 32000, c40: 58775 },
      { label: 'Stuffing labour', c20: 5500, c40: 8500 },
      { label: 'Empty pickup', c20: 4500, c40: 6500 },
      { label: 'THC', c20: 15000, c40: 22000 },
      { label: 'B/L fee', c20: 6000, c40: 6000 },
      { label: 'Handling', c20: 2000, c40: 2000 },
      { label: 'Equipment imbalance', c20: 2800, c40: 2800 },
    ],
    fumigation_normal: { c20: 1000, c40: 2500 },
    fumigation_ispm: { c20: 3500, c40: 9000 },
    wlc_leather: 2500, wlc_bone_mop: 5500,
  },
};

let current: FobRates = DEFAULT_FOB_RATES;
export function setFobRates(r: { lcl?: Partial<LclRates> | null; fcl?: Partial<FclRates> | null }) {
  current = {
    lcl: { ...DEFAULT_FOB_RATES.lcl, ...(r.lcl || {}) },
    fcl: { ...DEFAULT_FOB_RATES.fcl, ...(r.fcl || {}) },
  };
}

export type FobPerUnit = 'FOB_FCL' | 'FOB_LCL' | 'FOB_LCL_NO_TRUCK';
export type Fumigation = 'none' | 'normal' | 'ispm';
export type Wlc = 'none' | 'leather' | 'bone_mop';
export type FobOpts = {
  fumigation?: Fumigation | null; wlc?: Wlc | null; rates?: FobRates;
  /** Simple flat FOB rate, ₹ per CBM (Settings → Shipping). When > 0 the LCL types price CBM × this instead of the LCL card. */
  flatPerCbm?: number | null;
  /** Optional per-shipment FOB surcharge in USD (set per inquiry). Added once to the shipment, spread by CBM. */
  surchargeUsd?: number | null;
};
export type FobLine = { label: string; amount_inr: number };
export type FobOption = { mode: FobPerUnit; label: string; containers: number; mix?: string; lines: FobLine[]; total_inr: number; per_cbm_inr: number };
export type FobEstimate = {
  cbm: number;
  cartons: number;
  selected: FobOption;
  options: FobOption[];
  basis?: 'inquiry' | 'product';
  pool_cbm?: number;
  pool_cartons?: number;
  pool_product_count?: number;
  share?: number;
};

export const FOB_PER_UNITS: FobPerUnit[] = ['FOB_FCL', 'FOB_LCL', 'FOB_LCL_NO_TRUCK'];
export const isFobPerUnit = (u: any): u is FobPerUnit => FOB_PER_UNITS.includes(u);
/** Which FOB rate card a shipping type's Per Unit prices from (null = it uses its own Cost). */
export const fobCardFor = (u: any): 'FCL' | 'LCL' | null => (u === 'FOB_FCL' ? 'FCL' : u === 'FOB_LCL' || u === 'FOB_LCL_NO_TRUCK' ? 'LCL' : null);

const LABEL: Record<FobPerUnit, string> = { FOB_FCL: 'FCL Mundra via Jodhpur ICD', FOB_LCL: 'LCL incl. truck', FOB_LCL_NO_TRUCK: 'LCL excl. truck' };

function finish(mode: FobPerUnit, containers: number, lines: FobLine[], cbm: number, fx: number, opts: FobOpts, mix?: string, label = LABEL[mode]): FobOption {
  const sur = Number(opts.surchargeUsd) || 0;
  if (sur > 0) lines = [...lines, { label: `FOB surcharge (US$${sur.toLocaleString('en-US')})`, amount_inr: sur * fx }];
  const total = lines.reduce((s, l) => s + l.amount_inr, 0);
  return { mode, label, containers, mix, lines, total_inr: total, per_cbm_inr: cbm > 0 ? total / cbm : 0 };
}

/** Defaults for the simple FOB settings (Caleb, 2026-11-16: 90/10 rate from the shipment size mix). */
export const FOB_SIMPLE_DEFAULTS = { flatPerCbm: 3200, surchargeUsd: 150, thresholdCbm: 10 };

/**
 * The simple FOB settings from a global_settings row. A missing column (SQL not run yet) or a blank
 * flat rate means the detailed LCL card; surcharge amount and threshold fall back to the defaults.
 */
export function fobSimpleSettings(gs: any): { flatPerCbm: number | null; surchargeUsd: number; thresholdCbm: number } {
  const flat = Number(gs?.fob_flat_rate_per_cbm);
  const sur = Number(gs?.fob_surcharge_usd);
  const thr = Number(gs?.fob_surcharge_threshold_cbm);
  return {
    flatPerCbm: flat > 0 ? flat : null,
    surchargeUsd: sur > 0 ? sur : FOB_SIMPLE_DEFAULTS.surchargeUsd,
    thresholdCbm: thr > 0 ? thr : FOB_SIMPLE_DEFAULTS.thresholdCbm,
  };
}

/**
 * Whether to suggest the FOB surcharge: the shipment is under the threshold and the inquiry hasn't
 * decided yet (fob_surcharge_usd null). 0 means "no surcharge" was picked, so it stops asking.
 */
export function suggestFobSurcharge(poolCbm: number, inquirySurchargeUsd: number | null | undefined, thresholdCbm: number): boolean {
  return inquirySurchargeUsd == null && poolCbm > 0 && poolCbm < thresholdCbm;
}

export function computeLcl(cbm: number, cartons: number, fx: number, trucking = true, opts: FobOpts = {}): FobOption {
  const r = (opts.rates || current).lcl;
  const flat = Number(opts.flatPerCbm) || 0;
  if (flat > 0) {
    // Simple rate: one ₹/CBM figure covering every LCL origin charge incl. trucking; the
    // no-trucking type takes the card's trucking ₹/CBM off it.
    const rate = trucking ? flat : Math.max(0, flat - r.trucking_per_cbm);
    const label = `LCL flat ₹${rate.toLocaleString('en-IN')}/CBM${trucking ? '' : ' excl. truck'}`;
    return finish(trucking ? 'FOB_LCL' : 'FOB_LCL_NO_TRUCK', 0, [{ label: `Flat FOB rate (₹${rate.toLocaleString('en-IN')} × CBM)`, amount_inr: rate * cbm }], cbm, fx, opts, undefined, label);
  }
  const lines: FobLine[] = [
    { label: 'ACD + seal + VGM (USD)', amount_inr: (r.acd_usd + r.seal_usd + r.vgm_usd) * fx },
    { label: 'BL fee', amount_inr: r.bl_fee },
    { label: 'Customs, passing & repacking', amount_inr: r.customs_clearance + r.passing_releasing + r.open_repacking },
    { label: 'THC (per CBM)', amount_inr: r.thc_per_cbm * cbm },
    { label: 'Measurement', amount_inr: Math.max(r.measurement_per_carton * cartons, r.measurement_min) },
    { label: 'Sorting', amount_inr: Math.max(r.sorting_per_carton * cartons, r.sorting_min) },
  ];
  if (trucking) lines.push({ label: 'Trucking', amount_inr: r.trucking_per_cbm * cbm });
  return finish(trucking ? 'FOB_LCL' : 'FOB_LCL_NO_TRUCK', 0, lines, cbm, fx, opts);
}

export function fclContainerCost(size: 20 | 40, fx: number, opts: FobOpts = {}): number {
  const r = (opts.rates || current).fcl;
  const k = size === 20 ? 'c20' : 'c40';
  const fum = opts.fumigation === 'normal' ? r.fumigation_normal[k] : opts.fumigation === 'ispm' ? r.fumigation_ispm[k] : 0;
  return r.lines.reduce((s, l) => s + (Number(l[k]) || 0), 0) + r.usd_per_container * fx + fum;
}

export function computeFcl(cbm: number, fx: number, opts: FobOpts = {}): FobOption {
  const r = (opts.rates || current).fcl;
  const c20 = fclContainerCost(20, fx, opts), c40 = fclContainerCost(40, fx, opts);
  let best = { n20: 1, n40: 0, cost: Infinity };
  const max40 = Math.max(1, Math.ceil(cbm / r.capacity_40)), max20 = Math.max(1, Math.ceil(cbm / r.capacity_20));
  for (let n40 = 0; n40 <= max40; n40++) for (let n20 = 0; n20 <= max20; n20++) {
    if (n40 + n20 < 1 || n40 * r.capacity_40 + n20 * r.capacity_20 < cbm) continue;
    const cost = n40 * c40 + n20 * c20;
    if (cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && n40 + n20 < best.n40 + best.n20)) best = { n20, n40, cost };
  }
  const { n20, n40 } = best;
  const lines: FobLine[] = r.lines.map(l => ({ label: l.label, amount_inr: n20 * (Number(l.c20) || 0) + n40 * (Number(l.c40) || 0) }));
  lines.push({ label: `USD items ($${r.usd_per_container}/container)`, amount_inr: (n20 + n40) * r.usd_per_container * fx });
  if (opts.fumigation === 'normal' || opts.fumigation === 'ispm') {
    const f = opts.fumigation === 'ispm' ? r.fumigation_ispm : r.fumigation_normal;
    lines.push({ label: opts.fumigation === 'ispm' ? 'Fumigation (ISPM)' : 'Fumigation', amount_inr: n20 * f.c20 + n40 * f.c40 });
  }
  if (opts.wlc === 'leather') lines.push({ label: 'Wildlife certificate (leather)', amount_inr: r.wlc_leather });
  if (opts.wlc === 'bone_mop') lines.push({ label: 'Wildlife certificate (bone / MOP)', amount_inr: r.wlc_bone_mop });
  const mix = [n40 ? `${n40} × 40ft` : '', n20 ? `${n20} × 20ft` : ''].filter(Boolean).join(' + ');
  return finish('FOB_FCL', n20 + n40, lines, cbm, fx, opts, mix);
}

/** All three results side by side; `selected` is the one matching perUnit (cheapest if null). */
export function computeFob(perUnit: FobPerUnit | null, cbm: number, cartons: number, fx: number, opts: FobOpts = {}): FobEstimate {
  const options = [computeFcl(cbm, fx, opts), computeLcl(cbm, cartons, fx, true, opts), computeLcl(cbm, cartons, fx, false, opts)];
  const selected = perUnit
    ? options.find(o => o.mode === perUnit)!
    : options.slice(0, 2).reduce((a, b) => (b.total_inr < a.total_inr ? b : a));
  return { cbm, cartons, selected, options };
}
