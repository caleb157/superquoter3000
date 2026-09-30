// Freight Quote Tracker — deterministic calculation engine. Self-contained: does not
// touch any costing / shipping-estimator logic. The LLM never does arithmetic; all math lives here.

export const BUCKETS = ['FOB_ORIGIN', 'OCEAN_FREIGHT', 'DEST_PORT', 'DOOR_DELIVERY', 'CUSTOMS_IMPORT', 'DUTIES_TAXES', 'OTHER'] as const;
export type Bucket = typeof BUCKETS[number];
export const BUCKET_LABEL: Record<Bucket, string> = {
  FOB_ORIGIN: 'FOB / origin', OCEAN_FREIGHT: 'Ocean freight', DEST_PORT: 'Destination port',
  DOOR_DELIVERY: 'Door delivery', CUSTOMS_IMPORT: 'Customs / import', DUTIES_TAXES: 'Duties & taxes', OTHER: 'Other',
};

export const BASES = ['flat', 'per_cbm', 'per_wm', 'per_bl', 'per_shipment', 'per_pallet', 'per_container', 'percent_of_value', 'at_actuals', 'per_kg', 'other'] as const;
export type ChargeBasis = typeof BASES[number];

export type FxSnapshot = Record<string, number>; // currency -> USD per 1 unit

export interface FqQuoteInput {
  cbm?: number | null;
  gross_weight_kg?: number | null;
  pallet_count?: number | null;
  wm_kg_per_cbm?: number | null;
  declared_invoice_value_usd?: number | null;
  duty_estimate_usd?: number | null;
  insurance_usd?: number | null;
  fx_snapshot: FxSnapshot;
}

export interface FqLineInput {
  bucket: Bucket | string;
  charge_basis: ChargeBasis | string;
  rate?: number | null;
  currency: string;
  minimum_amount?: number | null;
  quantity_override?: number | null;
  applicable?: boolean | null;
  is_optional?: boolean | null;
  optional_included?: boolean | null;
  user_estimate?: number | null;
}

export type LineStatus = 'included' | 'not_applicable' | 'optional_off' | 'unpriced';
export interface LineResult { amount_original: number | null; amount_usd: number | null; status: LineStatus; quantity: number }

const n = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

export function chargeableWm(cbm?: number | null, kg?: number | null, ratio?: number | null): number {
  const r = n(ratio) || 1000;
  return Math.max(n(cbm), n(kg) / r);
}

export function fxToUsd(amount: number, currency: string, fx: FxSnapshot): number {
  const c = (currency || 'USD').toUpperCase();
  const rate = c === 'USD' ? 1 : fx[c];
  return rate == null ? NaN : amount * rate;
}

export function lineQuantity(line: FqLineInput, q: FqQuoteInput): number {
  if (line.quantity_override != null && line.quantity_override !== ('' as any)) return n(line.quantity_override);
  switch (line.charge_basis) {
    case 'per_cbm': return n(q.cbm);
    case 'per_wm': return chargeableWm(q.cbm, q.gross_weight_kg, q.wm_kg_per_cbm);
    case 'per_pallet': return n(q.pallet_count);
    case 'per_kg': return n(q.gross_weight_kg);
    case 'percent_of_value': return n(q.declared_invoice_value_usd) / 100; // rate is a percent
    default: return 1;
  }
}

export function computeLine(line: FqLineInput, q: FqQuoteInput): LineResult {
  const quantity = lineQuantity(line, q);
  let amount: number | null;
  if (line.charge_basis === 'at_actuals') {
    amount = line.user_estimate != null && (line.user_estimate as any) !== '' ? n(line.user_estimate) : null;
  } else {
    amount = n(line.rate) * quantity;
    if (line.minimum_amount != null && (line.minimum_amount as any) !== '') amount = Math.max(amount, n(line.minimum_amount));
  }
  // percent_of_value is expressed against declared USD value
  const cur = line.charge_basis === 'percent_of_value' && line.quantity_override == null ? 'USD' : line.currency;
  const usd = amount == null ? null : fxToUsd(amount, cur, q.fx_snapshot);
  let status: LineStatus = 'included';
  if (line.applicable === false) status = 'not_applicable';
  else if (line.is_optional && line.optional_included === false) status = 'optional_off';
  else if (amount == null) status = 'unpriced';
  return { amount_original: amount, amount_usd: usd == null || isNaN(usd) ? null : usd, status, quantity };
}

export interface QuoteTotals {
  chargeable_wm: number;
  buckets: Record<Bucket, number>;
  fob_usd: number; fob_inr: number | null;
  ocean_usd: number;
  cif_usd: number;
  ddp_usd: number;
  everything_else_usd: number;
  per_cbm: { fob: number | null; cif: number | null; ddp: number | null };
  per_wm: { fob: number | null; cif: number | null; ddp: number | null };
  duty_missing: boolean;
  unpriced_count: number;
  missing_fx: string[];
  lines: LineResult[];
}

export function computeQuote(q: FqQuoteInput, lines: FqLineInput[]): QuoteTotals {
  const buckets = Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<Bucket, number>;
  const results = lines.map(l => computeLine(l, q));
  let fobInr = 0, hasInr = false, unpriced = 0;
  const missing = new Set<string>();
  lines.forEach((l, i) => {
    const r = results[i];
    if (r.status === 'unpriced') unpriced++;
    if (r.status !== 'included') return;
    if (r.amount_usd == null) { missing.add(l.currency); return; }
    const b = (BUCKETS as readonly string[]).includes(l.bucket) ? (l.bucket as Bucket) : 'OTHER';
    buckets[b] += r.amount_usd;
    if (b === 'FOB_ORIGIN') {
      if ((l.currency || '').toUpperCase() === 'INR') { hasInr = true; fobInr += r.amount_original || 0; }
      else { const inr = q.fx_snapshot.INR; if (inr) fobInr += r.amount_usd / inr; }
    }
  });
  const fob = buckets.FOB_ORIGIN;
  const cif = fob + buckets.OCEAN_FREIGHT + n(q.insurance_usd);
  const all = BUCKETS.reduce((s, b) => s + buckets[b], 0);
  const ddp = all + n(q.insurance_usd) + n(q.duty_estimate_usd);
  const cbm = n(q.cbm), wm = chargeableWm(q.cbm, q.gross_weight_kg, q.wm_kg_per_cbm);
  const per = (d: number) => (v: number) => (d > 0 ? v / d : null);
  const pc = per(cbm), pw = per(wm);
  return {
    chargeable_wm: wm, buckets,
    fob_usd: fob, fob_inr: hasInr ? fobInr : null,
    ocean_usd: buckets.OCEAN_FREIGHT, cif_usd: cif, ddp_usd: ddp,
    everything_else_usd: ddp - fob,
    per_cbm: { fob: pc(fob), cif: pc(cif), ddp: pc(ddp) },
    per_wm: { fob: pw(fob), cif: pw(cif), ddp: pw(ddp) },
    duty_missing: q.duty_estimate_usd == null || (q.duty_estimate_usd as any) === '',
    unpriced_count: unpriced, missing_fx: [...missing], lines: results,
  };
}

/** Latest rate per currency with effective_date <= onDate. */
export function fxSnapshotFor(rates: { currency: string; rate_to_usd: number; effective_date: string }[], onDate?: string | null): FxSnapshot {
  const d = onDate || new Date().toISOString().slice(0, 10);
  const snap: FxSnapshot = { USD: 1 };
  const best: Record<string, string> = {};
  const sorted = [...rates].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  for (const r of sorted) {
    const c = r.currency.toUpperCase();
    if (r.effective_date <= d || !(c in snap)) { if (!best[c] || r.effective_date <= d) { snap[c] = Number(r.rate_to_usd); best[c] = r.effective_date; } }
  }
  return snap;
}

export interface AvgPoint { date: string; fob: number | null; cif: number | null; ddp: number | null; cbm: number; fobUsd: number; cifUsd: number; ddpUsd: number }

/** Cumulative running averages ('simple' of per-CBM values or 'weighted' = ΣUSD/ΣCBM), or rolling 90-day. */
export function runningAverages(points: AvgPoint[], method: 'simple' | 'weighted', rolling90 = false) {
  const sorted = [...points].filter(p => p.cbm > 0).sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p, i) => {
    const cutoff = new Date(new Date(p.date).getTime() - 90 * 864e5).toISOString().slice(0, 10);
    const win = sorted.slice(0, i + 1).filter(x => !rolling90 || x.date > cutoff);
    const avg = (k: 'fob' | 'cif' | 'ddp') => {
      if (method === 'weighted') {
        const key = (k + 'Usd') as 'fobUsd';
        const cbm = win.reduce((s, x) => s + x.cbm, 0);
        return cbm > 0 ? win.reduce((s, x) => s + x[key], 0) / cbm : null;
      }
      const vals = win.map(x => x[k]).filter((v): v is number => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    return { date: p.date, t: new Date(p.date).getTime(), avgFob: avg('fob'), avgCif: avg('cif'), avgDdp: avg('ddp'), fob: p.fob, cif: p.cif, ddp: p.ddp };
  });
}
