// Calculated FOB (origin) charges. Pure module; rates are editable in Settings → FOB Rates
// (loaded into this module via setFobRates). Defaults mirror the seeded rate cards.

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
export const getFobRates = () => current;
export function setFobRates(r: { lcl?: Partial<LclRates> | null; fcl?: Partial<FclRates> | null }) {
  current = {
    lcl: { ...DEFAULT_FOB_RATES.lcl, ...(r.lcl || {}) },
    fcl: { ...DEFAULT_FOB_RATES.fcl, ...(r.fcl || {}) },
  };
}

export type FobPerUnit = 'FOB_FCL' | 'FOB_LCL' | 'FOB_LCL_NO_TRUCK';
export type Fumigation = 'none' | 'normal' | 'ispm';
export type Wlc = 'none' | 'leather' | 'bone_mop';
export type FobOpts = { fumigation?: Fumigation | null; wlc?: Wlc | null; rates?: FobRates };
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

const LABEL: Record<FobPerUnit, string> = { FOB_FCL: 'FCL ex-Jodhpur', FOB_LCL: 'LCL incl. truck', FOB_LCL_NO_TRUCK: 'LCL excl. truck' };

function finish(mode: FobPerUnit, containers: number, lines: FobLine[], cbm: number, mix?: string): FobOption {
  const total = lines.reduce((s, l) => s + l.amount_inr, 0);
  return { mode, label: LABEL[mode], containers, mix, lines, total_inr: total, per_cbm_inr: cbm > 0 ? total / cbm : 0 };
}

export function computeLcl(cbm: number, cartons: number, fx: number, trucking = true, opts: FobOpts = {}): FobOption {
  const r = (opts.rates || current).lcl;
  const lines: FobLine[] = [
    { label: 'ACD + seal + VGM (USD)', amount_inr: (r.acd_usd + r.seal_usd + r.vgm_usd) * fx },
    { label: 'BL fee', amount_inr: r.bl_fee },
    { label: 'Customs, passing & repacking', amount_inr: r.customs_clearance + r.passing_releasing + r.open_repacking },
    { label: 'THC (per CBM)', amount_inr: r.thc_per_cbm * cbm },
    { label: 'Measurement', amount_inr: Math.max(r.measurement_per_carton * cartons, r.measurement_min) },
    { label: 'Sorting', amount_inr: Math.max(r.sorting_per_carton * cartons, r.sorting_min) },
  ];
  if (trucking) lines.push({ label: 'Trucking', amount_inr: r.trucking_per_cbm * cbm });
  return finish(trucking ? 'FOB_LCL' : 'FOB_LCL_NO_TRUCK', 0, lines, cbm);
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
  return finish('FOB_FCL', n20 + n40, lines, cbm, mix);
}

/** All three results side by side; `selected` is the one matching perUnit (cheapest if null). */
export function computeFob(perUnit: FobPerUnit | null, cbm: number, cartons: number, fx: number, opts: FobOpts = {}): FobEstimate {
  const options = [computeFcl(cbm, fx, opts), computeLcl(cbm, cartons, fx, true, opts), computeLcl(cbm, cartons, fx, false, opts)];
  const selected = perUnit
    ? options.find(o => o.mode === perUnit)!
    : options.slice(0, 2).reduce((a, b) => (b.total_inr < a.total_inr ? b : a));
  return { cbm, cartons, selected, options };
}
