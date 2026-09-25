// Calculated FOB (origin) charges. Pure module, pre-GST INR rate card.
export const FOB_RATES = {
  trucking_per_cbm: 1000,
  common: { vgm_usd: 25, customs_clearance: 3500, passing_releasing: 800, open_repacking: 1500 },
  lcl: { thc_per_cbm: 1000, acd_usd: 35, seal_usd: 10, bl_fee: 3500, measurement_per_carton: 2, measurement_min: 250, sorting_per_carton: 3, sorting_min: 300 },
  fcl: { acd_usd: 40, seal_usd: 15, bl_fee: 5500, thc_20st: 36000, thc_40hc: 46000, capacity_20st: 28, capacity_40hc: 68 },
  gst_rate: 0,
};

export type FobMode = 'LCL' | 'FCL_20ST' | 'FCL_40HC';
export type FobLine = { label: string; amount_inr: number };
export type FobOption = { mode: FobMode; label: string; containers: number; lines: FobLine[]; total_inr: number; per_cbm_inr: number };
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

export const isFobPerUnit = (u: any): u is 'FOB_LCL' | 'FOB_AUTO' => u === 'FOB_LCL' || u === 'FOB_AUTO';

const MODE_LABEL: Record<FobMode, string> = { LCL: 'LCL', FCL_20ST: "20' FCL", FCL_40HC: "40' HC FCL" };

function finish(mode: FobMode, containers: number, lines: FobLine[], cbm: number): FobOption {
  let total = lines.reduce((s, l) => s + l.amount_inr, 0);
  if (FOB_RATES.gst_rate > 0) {
    const gst = total * FOB_RATES.gst_rate;
    lines = [...lines, { label: 'GST', amount_inr: gst }];
    total += gst;
  }
  return { mode, label: MODE_LABEL[mode], containers, lines, total_inr: total, per_cbm_inr: cbm > 0 ? total / cbm : 0 };
}

export function computeLcl(cbm: number, cartons: number, fx: number): FobOption {
  const { lcl, common, trucking_per_cbm } = FOB_RATES;
  return finish('LCL', 0, [
    { label: 'ACD + seal + VGM (USD)', amount_inr: (lcl.acd_usd + lcl.seal_usd + common.vgm_usd) * fx },
    { label: 'BL fee', amount_inr: lcl.bl_fee },
    { label: 'Customs, passing & repacking', amount_inr: common.customs_clearance + common.passing_releasing + common.open_repacking },
    { label: 'THC (per CBM)', amount_inr: lcl.thc_per_cbm * cbm },
    { label: 'Measurement', amount_inr: Math.max(lcl.measurement_per_carton * cartons, lcl.measurement_min) },
    { label: 'Sorting', amount_inr: Math.max(lcl.sorting_per_carton * cartons, lcl.sorting_min) },
    { label: 'Trucking', amount_inr: trucking_per_cbm * cbm },
  ], cbm);
}

export function computeFcl(size: '20ST' | '40HC', cbm: number, fx: number): FobOption {
  const { fcl, common, trucking_per_cbm } = FOB_RATES;
  const cap = size === '20ST' ? fcl.capacity_20st : fcl.capacity_40hc;
  const thc = size === '20ST' ? fcl.thc_20st : fcl.thc_40hc;
  const n = Math.max(1, Math.ceil(cbm / cap));
  return finish(size === '20ST' ? 'FCL_20ST' : 'FCL_40HC', n, [
    { label: `THC ×${n}`, amount_inr: n * thc },
    { label: `ACD + seal + VGM (USD) ×${n}`, amount_inr: n * (fcl.acd_usd + fcl.seal_usd + common.vgm_usd) * fx },
    { label: `BL fee ×${n}`, amount_inr: n * fcl.bl_fee },
    { label: `Customs, passing & repacking ×${n}`, amount_inr: n * (common.customs_clearance + common.passing_releasing + common.open_repacking) },
    { label: 'Trucking', amount_inr: trucking_per_cbm * cbm },
  ], cbm);
}

export function computeFob(perUnit: 'FOB_LCL' | 'FOB_AUTO', cbm: number, cartons: number, fx: number, modeOverride?: FobMode | null): FobEstimate {
  const options = [computeLcl(cbm, cartons, fx), computeFcl('20ST', cbm, fx), computeFcl('40HC', cbm, fx)];
  let selected = options[0];
  if (modeOverride) selected = options.find(o => o.mode === modeOverride) || selected;
  else if (perUnit === 'FOB_AUTO') selected = options.reduce((a, b) => (b.total_inr < a.total_inr ? b : a));
  return { cbm, cartons, selected, options };
}
