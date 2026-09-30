// Freight Quote Tracker data access — only fq_* tables.
import { supabase } from '@/integrations/supabase/client';
import { computeQuote, chargeableWm, type FxSnapshot } from './calculations';

const db = supabase as any;

export interface FqRef { id: string; name: string; type?: string; category?: string; notes?: string | null }
export interface FqLine {
  id?: string; sort_order: number; raw_label: string; normalized_name: string; bucket: string; charge_basis: string;
  rate: number | null; currency: string; minimum_amount: number | null; quantity_override: number | null;
  applicable: boolean; applicable_reason: string | null; is_optional: boolean; optional_included: boolean;
  user_estimate: number | null; confidence?: number; notes?: string | null;
}
export interface FqQuote {
  id?: string; vendor_id: string | null; customer_id: string | null; product_id: string | null;
  quote_date: string | null; valid_until: string | null; reference_no: string | null; direction: string;
  origin_city: string | null; origin_port: string | null; destination_city: string | null; destination_port: string | null;
  destination_country: string | null; mode: string; container_size: string | null;
  cbm: number | null; gross_weight_kg: number | null; pallet_count: number | null; wm_kg_per_cbm: number;
  declared_invoice_value_usd: number | null; duty_estimate_usd: number | null; insurance_usd: number | null;
  fx_snapshot: FxSnapshot; status: string; notes: string | null; source_file_path: string | null; raw_text: string | null;
  lines: FqLine[];
  // review-only
  vendor_name?: string | null; field_confidence?: Record<string, number>;
}

export const QUOTE_COLS = ['vendor_id', 'customer_id', 'product_id', 'quote_date', 'valid_until', 'reference_no', 'direction', 'origin_city', 'origin_port', 'destination_city', 'destination_port', 'destination_country', 'mode', 'container_size', 'cbm', 'gross_weight_kg', 'pallet_count', 'wm_kg_per_cbm', 'declared_invoice_value_usd', 'duty_estimate_usd', 'insurance_usd', 'fx_snapshot', 'status', 'notes', 'source_file_path', 'raw_text'] as const;
const LINE_COLS = ['sort_order', 'raw_label', 'normalized_name', 'bucket', 'charge_basis', 'rate', 'currency', 'minimum_amount', 'quantity_override', 'applicable', 'applicable_reason', 'is_optional', 'optional_included', 'user_estimate'] as const;

export async function loadRefs() {
  const [v, c, p, fx, s] = await Promise.all([
    db.from('fq_vendors').select('*').order('name'),
    db.from('fq_customers').select('*').order('name'),
    db.from('fq_products').select('*').order('name'),
    db.from('fq_fx_rates').select('*').order('effective_date', { ascending: false }),
    db.from('fq_settings').select('*').limit(1),
  ]);
  return {
    vendors: (v.data || []) as FqRef[], customers: (c.data || []) as FqRef[], products: (p.data || []) as FqRef[],
    fx: (fx.data || []) as { id: string; currency: string; rate_to_usd: number; effective_date: string }[],
    settings: (s.data || [])[0] as { id: string; default_wm_kg_per_cbm: number; keyword_map: any[] } | undefined,
  };
}

export async function loadQuotes(): Promise<(FqQuote & { id: string })[]> {
  const [{ data: qs }, { data: ls }] = await Promise.all([
    db.from('fq_quotes').select('*').order('quote_date', { ascending: false }),
    db.from('fq_quote_lines').select('*').order('sort_order'),
  ]);
  const byQ: Record<string, FqLine[]> = {};
  (ls || []).forEach((l: any) => { (byQ[l.quote_id] ||= []).push(l); });
  return (qs || []).map((q: any) => ({ ...q, lines: byQ[q.id] || [] }));
}

export async function loadQuote(id: string) {
  const [{ data: q }, { data: ls }] = await Promise.all([
    db.from('fq_quotes').select('*').eq('id', id).maybeSingle(),
    db.from('fq_quote_lines').select('*').eq('quote_id', id).order('sort_order'),
  ]);
  return q ? ({ ...q, lines: ls || [] } as FqQuote & { id: string }) : null;
}

export async function ensureRef(table: 'fq_vendors' | 'fq_customers' | 'fq_products', name: string): Promise<string> {
  const { data: ex } = await db.from(table).select('id').ilike('name', name).limit(1);
  if (ex?.[0]) return ex[0].id;
  const { data, error } = await db.from(table).insert({ name }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function saveQuote(q: FqQuote): Promise<string> {
  const t = computeQuote(q, q.lines);
  const row: any = Object.fromEntries(QUOTE_COLS.map(k => [k, (q as any)[k] ?? null]));
  row.wm_kg_per_cbm = q.wm_kg_per_cbm || 1000;
  row.chargeable_wm = chargeableWm(q.cbm, q.gross_weight_kg, q.wm_kg_per_cbm);
  Object.assign(row, { fob_usd: t.fob_usd, cif_usd: t.cif_usd, ddp_usd: t.ddp_usd, has_unpriced: t.unpriced_count > 0 });
  let id = q.id;
  if (id) {
    const { error } = await db.from('fq_quotes').update(row).eq('id', id); if (error) throw error;
    await db.from('fq_quote_lines').delete().eq('quote_id', id);
  } else {
    const { data, error } = await db.from('fq_quotes').insert(row).select('id').single(); if (error) throw error;
    id = data.id;
  }
  const lines = q.lines.map((l, i) => ({
    ...Object.fromEntries(LINE_COLS.map(k => [k, (l as any)[k] ?? null])),
    applicable: l.applicable !== false, is_optional: !!l.is_optional, optional_included: l.optional_included !== false,
    currency: l.currency || 'USD', bucket: l.bucket || 'OTHER', charge_basis: l.charge_basis || 'flat',
    sort_order: i, quote_id: id, amount_original: t.lines[i].amount_original, amount_usd: t.lines[i].amount_usd,
  }));
  if (lines.length) { const { error } = await db.from('fq_quote_lines').insert(lines); if (error) throw error; }
  return id!;
}

export async function findDuplicate(q: FqQuote) {
  if (!q.vendor_id || !q.quote_date) return null;
  let query = db.from('fq_quotes').select('id, reference_no').eq('vendor_id', q.vendor_id).eq('quote_date', q.quote_date);
  if (q.cbm != null) query = query.eq('cbm', q.cbm);
  const { data } = await query;
  const lane = (x: any) => `${x.origin_port || x.origin_city || ''}>${x.destination_port || x.destination_city || ''}`.toLowerCase();
  const hits = (data || []).filter((d: any) => d.id !== q.id);
  if (!hits.length) return null;
  const { data: full } = await db.from('fq_quotes').select('*').in('id', hits.map((h: any) => h.id));
  return (full || []).find((d: any) => lane(d) === lane(q)) || null;
}

export const laneOf = (q: Partial<FqQuote>) =>
  `${q.origin_port || q.origin_city || '?'} → ${q.destination_port || q.destination_city || q.destination_country || '?'}`;

export const blankLine = (i: number): FqLine => ({
  sort_order: i, raw_label: '', normalized_name: '', bucket: 'OTHER', charge_basis: 'flat', rate: null, currency: 'USD',
  minimum_amount: null, quantity_override: null, applicable: true, applicable_reason: null, is_optional: false,
  optional_included: true, user_estimate: null,
});

export const usd = (v: number | null | undefined, d = 0) =>
  v == null || isNaN(v) ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const money = (v: number | null | undefined, cur: string, d = 2) =>
  v == null || isNaN(v) ? '—' : `${cur} ${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
