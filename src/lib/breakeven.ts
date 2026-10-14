// Breakeven Calculator (/tools/breakeven): how much topline covers overhead plus the cash
// buffer at any mix of trading and manufacturing orders. Pure math, no React.
// Live defaults come from data HQ already reads: finished Odoo orders (odoo-profitability,
// the SO Profitability math) for margins and mix, and the Analytics snapshot for monthly
// overhead. Anything the user types overrides the live value; nothing is saved to the DB.
import { analyzeLines, type SoOrder } from '@/lib/so-profitability';
import { orderKind } from '@/lib/order-kind';

export type BreakevenInputs = {
  /** Trading gross margin, % of revenue (price minus bought-in cost). */
  tradeGrossPct: number;
  /** Manufacturing gross margin, % of revenue (price minus materials). Labour is overhead, so it all contributes. */
  mfgGrossPct: number;
  /** Monthly overhead in a high month and a low month (USD). */
  highOhUsd: number;
  lowOhUsd: number;
  /** How many of the 12 months are high months. */
  highMonths: number;
  /** Cash to bank on top of overhead each year (USD). */
  bufferUsd: number;
  /** Manufacturing share of revenue, 0–100. */
  mfgSharePct: number;
};

/** The original model's assumptions, used when no live value is available. */
export const FALLBACK_INPUTS: BreakevenInputs = {
  tradeGrossPct: 10, mfgGrossPct: 40, highOhUsd: 3500, lowOhUsd: 2500,
  highMonths: 6, bufferUsd: 10000, mfgSharePct: 60,
};
const INPUT_KEYS = Object.keys(FALLBACK_INPUTS) as (keyof BreakevenInputs)[];

export const annualOverhead = (i: BreakevenInputs) => {
  const n = Math.min(12, Math.max(0, i.highMonths));
  return n * i.highOhUsd + (12 - n) * i.lowOhUsd;
};
export const target = (i: BreakevenInputs) => annualOverhead(i) + i.bufferUsd;
export const tradeRate = (i: BreakevenInputs) => i.tradeGrossPct / 100;
export const mfgRate = (i: BreakevenInputs) => i.mfgGrossPct / 100;
/** Contribution per dollar of revenue at manufacturing share m (0–1). */
export const blendedRate = (i: BreakevenInputs, m: number) => tradeRate(i) * (1 - m) + mfgRate(i) * m;

/** Annual revenue at which contribution equals overhead + buffer; Infinity when nothing contributes. */
export function requiredRevenue(i: BreakevenInputs, m = i.mfgSharePct / 100): number {
  const r = blendedRate(i, m);
  return r > 0 ? target(i) / r : Infinity;
}

export type BreakevenResult = {
  required: number; perMonth: number; trading: number; manufacturing: number; rate: number;
  annualOverhead: number; target: number;
  /** Where the contribution comes from at the required revenue. */
  tradeContribution: number; mfgContribution: number;
};

export function breakeven(i: BreakevenInputs): BreakevenResult {
  const m = Math.min(1, Math.max(0, i.mfgSharePct / 100));
  const required = requiredRevenue(i, m);
  const ok = Number.isFinite(required);
  const trading = ok ? required * (1 - m) : Infinity;
  const manufacturing = ok ? required * m : Infinity;
  return {
    required, perMonth: required / 12, trading, manufacturing, rate: blendedRate(i, m),
    annualOverhead: annualOverhead(i), target: target(i),
    tradeContribution: ok ? trading * tradeRate(i) : 0,
    mfgContribution: ok ? manufacturing * mfgRate(i) : 0,
  };
}

/** Required revenue across the mix, for the chart. */
export const curve = (i: BreakevenInputs, steps = 20) =>
  Array.from({ length: steps + 1 }, (_, k) => ({ share: (k / steps) * 100, required: requiredRevenue(i, k / steps) }));

// ---------- Live values ----------

export type LiveMargins = {
  tradeGrossPct: number | null; mfgGrossPct: number | null; mfgSharePct: number | null;
  tradeOrders: number; mfgOrders: number; tradeRevenueUsd: number; mfgRevenueUsd: number;
  /** Orders counted by the MO guess because they aren't tagged Trading or Manufacturing in Odoo. */
  guessedOrders: number;
};

/**
 * Gross margins and mix from finished Odoo orders, using the SO Profitability line math (USD):
 * revenue minus materials (MO material cost, or standard cost for bought-in lines). Labour, overhead
 * and everything below gross margin goes to overhead; shipping is charged on top, so it's left out.
 * Trading vs manufacturing comes from the SO's Odoo tag (src/lib/order-kind.ts), else the MO guess.
 */
export function liveMarginsFromOrders(orders: SoOrder[], inrPerUsd: number): LiveMargins {
  const t = { rev: 0, gross: 0, n: 0 };
  const f = { rev: 0, gross: 0, n: 0 };
  let guessedOrders = 0;
  for (const o of orders) {
    const rows = analyzeLines(o, 'USD', inrPerUsd);
    if (!rows.length) continue;
    const rev = rows.reduce((s, r) => s + r.revenue, 0);
    if (!(rev > 0)) continue;
    const gross = rows.reduce((s, r) => s + r.gross, 0);
    const { kind, tagged } = orderKind(o);
    if (!tagged) guessedOrders++;
    const b = kind === 'manufacturing' ? f : t;
    b.rev += rev; b.gross += gross; b.n++;
  }
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
  return {
    tradeGrossPct: pct(t.gross, t.rev), mfgGrossPct: pct(f.gross, f.rev),
    mfgSharePct: pct(f.rev, t.rev + f.rev),
    tradeOrders: t.n, mfgOrders: f.n, tradeRevenueUsd: t.rev, mfgRevenueUsd: f.rev, guessedOrders,
  };
}

export type LiveOverhead = { highOhUsd: number; lowOhUsd: number; highMonths: number; months: number; averageUsd: number };

/**
 * High/low overhead months from the snapshot's monthly overhead history (INR → USD).
 * Months above the average are high months; their count is scaled to a 12-month year,
 * so the annual total stays the history's average × 12.
 */
export function liveOverheadFromHistory(history: Record<string, number> | null | undefined, inrPerUsd: number): LiveOverhead | null {
  if (!history || !(inrPerUsd > 0)) return null;
  const vals = Object.values(history).map(v => Number(v) / inrPerUsd).filter(v => Number.isFinite(v));
  if (!vals.length) return null;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const hi = vals.filter(v => v > avg);
  const lo = vals.filter(v => v <= avg);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : avg);
  const highMonths = Math.round((hi.length / vals.length) * 12);
  const highOhUsd = mean(hi);
  const lowOhUsd = mean(lo);
  return { highOhUsd, lowOhUsd, highMonths, months: vals.length, averageUsd: avg };
}

export type LiveInputs = Partial<Record<keyof BreakevenInputs, number>>;

/** Live values where present, else the original model's assumptions, then the user's overrides. */
export function resolveInputs(live: LiveInputs, overrides: Partial<BreakevenInputs>): BreakevenInputs {
  const out = { ...FALLBACK_INPUTS };
  for (const k of Object.keys(live) as (keyof BreakevenInputs)[]) {
    const v = live[k];
    if (v != null && Number.isFinite(v)) (out as any)[k] = v;
  }
  for (const k of Object.keys(overrides) as (keyof BreakevenInputs)[]) {
    const v = overrides[k];
    if (v != null && Number.isFinite(v)) (out as any)[k] = v;
  }
  return out;
}

// ---------- Local draft (this browser only) ----------

const DRAFT_KEY = 'breakeven-overrides';
export function loadOverrides(): Partial<BreakevenInputs> {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {};
    // Drop keys from older versions of the model (net margins, overhead allocation).
    return Object.fromEntries(INPUT_KEYS.filter(k => raw[k] != null).map(k => [k, raw[k]]));
  } catch { return {}; }
}
export function saveOverrides(o: Partial<BreakevenInputs>) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(o)); } catch { /* ignore */ }
}
