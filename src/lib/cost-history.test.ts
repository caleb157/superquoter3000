import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { costChanged, costPointFromResult, costRiseWarnings, describeCostChange, type CostPoint } from './cost-history';

const point = (over: Partial<CostPoint> = {}, parts: Partial<CostPoint['parts']> = {}): CostPoint => ({
  unit_cost_usd: 30, unit_price_usd: 40, unit_cost_inr: 2490, exchange_rate: 83, markup_percent: 0.33, man_hours: 2,
  parts: { raw_piece: 1200, hardware: 200, materials: 300, labor: 400, overhead: 250, shipping: 100, capital: 40, ...parts },
  raw_vendor: 'Rao',
  ...over,
});

describe('costPointFromResult', () => {
  it('splits COGS into raw piece, hardware and the rest, and picks the chosen raw vendor', () => {
    const p = costPointFromResult({
      summary: { product_cost_per_unit_usd: 30, unit_price_usd: 40, product_cost_per_unit_inr: 2490, total_capital_per_unit: 40 },
      exchangeRate: 83, markupPercent: 0.33, manHoursPerUnit: 2,
      cogsPerUnit: 1500, nonUnitCogsPerUnit: 50, directOhPerUnit: 400, indirectOhPerUnit: 250, shippingPerUnit: 100,
      resolvedCogsRows: [
        { cogs_type: 'Raw Piece', include: 'No', components_per_product: 1, unit_cost_inr: 900, vendor_name: 'Other' },
        { cogs_type: 'Raw Piece', include: 'Yes', components_per_product: 1, unit_cost_inr: 1200, vendor_name: ' Rao ' },
        { cogs_type: 'Handles + Knobs', include: 'Yes', components_per_product: 2, unit_cost_inr: 100 },
        { cogs_type: 'Finishing Materials', include: 'Yes', components_per_product: 1, unit_cost_inr: 100 },
      ],
    } as any);
    expect(p.parts.raw_piece).toBe(1200);
    expect(p.parts.hardware).toBe(200);
    expect(p.parts.materials).toBe(150); // 1500 + 50 − 1200 − 200
    expect(p.raw_vendor).toBe('Rao');
    expect(p.parts.labor).toBe(400);
  });
});

describe('costChanged', () => {
  it('logs the first point, skips no-ops, and catches part or rate moves', () => {
    expect(costChanged(null, point())).toBe(true);
    expect(costChanged(point(), point())).toBe(false);
    expect(costChanged(point(), point({}, { raw_piece: 1380 }))).toBe(true);
    expect(costChanged(point(), point({ exchange_rate: 84 }))).toBe(true);
    expect(costChanged(point(), point({}, { raw_piece: 1200.2 }))).toBe(false);
  });
});

describe('describeCostChange', () => {
  it('names the raw piece change with its vendor and the new FOB', () => {
    const text = describeCostChange(point(), point({ unit_price_usd: 43.1, raw_vendor: 'Mehta' }, { raw_piece: 1380 }));
    expect(text).toBe('Raw piece +₹180 (vendor Mehta) · FOB $40.00 → $43.10');
  });
  it('calls a labor change with the same man-hours a rate change', () => {
    expect(describeCostChange(point(), point({}, { labor: 450 }))).toBe('Labor +₹50 (rate change)');
    expect(describeCostChange(point(), point({ man_hours: 2.5 }, { labor: 500 }))).toBe('Labor +₹100 (man-hours 2.00 → 2.50)');
  });
  it('reports exchange rate moves', () => {
    expect(describeCostChange(point(), point({ exchange_rate: 84 }))).toBe('Exchange rate 83.00 → 84.00');
  });
});

describe('costRiseWarnings', () => {
  const prevSent = [{
    quote: { currency: 'USD', sent_at: '2026-09-03T10:00:00Z', quote_number: 'Q-1' },
    lines: [{ product_id: 'old', sku: 'T-1', name: 'Table', unit_price_usd: 41.2 }],
  }];
  const history = {
    old: [
      { recorded_at: '2026-09-01T00:00:00Z', unit_cost_usd: 30, reason: null },
      { recorded_at: '2026-09-10T00:00:00Z', unit_cost_usd: 31, reason: 'after quote' },
    ],
    new: [{ recorded_at: '2026-10-01T00:00:00Z', unit_cost_usd: 33.6, reason: 'Raw piece +₹180' }],
  };

  it('flags a repeat-order line by SKU using the cost at the time of the last quote', () => {
    const w = costRiseWarnings([{ product_id: 'new', sku: 'T-1', name: 'Table' }], prevSent, history, { new: 33.6 });
    expect(w).toHaveLength(1);
    expect(w[0].pct).toBeCloseTo(0.12);
    expect(w[0].quotedPrice).toBe(41.2);
    expect(w[0].reasons).toEqual(['Raw piece +₹180']);
  });

  it('stays quiet when cost fell, there is no earlier quote, or no history before it', () => {
    expect(costRiseWarnings([{ product_id: 'new', sku: 'T-1', name: 'Table' }], prevSent, history, { new: 29 })).toEqual([]);
    expect(costRiseWarnings([{ product_id: 'x', sku: 'Z', name: 'Chair' }], prevSent, history, { x: 50 })).toEqual([]);
    expect(costRiseWarnings([{ product_id: 'new', sku: 'T-1', name: 'Table' }], prevSent, { old: [history.old[1]] }, { new: 50 })).toEqual([]);
  });
});
