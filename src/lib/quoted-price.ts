// Last quoted price per product: what the customer was last told for a SKU, read from the
// saved quotes (quote_snapshots). A sent quote beats a draft, newer beats older, and a line is
// matched by product first, then by SKU code (repeat orders are new products with the same SKU).
// Read-only and fail-soft: costing never waits on, or breaks because of, a quote lookup.
import { supabase } from '@/integrations/supabase/client';
import type { QuoteCur } from '@/lib/quote-currency';

/** A quote line as stored, before conversion to the inquiry's quote currency. */
export type QuotedLine = {
  /** Per unit, in the quote's own currency. */
  price: number;
  currency: string;
  /** INR per unit of the quote's currency, frozen when the quote was made. */
  rateInr: number | null;
  quantity: number | null;
  quoteId: string;
  quoteNumber: string | null;
  /** When it was sent, or created for a draft. */
  at: string;
  sent: boolean;
  /** The product the line was quoted for (differs from the current one on a SKU match). */
  quotedProductId: string | null;
  /** Unit cost (INR) on record when it was quoted; null when there is no cost history that far back. */
  costInrThen: number | null;
};

export type QuoteRow = {
  id: string; quote_number?: string | null; currency?: string | null; currency_rate_inr_per_unit?: number | null;
  sent_at?: string | null; created_at?: string | null; status?: string | null; products?: any[] | null;
};

const key = (s: unknown) => String(s ?? '').trim().toLowerCase();
const ts = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);
const isSent = (q: QuoteRow) => !!q.sent_at || ['sent', 'viewed', 'approved'].includes(q.status ?? '');

/** Quotes in the order they are trusted: sent ones newest first, then drafts newest first. */
export function rankQuotes(quotes: QuoteRow[]): QuoteRow[] {
  const when = (q: QuoteRow) => ts(q.sent_at) || ts(q.created_at);
  return [...quotes].sort((a, b) => Number(isSent(b)) - Number(isSent(a)) || when(b) - when(a));
}

/** The last quoted line for each product (by id), from the given quotes. Kits and unpriced lines are skipped. */
export function latestQuotedLines(quotes: QuoteRow[], products: Array<{ id: string; sku?: string | null }>): Record<string, QuotedLine> {
  const byProduct = new Map<string, QuotedLine>();
  const bySku = new Map<string, QuotedLine>();
  for (const q of rankQuotes(quotes)) {
    for (const l of q.products ?? []) {
      const price = Number(l?.unit_price_usd);
      if (!l || l.is_assembly || !(price > 0)) continue;
      const hit: QuotedLine = {
        price, currency: q.currency || 'USD',
        rateInr: Number(q.currency_rate_inr_per_unit) > 0 ? Number(q.currency_rate_inr_per_unit) : null,
        quantity: Number(l.quantity) > 0 ? Number(l.quantity) : null,
        quoteId: q.id, quoteNumber: q.quote_number ?? null,
        at: q.sent_at || q.created_at || '', sent: isSent(q),
        quotedProductId: l.product_id ?? null, costInrThen: null,
      };
      if (l.product_id && !byProduct.has(l.product_id)) byProduct.set(l.product_id, hit);
      if (key(l.sku) && !bySku.has(key(l.sku))) bySku.set(key(l.sku), hit);
    }
  }
  const out: Record<string, QuotedLine> = {};
  for (const p of products) {
    const hit = byProduct.get(p.id) ?? (key(p.sku) ? bySku.get(key(p.sku)) : undefined);
    if (hit) out[p.id] = hit;
  }
  return out;
}

/** A quoted price in the inquiry's quote currency (`fx` = INR per USD today); null when it can't be converted. */
export function quotedInCurrency(q: Pick<QuotedLine, 'price' | 'currency' | 'rateInr'>, cur: QuoteCur, fx: number): number | null {
  if (q.currency === cur) return q.price;
  const inr = q.currency === 'INR' ? q.price : q.rateInr ? q.price * q.rateInr : q.currency === 'USD' && fx > 0 ? q.price * fx : null;
  if (inr == null) return null;
  return cur === 'INR' ? inr : fx > 0 ? inr / fx : null;
}

/** The last cost on record at or before `at` (rows oldest first). */
export function costAt(history: Array<{ recorded_at: string; unit_cost_inr: number }>, at: string): number | null {
  let hit: number | null = null;
  for (const r of history) {
    if (ts(r.recorded_at) > ts(at)) break;
    if (Number(r.unit_cost_inr) > 0) hit = Number(r.unit_cost_inr);
  }
  return hit;
}

/**
 * Last quoted line for each of an inquiry's products, looking across every quote made for the
 * same customer. Returns {} on any failure.
 */
export async function loadQuotedLines(
  inq: { id: string; customer_id?: string | null } | null | undefined,
  products: Array<{ id: string; sku?: string | null }>,
): Promise<Record<string, QuotedLine>> {
  if (!inq?.id || products.length === 0) return {};
  const db = supabase as any;
  try {
    let inquiryIds = [inq.id];
    if (inq.customer_id) {
      const { data } = await db.from('customer_rfqs').select('id').eq('customer_id', inq.customer_id).limit(500);
      const ids = ((data ?? []) as any[]).map(r => r.id);
      if (ids.length) inquiryIds = Array.from(new Set([inq.id, ...ids]));
    }
    const { data: quotes, error } = await db.from('quote_snapshots')
      .select('id, quote_number, currency, currency_rate_inr_per_unit, sent_at, created_at, status, products')
      .in('customer_rfq_id', inquiryIds).order('created_at', { ascending: false }).limit(100);
    if (error || !quotes?.length) return {};
    const lines = latestQuotedLines(quotes as QuoteRow[], products);
    const ids = Object.keys(lines);
    if (!ids.length) return lines;

    // What each product cost when it was quoted, from the cost history (optional table).
    const histIds = Array.from(new Set(ids.map(id => lines[id].quotedProductId ?? id)));
    const { data: hist, error: histErr } = await db.from('product_cost_history')
      .select('product_id, recorded_at, unit_cost_inr').in('product_id', histIds)
      .order('recorded_at', { ascending: true }).limit(5000);
    if (!histErr && hist?.length) {
      const byProduct: Record<string, any[]> = {};
      for (const r of hist as any[]) (byProduct[r.product_id] ??= []).push(r);
      for (const id of ids) {
        const l = lines[id];
        lines[id] = { ...l, costInrThen: costAt(byProduct[l.quotedProductId ?? id] ?? [], l.at) };
      }
    }
    return lines;
  } catch {
    return {};
  }
}
