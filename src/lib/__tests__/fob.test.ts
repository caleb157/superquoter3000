import { describe, it, expect } from 'vitest';
import { computeFob, computeLcl } from '@/lib/fob';

const fx = 96.68;

describe('FOB calculator', () => {
  it('LCL 21.5 CBM / 250 cartons', () => {
    const o = computeLcl(21.5, 250, fx);
    expect(o.total_inr).toBeCloseTo(60317.6, 1);
    expect(o.per_cbm_inr).toBeCloseTo(2805.47, 1);
  });
  it('LCL minimums apply', () => {
    const o = computeLcl(2, 17, fx);
    expect(o.lines.find(l => l.label === 'Measurement')!.amount_inr).toBe(250);
    expect(o.lines.find(l => l.label === 'Sorting')!.amount_inr).toBe(300);
  });
  it('AUTO 64.31 CBM picks 40HC', () => {
    const e = computeFob('FOB_AUTO', 64.31, 543, fx);
    expect(e.selected.mode).toBe('FCL_40HC');
    expect(e.selected.total_inr).toBeCloseTo(129344.4, 1);
    expect(e.options[0].total_inr).toBeCloseTo(147402.6, 1);
  });
  it('AUTO 100 CBM uses 2×40HC', () => {
    const e = computeFob('FOB_AUTO', 100, 800, fx);
    expect(e.options.find(o => o.mode === 'FCL_40HC')!.containers).toBe(2);
  });
  it('pool allocation by volume sums to pool total', () => {
    const e = computeFob('FOB_AUTO', 64.31, 543, fx);
    const perCbm = e.selected.total_inr / 64.31;
    expect(perCbm).toBeCloseTo(2011.27, 1);
    expect(perCbm * 0.0176).toBeCloseTo(35.4, 1);
    // same product alone: 7.04 CBM / 50 cartons LCL
    expect(computeLcl(7.04, 50, fx).total_inr / 400).toBeCloseTo(76.74, 1);
  });
});
