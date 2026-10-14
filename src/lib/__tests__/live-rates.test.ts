import { describe, it, expect } from 'vitest';
import { applyLiveRates, withLiveDirectRates, isLiveStale } from '@/lib/live-rates';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';
import { computeProductCosting } from '@/lib/costing-engine';
import { avgRateByDesignation } from '@/lib/calculations';
import { inrPerUnitFromOdoo, laborWindow, recentDaysWindow, laborRatesFromEntries, laborTypeForCategory, planCurrencySync } from '../../../supabase/functions/live-rates-sync/rates';

const gsManual = { exchange_rate: 85, indirect_overhead_per_mh: 40 };
const gsLive = {
  ...gsManual, live_exchange_rate: 88.4, live_burdened_per_mh: 126.85,
  live_direct_rates: { Finishing: 100 },
};

describe('Odoo / LaborTrax math', () => {
  it('reads INR per unit from Odoo rate, falling back to inverse_rate', () => {
    expect(inrPerUnitFromOdoo({ rate: 1 / 88 })).toBeCloseTo(88, 6);
    expect(inrPerUnitFromOdoo({ rate: 0, inverse_rate: 0.58 })).toBeCloseTo(0.58, 6);
    expect(inrPerUnitFromOdoo({})).toBe(0);
  });

  it('uses the last six complete months for the burdened rate', () => {
    expect(laborWindow('2026-10-12')).toEqual({ from: '2026-04-01', to: '2026-09-30' });
    expect(laborWindow('2026-01-05', 6)).toEqual({ from: '2025-07-01', to: '2025-12-31' });
  });

  it('uses the last 21 full days for direct wages', () => {
    expect(recentDaysWindow('2026-10-12')).toEqual({ from: '2026-09-21', to: '2026-10-11' });
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
  it('always swaps in the live exchange rate and burdened cost', () => {
    const s = applyLiveRates(gsLive);
    expect(s.exchange_rate).toBe(88.4);
    expect(s.indirect_overhead_per_mh).toBe(126.85);
  });

  it('falls back to the stored value when a live value is missing', () => {
    const s = applyLiveRates({ ...gsLive, live_exchange_rate: null });
    expect(s.exchange_rate).toBe(85);
  });

  it('lets a per-inquiry override win over the live value, even when merged twice', () => {
    const once = mergeSettingsWithInquiry(gsLive, { exchange_rate_override: 80 });
    const twice = mergeSettingsWithInquiry(once, { exchange_rate_override: 80 });
    expect(twice.exchange_rate).toBe(80);
    expect(twice.indirect_overhead_per_mh).toBe(126.85);
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
  it('uses the Settings fallback rate for types LaborTrax has no rate for', () => {
    const list = withLiveDirectRates(employees, applyLiveRates({ ...gsLive, fallback_direct_rates: { Packaging: 55, Finishing: 1 } }));
    expect(avgRateByDesignation(list, 'Finishing')).toBe(100); // live wins
    expect(avgRateByDesignation(list, 'Packaging')).toBe(55);
    expect(avgRateByDesignation(withLiveDirectRates(employees, applyLiveRates({ ...gsManual, fallback_direct_rates: { Finishing: 75 } })), 'Finishing')).toBe(75);
  });
  it('keeps the employee average when LaborTrax has no rates', () => {
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
  });

  it('uses the stored values before the first sync', () => {
    const fallback = run(gsManual);
    expect(fallback.directOhPerUnit).toBeCloseTo(2 * 80, 6);
    expect(fallback.indirectOhPerUnit).toBeCloseTo(2 * 40, 6);
    expect(fallback.exchangeRate).toBe(85);
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

describe('currencies follow Odoo', () => {
  const existing = [
    { code: 'INR', units_per_inr_base: 1, import_rate: 1, symbol: '₹' },
    { code: 'USD', units_per_inr_base: 1, import_rate: 90, symbol: '$' },
    { code: 'AUD', units_per_inr_base: 1, import_rate: 60, symbol: 'A$' },
    { code: 'JPY', units_per_inr_base: 100, import_rate: null, symbol: '¥' },
    { code: 'BHD', units_per_inr_base: 1, import_rate: 230, symbol: null },
  ];
  const odoo = [
    { code: 'INR', name: 'Indian Rupee', symbol: '₹', inrPerUnit: 1 },
    { code: 'USD', name: 'US Dollar', symbol: '$', inrPerUnit: 95.25 },
    { code: 'AUD', name: 'Australian Dollar', symbol: '$', inrPerUnit: 66.75 },
    { code: 'JPY', name: 'Yen', symbol: '¥', inrPerUnit: 0.6 },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', inrPerUnit: 110 },
  ];
  const plan = planCurrencySync(existing, odoo, '2026-10-12');
  const patch = (code: string) => plan.updates.find(u => u.code === code)?.patch;

  it('takes rate and name from Odoo, scaled by units per INR base, and never touches INR', () => {
    expect(patch('USD')).toMatchObject({ import_rate: 95.25, export_rate: 95.25, name: 'US Dollar', effective_start_date: '2026-10-12' });
    expect(patch('JPY')).toMatchObject({ import_rate: 60 });
    expect(patch('INR')).toBeUndefined();
  });

  it('keeps a symbol already set, so AUD stays A$ though Odoo says $', () => {
    expect(patch('AUD')).not.toHaveProperty('symbol');
  });

  it('adds Odoo currencies that are missing and clears the rate of ones Odoo no longer has', () => {
    expect(plan.inserts).toEqual([expect.objectContaining({ code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', import_rate: 110, units_per_inr_base: 1 })]);
    expect(patch('BHD')).toEqual({ import_rate: null, export_rate: null });
  });
});
