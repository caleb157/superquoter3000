import { describe, expect, it } from 'vitest';
import { annualize, countedSkus, longView, scenarioSummary, type AmazonSku } from './dkt-amazon';

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

describe('countedSkus', () => {
  it('drops SKUs left out of the projection, so the scenario totals ignore them', () => {
    const a = sku();
    const b = sku({ id: 's2', excluded: true, price_usd: 999 });
    expect(countedSkus([a, b]).map(x => x.id)).toEqual(['s1']);
    expect(scenarioSummary(countedSkus([a, b]), '2028-09').earnings).toBeCloseTo(scenarioSummary([a], '2028-09').earnings, 9);
  });
});

describe('longView', () => {
  it('runs to May 2030 and splits net earnings by year', () => {
    const lv = longView([sku()]);
    expect(lv.until).toBe('2030-05');
    expect(lv.summary.months[lv.summary.months.length - 1].month).toBe('2030-05');
    expect(lv.monthProfit).toBeCloseTo(75 * 70 * 0.2, 6);
    expect(lv.runRate).toBeCloseTo(lv.monthProfit * 12, 6);
    expect(lv.totalProfit).toBeCloseTo(lv.byYear.reduce((t, y) => t + y.profit, 0), 6);
    expect(lv.byYear.map(y => y.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(lv.byYear[4].months).toBe(5);
    expect(lv.summary.months[lv.summary.months.length - 1].earnedCumulative).toBeCloseTo(lv.totalProfit, 6);
  });
  it('leaves out excluded SKUs when given counted SKUs', () => {
    const both = [sku(), sku({ id: 's2', excluded: true })];
    expect(longView(countedSkus(both)).totalProfit).toBeCloseTo(longView([sku()]).totalProfit, 6);
  });
  it('is empty with no SKUs', () => {
    const lv = longView([]);
    expect(lv.totalProfit).toBe(0);
    expect(lv.monthProfit).toBe(0);
    expect(lv.byYear).toEqual([]);
  });
});
