// Running inches and the auto labor estimate (wood finishing from a ₹/RI budget, packaging per RI).
import { describe, expect, it } from 'vitest';
import { productRunningInches, runningInches } from '@/lib/calculations';
import { autoLaborEstimate } from '@/lib/costing-engine';

const difficulties = [
  { name: 'Easy', rupees_per_ri: 6 },
  { name: 'Medium', rupees_per_ri: 7 },
  { name: 'Hard' }, // no rate stored → default ₹8
];
const employees = [{ hourly_rate_inr: 100, designations: ['Finishing'] }, { hourly_rate_inr: 80, designations: ['Packaging'] }];
const wood = { name: 'Wood Console' };
const table = { name: 'Wood Table' };
const iron = { name: 'Iron Small' };

describe('running inches', () => {
  it('is longest + shortest', () => {
    expect(runningInches(49, 14, 55)).toBe(69);
    expect(productRunningInches({ width_inch: 49, depth_inch: 14, height_inch: 55 }, 'Wood Console')).toBe(69);
  });
  it('uses only the long side for Wood Table (not side tables)', () => {
    expect(productRunningInches({ width_inch: 72, depth_inch: 36, height_inch: 30 }, 'Wood Table')).toBe(72);
    expect(productRunningInches({ width_inch: 24, depth_inch: 24, height_inch: 22 }, 'Wood Side/End Table')).toBe(46);
  });
  it('honours a per-product override', () => {
    expect(productRunningInches({ width_inch: 72, depth_inch: 36, height_inch: 30, running_inches_override: 90 }, 'Wood Table')).toBe(90);
  });
});

describe('auto labor estimate', () => {
  it('wood: budget = RI × ₹/RI × % wood, hours = budget ÷ finishing rate', () => {
    const r = autoLaborEstimate({ product: { width_inch: 49, depth_inch: 14, height_inch: 55, finishing_difficulty: 'Medium', percent_wood: 0.5 }, productType: wood, difficulties, employees });
    expect(r.finishingMethod).toBe('ri_budget');
    expect(r.finishingBudgetInr).toBeCloseTo(69 * 7 * 0.5, 9);
    expect(r.finishingMh).toBeCloseTo((69 * 7 * 0.5) / 100, 9);
    expect(r.packagingMh).toBeCloseTo(69 * 0.015, 9);
  });
  it('falls back to the default ₹/RI when a difficulty has none', () => {
    const r = autoLaborEstimate({ product: { width_inch: 72, depth_inch: 36, height_inch: 30, finishing_difficulty: 'Hard' }, productType: table, difficulties, employees });
    expect(r.ri).toBe(72);
    expect(r.rupeesPerRi).toBe(8);
    expect(r.finishingMh).toBeCloseTo((72 * 8) / 100, 9);
  });
  it('non-wood gets no auto finishing hours; no packaging means no packaging labor', () => {
    const r = autoLaborEstimate({ product: { width_inch: 20, depth_inch: 10, height_inch: 30, finishing_difficulty: 'Easy', packaging_type: 'no_packaging' }, productType: iron, difficulties, employees });
    expect(r.finishingMethod).toBe('none');
    expect(r.finishingMh).toBe(0);
    expect(r.packagingMh).toBe(0);
  });
});
