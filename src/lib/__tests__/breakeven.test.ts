import { describe, expect, it } from 'vitest';
import {
  breakeven, FALLBACK_INPUTS, liveMarginsFromOrders, liveOverheadFromHistory, requiredRevenue, resolveInputs,
} from '@/lib/breakeven';
import type { SoOrder } from '@/lib/so-profitability';

describe('breakeven math', () => {
  it('matches the original model at 40 / 60', () => {
    // overhead 6×3500 + 6×2500 = 36,000 + 10,000 buffer = 46,000; rate 0.4×0.10 + 0.6×0.40 = 0.28
    const r = breakeven(FALLBACK_INPUTS);
    expect(r.target).toBe(46000);
    expect(r.rate).toBeCloseTo(0.28, 10);
    expect(r.required).toBeCloseTo(46000 / 0.28, 6);
    expect(r.tradeContribution + r.mfgOhContribution + r.mfgNetContribution).toBeCloseTo(46000, 6);
  });

  it('needs more revenue when manufacturing net margin is kept as profit', () => {
    const kept = requiredRevenue({ ...FALLBACK_INPUTS, netCounts: false });
    expect(kept).toBeCloseTo(46000 / (0.4 * 0.1 + 0.6 * 0.3), 6);
    expect(kept).toBeGreaterThan(requiredRevenue(FALLBACK_INPUTS));
  });

  it('is infinite when nothing contributes', () => {
    expect(requiredRevenue({ ...FALLBACK_INPUTS, tradeNetPct: 0, mfgSharePct: 0 })).toBe(Infinity);
  });

  it('lets overrides win over live values, and live win over fallbacks', () => {
    const i = resolveInputs({ tradeNetPct: 12, mfgOhPct: 25 }, { mfgOhPct: 28, netCounts: false });
    expect(i.tradeNetPct).toBe(12);
    expect(i.mfgOhPct).toBe(28);
    expect(i.mfgNetPct).toBe(FALLBACK_INPUTS.mfgNetPct);
    expect(i.netCounts).toBe(false);
  });
});

describe('live values', () => {
  const line = (product_id: number, qty: number, price: number, std = 0) => ({
    product_id, sku: null, name: null, qty, price_unit: price, subtotal: qty * price, volume: 0, standard_price_inr: std, type: null,
  });
  const trading: SoOrder = {
    id: 1, name: 'S1', date_order: '2026-01-01', customer: null, project_id: null, project_name: null, currency: 'USD',
    amount_untaxed: 1000, amount_total: 1000, state: 'sale', status: 'Completed',
    lines: [line(10, 10, 100, 9000)], mos: [], materials: [], labor: [], shipping: [],
  };
  const mfg: SoOrder = {
    ...trading, id: 2, name: 'S2', lines: [line(20, 10, 300)],
    mos: [{ id: 5, name: 'MO5', state: 'done', qty: 10, product_id: 20, sku: null, product_name: null }],
    materials: [{ mo_id: 5, mo_name: null, sku: null, name: null, type: null, planned_qty: 1, actual_qty: 1, uom: null, unit_price_inr: 1, total_inr: 120000 }],
    labor: [{ mo_id: 5, activity: null, category: 'x', hours: 10, direct_inr: 30000, overhead_inr: 60000, burdened_inr: 90000 }],
  };

  it('splits trading and manufacturing margins and mix', () => {
    // fx 100: trading revenue 1000, cost 900 → 10%; mfg revenue 3000, cost 2100 (direct 300 + OH 600) → 30% net, 30% labour + OH
    const m = liveMarginsFromOrders([trading, mfg], 100);
    expect(m.tradeNetPct).toBeCloseTo(10, 6);
    expect(m.mfgNetPct).toBeCloseTo(30, 6);
    expect(m.mfgOhPct).toBeCloseTo(30, 6);
    expect(m.mfgSharePct).toBeCloseTo(75, 6);
    expect(m.tradeOrders).toBe(1);
    expect(m.mfgOrders).toBe(1);
    expect(m.guessedOrders).toBe(2);
  });

  it('uses the Odoo tag over the MO guess', () => {
    // S2 has MOs but is tagged Trading: both orders are trading, 4000 revenue, 3000 cost → 25%
    const m = liveMarginsFromOrders([trading, { ...mfg, tags: ['VIP', 'trading'] }], 100);
    expect(m.tradeOrders).toBe(2);
    expect(m.mfgOrders).toBe(0);
    expect(m.tradeNetPct).toBeCloseTo(25, 6);
    expect(m.mfgSharePct).toBeCloseTo(0, 6);
    expect(m.guessedOrders).toBe(1);
  });

  it('falls back to the MO guess when an order has neither tag or both', () => {
    const m = liveMarginsFromOrders([{ ...trading, tags: ['Trading', 'Manufacturing'] }, mfg], 100);
    expect(m.tradeOrders).toBe(1);
    expect(m.mfgOrders).toBe(1);
    expect(m.guessedOrders).toBe(2);
  });

  it('turns monthly overhead history into high and low months', () => {
    const o = liveOverheadFromHistory({ '2026-01': 400000, '2026-02': 200000, '2026-03': 200000, '2026-04': 400000 }, 100)!;
    expect(o.highOhUsd).toBe(4000);
    expect(o.lowOhUsd).toBe(2000);
    expect(o.highMonths).toBe(6);
    expect(o.averageUsd).toBe(3000);
    expect(liveOverheadFromHistory({}, 100)).toBeNull();
  });
});
