import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({}) } }));

import { costAt, latestQuotedLines, quotedInCurrency, rankQuotes, type QuoteRow } from './quoted-price';
import { buildRows, computeResults, targetFromQuoted, targetIsQuoted } from './costing-workspace';
import { bundle } from './__tests__/workspace-fixture';

const line = (product_id: string, price: number, extra: Record<string, any> = {}) => ({ product_id, name: product_id, unit_price_usd: price, quantity: 50, ...extra });
const quote = (id: string, created_at: string, products: any[], extra: Partial<QuoteRow> = {}): QuoteRow =>
  ({ id, quote_number: `Q-${id}`, currency: 'USD', currency_rate_inr_per_unit: 90, created_at, status: 'draft', products, ...extra });

describe('last quoted price', () => {
  it('trusts a sent quote over a newer draft, and newer over older', () => {
    const quotes = [
      quote('draft', '2026-11-05', [line('a', 30)]),
      quote('old', '2026-09-01', [line('a', 20)], { sent_at: '2026-09-02' }),
      quote('new', '2026-10-01', [line('a', 25)], { status: 'sent' }),
    ];
    expect(rankQuotes(quotes).map(q => q.id)).toEqual(['new', 'old', 'draft']);
    const got = latestQuotedLines(quotes, [{ id: 'a' }, { id: 'b' }]);
    expect(got.a).toMatchObject({ price: 25, quoteNumber: 'Q-new', sent: true });
    expect(got.b).toBeUndefined();
  });

  it('falls back to a draft when nothing was sent, and to the SKU code for a repeat product', () => {
    const quotes = [quote('d1', '2026-11-01', [line('old-id', 12, { sku: 'ABC-1 ' }), line('kit', 99, { is_assembly: true }), line('z', 0)])];
    const got = latestQuotedLines(quotes, [{ id: 'new-id', sku: 'abc-1' }, { id: 'kit' }, { id: 'z' }]);
    expect(got['new-id']).toMatchObject({ price: 12, sent: false, quotedProductId: 'old-id' });
    expect(got.kit).toBeUndefined();
    expect(got.z).toBeUndefined();
  });

  it('converts to the inquiry currency only when it differs', () => {
    expect(quotedInCurrency({ price: 10, currency: 'USD', rateInr: 90 }, 'USD', 95)).toBe(10);
    expect(quotedInCurrency({ price: 10, currency: 'USD', rateInr: 90 }, 'INR', 95)).toBe(900);
    expect(quotedInCurrency({ price: 950, currency: 'INR', rateInr: 1 }, 'USD', 95)).toBe(10);
    expect(quotedInCurrency({ price: 10, currency: 'EUR', rateInr: null }, 'USD', 95)).toBeNull();
  });

  it('reads the cost on record when it was quoted', () => {
    const h = [{ recorded_at: '2026-10-01', unit_cost_inr: 100 }, { recorded_at: '2026-10-10', unit_cost_inr: 120 }, { recorded_at: '2026-11-01', unit_cost_inr: 150 }];
    expect(costAt(h, '2026-10-15')).toBe(120);
    expect(costAt(h, '2026-09-01')).toBeNull();
  });

  it('makes the quoted price the target, skipping SKUs never quoted or already on it', () => {
    const b = { ...bundle(), quoted: { a: { price: 18.4, currency: 'USD', rateInr: 90, quantity: 50, quoteId: 'q', quoteNumber: 'Q-1', at: '2026-10-21', sent: true, quotedProductId: 'a', costInrThen: null } } };
    const rows = buildRows(b, computeResults(b));
    expect(rows.find(r => r.p.id === 'a')!.quoted!.price).toBe(18.4);
    expect(rows.find(r => r.p.id === 'c')!.quoted).toBeNull();
    const m = targetFromQuoted(b, rows, ['a', 'b', 'c'])!;
    expect(m.touched).toEqual(['a']);
    const after = buildRows(m.next, computeResults(m.next));
    const a = after.find(r => r.p.id === 'a')!;
    expect(a.target).toBe(18.4);
    expect(targetIsQuoted(a)).toBe(true);
    expect(after.find(r => r.p.id === 'b')!.target).toBe(60);
    expect(targetFromQuoted(m.next, after, ['a', 'b', 'c'])).toBeNull();
  });
});
