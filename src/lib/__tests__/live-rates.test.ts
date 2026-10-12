import { describe, it, expect } from 'vitest';
import { applyLiveRates, withLiveDirectRates, isLiveStale } from '@/lib/live-rates';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';
import { computeProductCosting } from '@/lib/costing-engine';
import { avgRateByDesignation } from '@/lib/calculations';
import { inrPerUnitFromOdoo, laborWindow, laborRatesFromEntries, laborTypeForCategory } from '../../../supabase/functions/live-rates-sync/rates';

const gsManual = { exchange_rate: 85, indirect_overhead_per_mh: 40 };
const gsLive = {
  ...gsManual, use_live_rates: true, live_exchange_rate: 88.4, live_burdened_per_mh: 126.85,
  live_direct_rates: { Finishing: 100 },
};

describe('Odoo / LaborTrax math', () => {
  it('reads INR per unit from Odoo rate, falling back to inverse_rate', () => {
    expect(inrPerUnitFromOdoo({ rate: 1 / 88 })).toBeCloseTo(88, 6);
    expect(inrPerUnitFromOdoo({ rate: 0, inverse_rate: 0.58 })).toBeCloseTo(0.58, 6);
    expect(inrPerUnitFromOdoo({})).toBe(0);
  });

  it('uses the last six complete months', () => {
    expect(laborWindow('2026-10-12')).toEqual({ from: '2026-04-01', to: '2026-09-30' });
    expect(laborWindow('2026-01-05', 6)).toEqual({ from: '2025-07-01', to: '2025-12-31' });
  });

  it('matches LaborTrax categories to HQ labor types by name', () => {
    const types = ['Manufacturing', 'Finishing', 'Packaging'];
    expect(laborTypeForCategory('Finishing - Polish', types)).toBe('Finishing');
    expect(laborTypeForCategory('PACKAGING', types)).toBe('Packaging');
    expect(laborTypeForCategory('Maintenance', types)).toBeNull();
  });

  it('computes burdened and direct ₹/man-hour inside the window', () => {
    const entries = [
      { date: '2026-05-02', hours: 10, work_order: 'Finishing', direct_labor_cost: 1000, allocated_overhead_cost: 300, fully_burdened_cost: 1300 },
      { date: '2026-06-10', hours: 4, workers: 5, work_order: 'Packaging', direct_labor_cost: 1600, allocated_overhead_cost: 400, fully_burdened_cost: 2000 },
      { date: '2026-06-11', hours: 10, work_order: 'Maintenance', direct_labor_cost: 500, allocated_overhead_cost: 200, fully_burdened_cost: 700 },
      { date: '2026-01-01', hours: 99, work_order: 'Finishing', direct_labor_cost: 9, fully_burdened_cost: 9 }, // outside window
    ];
    const r = laborRatesFromEntries(entries, { from: '2026-04-01', to: '2026-09-30' }, ['Finishing', 'Packaging']);
    expect(r.hours).toBe(40); // 10 + 4×5 + 10
    expect(r.burdenedPerMh).toBeCloseTo(4000 / 40, 6);
    expect(r.directPerMh).toBeCloseTo(3100 / 40, 6);
    expect(r.directByType).toEqual({ Finishing: 100, Packaging: 80 });
    expect(r.categories.find(c => c.category === 'Maintenance')?.laborType).toBeNull();
  });
});

describe('applyLiveRates', () => {
  it('leaves settings alone while switched off', () => {
    const s = applyLiveRates({ ...gsLive, use_live_rates: false });
    expect(s.exchange_rate).toBe(85);
    expect(s.indirect_overhead_per_mh).toBe(40);
  });

  it('swaps in the live exchange rate and burdened cost when on', () => {
    const s = applyLiveRates(gsLive);
    expect(s.exchange_rate).toBe(88.4);
    expect(s.indirect_overhead_per_mh).toBe(126.85);
  });

  it('falls back to the manual value when a live value is missing', () => {
    const s = applyLiveRates({ ...gsLive, live_exchange_rate: null });
    expect(s.exchange_rate).toBe(85);
  });

  it('lets a per-inquiry override win over the live value, even when merged twice', () => {
    const once = mergeSettingsWithInquiry(gsLive, { exchange_rate_override: 80 });
    const twice = mergeSettingsWithInquiry(once, { exchange_rate_override: 80 });
    expect(twice.exchange_rate).toBe(80);
    expect(twice.indirect_overhead_per_mh).toBe(126.85);
  });

  it('can be forced either way for the price-impact preview', () => {
    expect(applyLiveRates({ ...gsLive, use_live_rates: false }, true).exchange_rate).toBe(88.4);
    expect(applyLiveRates(gsLive, false).exchange_rate).toBe(85);
    expect(mergeSettingsWithInquiry(applyLiveRates(gsLive, false), null).exchange_rate).toBe(85);
  });
});

describe('withLiveDirectRates', () => {
  const employees = [
    { hourly_rate_inr: 60, designations: ['Finishing', 'Packaging'] },
    { hourly_rate_inr: 80, designations: ['Finishing'] },
  ];
  it('uses the LaborTrax rate for types it has, the employee average for the rest', () => {
    const list = withLiveDirectRates(employees, applyLiveRates(gsLive));
    expect(avgRateByDesignation(list, 'Finishing')).toBe(100);
    expect(avgRateByDesignation(list, 'Packaging')).toBe(60);
    // applying twice changes nothing
    expect(avgRateByDesignation(withLiveDirectRates(list, applyLiveRates(gsLive)), 'Finishing')).toBe(100);
  });
  it('does nothing while live rates are off', () => {
    const list = withLiveDirectRates(employees, applyLiveRates(gsManual));
    expect(avgRateByDesignation(list, 'Finishing')).toBe(70);
  });
});

describe('costing engine with live rates', () => {
  const run = (gs: any) => computeProductCosting({
    product: { id: 'p1', quantity: 100, width_inch: 10, depth_inch: 10, height_inch: 10, markup_percent: 0.2, packaging_type: 'no_packaging' },
    cogsItems: [], nonUnitCogs: [],
    overheadItems: [{ id: 'o1', product_id: 'p1', labor_type: 'Finishing', man_hours_per_unit: 2, include: 'Yes', is_auto_estimated: false }],
    shippingItems: [], cbmRow: null, productType: null, boxData: [], chemicalPrices: [], shippingTypes: [],
    laborEmployees: [{ hourly_rate_inr: 80, designations: ['Finishing'] }],
    globalSettings: gs, inquiryOverrides: null, locations: [], difficulties: [],
  } as any);

  it('charges direct wages per type plus the burdened rate on every man-hour', () => {
    const live = run(gsLive);
    expect(live.directOhPerUnit).toBeCloseTo(2 * 100, 6);
    expect(live.indirectOhPerUnit).toBeCloseTo(2 * 126.85, 6);
    expect(live.exchangeRate).toBe(88.4);
    const manual = run(gsManual);
    expect(manual.directOhPerUnit).toBeCloseTo(2 * 80, 6);
    expect(manual.indirectOhPerUnit).toBeCloseTo(2 * 40, 6);
    expect(manual.exchangeRate).toBe(85);
  });
});

describe('isLiveStale', () => {
  it('is stale when never synced or older than 12 hours', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    expect(isLiveStale(null, now)).toBe(true);
    expect(isLiveStale('2026-10-12T01:00:00Z', now)).toBe(false);
    expect(isLiveStale('2026-10-11T23:00:00Z', now)).toBe(true);
  });
});
