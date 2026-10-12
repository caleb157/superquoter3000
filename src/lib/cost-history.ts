// Cost history (product_cost_history): a dated row each time a product's costing changes,
// with the main cost parts and a plain-words reason. Written from the shared save paths
// (persistResolvedCosting, cache heals, the product costing tab) only when something moved,
// and read by the product Cost history tab and the "cost up since last quote" warning.
// Logging never blocks a save: if the table is missing or a write fails, it is skipped.
import { supabase } from '@/integrations/supabase/client';
import type { CostingEngineResult } from '@/lib/costing-engine';
import { isHardwareCogsType } from '@/lib/cogs-categories';
import { calcCogsItemCost } from '@/lib/calculations';

/** INR per unit, split the way the history view shows it. */
export type CostParts = {
  raw_piece: number;
  hardware: number;
  materials: number; // other COGS + non-unit COGS
  labor: number;     // direct labor (department rates × man-hours)
  overhead: number;  // indirect overhead per man-hour
  shipping: number;
  capital: number;
};

export type CostPoint = {
  unit_cost_usd: number;
  unit_price_usd: number;
  unit_cost_inr: number;
  exchange_rate: number;
  markup_percent: number;
  man_hours: number;
  parts: CostParts;
  raw_vendor: string | null;
};

export type CostHistoryRow = CostPoint & { id: string; product_id: string; recorded_at: string; reason: string | null };

export const PART_LABELS: Record<keyof CostParts, string> = {
  raw_piece: 'Raw piece',
  hardware: 'Hardware',
  materials: 'Materials',
  labor: 'Labor',
  overhead: 'Overhead',
  shipping: 'Shipping',
  capital: 'Capital',
};

const fin = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** The history point for one engine result (same numbers the costing sheet shows). */
export function costPointFromResult(result: CostingEngineResult): CostPoint {
  const s = result.summary;
  let raw = 0, hardware = 0;
  let vendor: string | null = null;
  for (const row of result.resolvedCogsRows || []) {
    if (row.include === 'No') continue;
    const c = calcCogsItemCost({
      include: row.include,
      components_per_product: row.components_per_product || 0,
      unit_cost_inr: row.unit_cost_inr || 0,
      waste_factor: row.waste_factor || 0,
    }).unit_cost;
    if (row.cogs_type === 'Raw Piece') {
      raw += c;
      if (!vendor && row.include === 'Yes' && (row.vendor_name || '').trim()) vendor = row.vendor_name.trim();
    } else if (isHardwareCogsType(row.cogs_type)) hardware += c;
  }
  const cogsTotal = fin(result.cogsPerUnit) + fin(result.nonUnitCogsPerUnit);
  return {
    unit_cost_usd: r4(fin(s.product_cost_per_unit_usd)),
    unit_price_usd: r4(fin(s.unit_price_usd)),
    unit_cost_inr: r4(fin(s.product_cost_per_unit_inr)),
    exchange_rate: r4(fin(result.exchangeRate)),
    markup_percent: r4(fin(result.markupPercent)),
    man_hours: r4(fin(result.manHoursPerUnit)),
    parts: {
      raw_piece: r4(raw),
      hardware: r4(hardware),
      materials: r4(Math.max(0, cogsTotal - raw - hardware)),
      labor: r4(fin(result.directOhPerUnit)),
      overhead: r4(fin(result.indirectOhPerUnit)),
      shipping: r4(fin(result.shippingPerUnit)),
      capital: r4(fin(s.total_capital_per_unit)),
    },
    raw_vendor: vendor,
  };
}

/** True when the new point differs enough from the last logged one to be worth a row. */
export function costChanged(prev: CostPoint | null, next: CostPoint): boolean {
  if (!prev) return true;
  if (Math.abs(fin(prev.unit_cost_usd) - next.unit_cost_usd) >= 0.005) return true;
  if (Math.abs(fin(prev.unit_price_usd) - next.unit_price_usd) >= 0.005) return true;
  if (Math.abs(fin(prev.exchange_rate) - next.exchange_rate) >= 0.001) return true;
  for (const k of Object.keys(PART_LABELS) as (keyof CostParts)[]) {
    if (Math.abs(fin(prev.parts?.[k]) - next.parts[k]) >= 0.5) return true;
  }
  return false;
}

const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
const signedInr = (n: number) => `${n >= 0 ? '+' : '−'}${inr(n)}`;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Plain-words summary of what moved between two points, biggest change first. */
export function describeCostChange(prev: CostPoint | null, next: CostPoint): string {
  if (!prev) return 'First record';
  const bits: { size: number; text: string }[] = [];
  const fxMoved = Math.abs(fin(prev.exchange_rate) - next.exchange_rate) >= 0.001;
  for (const k of Object.keys(PART_LABELS) as (keyof CostParts)[]) {
    const d = next.parts[k] - fin(prev.parts?.[k]);
    if (Math.abs(d) < 0.5) continue;
    let text = `${PART_LABELS[k]} ${signedInr(d)}`;
    if (k === 'raw_piece' && next.raw_vendor && next.raw_vendor !== prev.raw_vendor) text += ` (vendor ${next.raw_vendor})`;
    if (k === 'labor' || k === 'overhead') {
      const mhMoved = Math.abs(fin(prev.man_hours) - next.man_hours) >= 0.001;
      text += mhMoved ? ` (man-hours ${fin(prev.man_hours).toFixed(2)} → ${next.man_hours.toFixed(2)})` : ' (rate change)';
    }
    bits.push({ size: Math.abs(d), text });
  }
  bits.sort((a, b) => b.size - a.size);
  const out = bits.map(b => b.text);
  if (fxMoved) out.push(`Exchange rate ${fin(prev.exchange_rate).toFixed(2)} → ${next.exchange_rate.toFixed(2)}`);
  if (Math.abs(fin(prev.markup_percent) - next.markup_percent) >= 0.0001) {
    out.push(`Markup ${(fin(prev.markup_percent) * 100).toFixed(1)}% → ${(next.markup_percent * 100).toFixed(1)}%`);
  }
  if (Math.abs(fin(prev.unit_price_usd) - next.unit_price_usd) >= 0.005) {
    out.push(`FOB ${usd(fin(prev.unit_price_usd))} → ${usd(next.unit_price_usd)}`);
  }
  return out.join(' · ') || 'Minor change';
}

// Last point written per product in this browser session, so repeated saves skip the read.
const lastWritten = new Map<string, CostPoint>();
let tableMissing = false;

/**
 * Logs a cost history row for the product if its costing moved since the last row.
 * `cause` (e.g. "Live exchange rate") is put in front of the computed reason.
 * Never throws.
 */
export async function recordCostPoint(productId: string, point: CostPoint, cause?: string): Promise<void> {
  if (tableMissing || !productId) return;
  if (!(point.unit_cost_usd > 0) && !(point.unit_price_usd > 0)) return;
  try {
    let prev = lastWritten.get(productId) ?? null;
    if (!prev) {
      const { data, error } = await (supabase as any).from('product_cost_history')
        .select('unit_cost_usd, unit_price_usd, unit_cost_inr, exchange_rate, markup_percent, man_hours, parts, raw_vendor')
        .eq('product_id', productId).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
      if (error) { if (/does not exist|schema cache/i.test(error.message || '')) tableMissing = true; return; }
      prev = data ? normalizePoint(data) : null;
    }
    if (!costChanged(prev, point)) { lastWritten.set(productId, prev ?? point); return; }
    lastWritten.set(productId, point);
    const reason = describeCostChange(prev, point);
    const { error } = await (supabase as any).from('product_cost_history').insert({
      product_id: productId, ...point, reason: cause ? `${cause}: ${reason}` : reason,
    });
    if (error) lastWritten.delete(productId);
  } catch {
    lastWritten.delete(productId);
  }
}

/** Logs from an engine result. Fire-and-forget friendly. */
export function recordCostChange(productId: string, result: CostingEngineResult, cause?: string): Promise<void> {
  return recordCostPoint(productId, costPointFromResult(result), cause);
}

function normalizePoint(r: any): CostPoint {
  const parts = (r.parts ?? {}) as Partial<CostParts>;
  return {
    unit_cost_usd: fin(r.unit_cost_usd),
    unit_price_usd: fin(r.unit_price_usd),
    unit_cost_inr: fin(r.unit_cost_inr),
    exchange_rate: fin(r.exchange_rate),
    markup_percent: fin(r.markup_percent),
    man_hours: fin(r.man_hours),
    parts: {
      raw_piece: fin(parts.raw_piece), hardware: fin(parts.hardware), materials: fin(parts.materials),
      labor: fin(parts.labor), overhead: fin(parts.overhead), shipping: fin(parts.shipping), capital: fin(parts.capital),
    },
    raw_vendor: r.raw_vendor ?? null,
  };
}

/** A product's history, oldest first. */
export async function loadCostHistory(productId: string): Promise<CostHistoryRow[]> {
  const { data, error } = await (supabase as any).from('product_cost_history')
    .select('*').eq('product_id', productId).order('recorded_at', { ascending: true }).limit(1000);
  if (error) return [];
  return ((data ?? []) as any[]).map(r => ({ ...normalizePoint(r), id: r.id, product_id: r.product_id, recorded_at: r.recorded_at, reason: r.reason ?? null }));
}

// ----- Re-quote warning -----

export type CostRiseWarning = {
  /** Index of the line in the quote's products array. */
  index: number;
  name: string;
  pct: number;              // 0.12 = cost up 12%
  costThenUsd: number;
  costNowUsd: number;
  quotedPrice: number;
  currency: string;
  sentAt: string;
  quoteNumber: string | null;
  reasons: string[];        // history reasons logged since that quote
};

/** Minimum rise worth flagging. */
export const COST_RISE_THRESHOLD = 0.01;

type PrevLine = { product_id: string | null; price: number; currency: string; sent_at: string; quote_number: string | null };
const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const ts = (s: string) => Date.parse(s) || 0;

/**
 * Pure part of the warning: given the quote's lines, the previous sent lines (newest first),
 * each product's history and current cost, returns the lines whose cost rose since last quoted.
 * Cost "then" = the last history row at or before that quote was sent (for the product that
 * was quoted, which differs from the current one on repeat orders).
 */
export function costRiseWarnings(
  lines: Array<{ product_id?: string | null; sku?: string | null; name: string }>,
  prevSent: Array<{ quote: { currency: string; sent_at: string; quote_number: string | null }; lines: any[] }>,
  history: Record<string, Array<{ recorded_at: string; unit_cost_usd: number; reason: string | null }>>,
  costNow: Record<string, number>,
): CostRiseWarning[] {
  const byProduct = new Map<string, PrevLine>(), bySku = new Map<string, PrevLine>(), byName = new Map<string, PrevLine>();
  for (const q of prevSent) {
    for (const l of q.lines ?? []) {
      const hit: PrevLine = { product_id: l.product_id ?? null, price: Number(l.unit_price_usd || 0), currency: q.quote.currency || 'USD', sent_at: q.quote.sent_at, quote_number: q.quote.quote_number };
      if (!(hit.price > 0)) continue;
      if (l.product_id && !byProduct.has(l.product_id)) byProduct.set(l.product_id, hit);
      if (l.sku && !bySku.has(key(l.sku))) bySku.set(key(l.sku), hit);
      if (l.name && !byName.has(key(l.name))) byName.set(key(l.name), hit);
    }
  }
  const out: CostRiseWarning[] = [];
  lines.forEach((line, index) => {
    if (!line.product_id) return;
    const prev = byProduct.get(line.product_id) ?? (line.sku ? bySku.get(key(line.sku)) : undefined) ?? byName.get(key(line.name));
    if (!prev) return;
    const thenRows = (history[prev.product_id ?? line.product_id] ?? []).filter(r => ts(r.recorded_at) <= ts(prev.sent_at));
    const then = thenRows[thenRows.length - 1];
    const now = costNow[line.product_id] ?? 0;
    if (!then || !(then.unit_cost_usd > 0) || !(now > 0)) return;
    const pct = now / then.unit_cost_usd - 1;
    if (pct < COST_RISE_THRESHOLD) return;
    const reasons = (history[line.product_id] ?? [])
      .filter(r => ts(r.recorded_at) > ts(prev.sent_at) && r.reason)
      .map(r => r.reason as string);
    out.push({
      index, name: line.name, pct, costThenUsd: then.unit_cost_usd, costNowUsd: now,
      quotedPrice: prev.price, currency: prev.currency, sentAt: prev.sent_at, quoteNumber: prev.quote_number, reasons,
    });
  });
  return out;
}

/** Lines of this quote whose cost has gone up since they were last quoted to the same customer. */
export async function loadCostRiseWarnings(snapshot: any): Promise<CostRiseWarning[]> {
  if (!snapshot?.id || tableMissing) return [];
  const lines = ((snapshot.products ?? []) as any[]);
  const ids = Array.from(new Set(lines.map(l => l.product_id).filter(Boolean))) as string[];
  if (ids.length === 0) return [];
  let customerId: string | null = snapshot.customer?.id ?? null;
  if (!customerId && snapshot.customer_rfq_id) {
    const { data } = await (supabase as any).from('customer_rfqs').select('customer_id').eq('id', snapshot.customer_rfq_id).maybeSingle();
    customerId = data?.customer_id ?? null;
  }
  if (!customerId) return [];
  const { data: inqs } = await (supabase as any).from('customer_rfqs').select('id').eq('customer_id', customerId);
  const inqIds = ((inqs ?? []) as any[]).map(r => r.id);
  if (inqIds.length === 0) return [];
  const { data: quotes } = await (supabase as any).from('quote_snapshots')
    .select('id, quote_number, currency, sent_at, products')
    .in('customer_rfq_id', inqIds).not('sent_at', 'is', null).neq('id', snapshot.id)
    .order('sent_at', { ascending: false }).limit(100);
  const prevSent = ((quotes ?? []) as any[]).map(q => ({ quote: q, lines: (q.products ?? []) as any[] }));
  if (prevSent.length === 0) return [];

  const prevIds = new Set<string>(ids);
  for (const q of prevSent) for (const l of q.lines) if (l.product_id) prevIds.add(l.product_id);
  const [histRes, prodRes] = await Promise.all([
    (supabase as any).from('product_cost_history').select('product_id, recorded_at, unit_cost_usd, reason')
      .in('product_id', Array.from(prevIds)).order('recorded_at', { ascending: true }).limit(10000),
    supabase.from('products').select('id, calculated_unit_cost_usd').in('id', ids),
  ]);
  if (histRes.error) return [];
  const history: Record<string, any[]> = {};
  for (const r of (histRes.data ?? []) as any[]) (history[r.product_id] ??= []).push({ ...r, unit_cost_usd: fin(r.unit_cost_usd) });
  const costNow: Record<string, number> = {};
  for (const p of (prodRes.data ?? []) as any[]) costNow[p.id] = fin(p.calculated_unit_cost_usd);
  return costRiseWarnings(lines, prevSent, history, costNow);
}
