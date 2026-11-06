import { describe, it, expect } from 'vitest';
import { analyzeLines, moStats, marginTone, type SoOrder } from '../so-profitability';

const order: SoOrder = {
  id: 1, name: 'S1', date_order: '2026-01-01', customer: null, project_id: 1, project_name: null, currency: 'INR',
  amount_untaxed: 1000, amount_total: 1000, state: 'sale', status: 'Completed',
  lines: [
    { product_id: 9, sku: 'A', name: 'A', qty: 10, price_unit: 100, subtotal: 1000, volume: 1, standard_price_inr: 0, type: null },
    { product_id: 8, sku: 'B', name: 'B', qty: 0, price_unit: 50, subtotal: 0, volume: 1, standard_price_inr: 0, type: null },
  ],
  mos: [{ id: 5, name: 'MO', state: 'done', qty: 10, qty_produced: 10, product_id: 9, sku: 'A', product_name: 'A' }],
  materials: [
    { mo_id: 5, mo_name: 'MO', sku: 'W', name: 'Wood', type: null, planned_qty: 10, actual_qty: 10, uom: 'u', unit_price_inr: 20, total_inr: 200 },
    { mo_id: 5, mo_name: 'MO', sku: 'S', name: 'Sanding', type: null, planned_qty: 10, actual_qty: 10, uom: 'u', unit_price_inr: 10, total_inr: 100, subcontract: true },
  ],
  labor: [], shipping: [],
};

describe('SO profitability subcontracting', () => {
  it('keeps subcontracting out of materials but in MO total', () => {
    const st = moStats(order, order.mos[0]);
    expect(st.materials).toBe(200);
    expect(st.subcontract).toBe(100);
    expect(st.total).toBe(300);
  });
  it('subcontracting hits net profit, not gross', () => {
    const [r] = analyzeLines(order, 'INR', 80);
    expect(r.unitGross).toBe(80);
    expect(r.unitNet).toBe(70);
  });
  it('drops lines with zero quantity sold', () => {
    expect(analyzeLines(order, 'INR', 80)).toHaveLength(1);
  });
});

describe('margin colour thresholds', () => {
  it('GPM: green above 30, amber 0-30, red below 0', () => {
    expect(marginTone(30.1, 30)).toBe('complete');
    expect(marginTone(30, 30)).toBe('progress');
    expect(marginTone(0, 30)).toBe('progress');
    expect(marginTone(-0.1, 30)).toBe('issue');
  });
  it('NPM: green above 10, amber 0-10, red below 0', () => {
    expect(marginTone(10.1, 10)).toBe('complete');
    expect(marginTone(10, 10)).toBe('progress');
    expect(marginTone(0, 10)).toBe('progress');
    expect(marginTone(-0.1, 10)).toBe('issue');
  });
});
