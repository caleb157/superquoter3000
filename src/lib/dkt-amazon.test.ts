import { describe, expect, it } from 'vitest';
import { annualize, scenarioSummary, type AmazonSku } from './dkt-amazon';

const sku = (over: Partial<AmazonSku> = {}): AmazonSku => ({
  id: 's1', scenario_id: 'sc', name: 'URNS', mode: 'inventory',
  price_usd: 70, net_margin_pct: 0.2, units_per_month: 75, start_month: '2027-01',
  unit_cost_usd: 13, freight_per_unit_usd: 5, order_qty: 500, make_months: 2, ship_months: 2,
  ...over,
});

describe('annualize', () => {
  it('compounds a total return to a 12-month rate', () => {
    expect(annualize(0.21, 24)).toBeCloseTo(0.1, 6);
    expect(annualize(0.5, 12)).toBeCloseTo(0.5, 6);
  });
  it('returns null when it cannot compound', () => {
    expect(annualize(-1, 12)).toBeNull();
    expect(annualize(0.2, 0)).toBeNull();
  });
});

describe('scenarioSummary earnings and ROI', () => {
  it('sums price × net margin on units sold and divides by peak cash tied up', () => {
    const sum = scenarioSummary([sku()], '2028-09');
    const sold = 75 * 21; // Jan 2027 through Sep 2028, never short with reorders
    expect(sum.stockoutMonths).toBe(0);
    expect(sum.earnings).toBeCloseTo(sold * 70 * 0.2, 6);
    expect(sum.spanMonths).toBe(25); // first PO Sep 2026 → Sep 2028
    expect(sum.roi).toBeCloseTo(sum.earnings / sum.peakNeed, 9);
    expect(sum.annualRoi).toBeCloseTo(Math.pow(1 + sum.roi!, 12 / 25) - 1, 9);
  });
  it('has no ROI for simple lines (no cash tied up)', () => {
    const sum = scenarioSummary([sku({ mode: 'simple' })], '2027-12');
    expect(sum.earnings).toBeCloseTo(75 * 12 * 70 * 0.2, 6);
    expect(sum.roi).toBeNull();
    expect(sum.annualRoi).toBeNull();
  });
});
