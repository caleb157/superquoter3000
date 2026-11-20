import { describe, it, expect } from 'vitest';
import { monthCapacityHours, budgetPace } from '../master-analytics';

describe('capacity top-up', () => {
  const weeks = ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'].map(week => ({ week }));
  it('tops a partial January up to a full month at 172.8 h/week', () => {
    // LaborTrax reports 57.6 h (Jan 1–2); Jan 4–31 has 24 working days × 28.8 h.
    expect(monthCapacityHours('2027-01', '2026-11-13', { '2027-01': 57.6 }, 172.8, weeks)).toBeCloseTo(748.8, 1);
  });
  it('leaves a fully reported month alone', () => {
    expect(monthCapacityHours('2026-12', '2026-11-13', { '2026-12': 748.8 }, 172.8, weeks)).toBeCloseTo(748.8, 1);
  });
});

describe('budget pacing', () => {
  it('flags AF&L (₹1.10 L spent vs ₹3.81 L pace) on track', () => expect(budgetPace({ budget: 429000, achieved: 109989.55, theoretical: 380810.96 })).toBe('under'));
  it('flags Op Exp past its ₹4.88 L budget', () => expect(budgetPace({ budget: 488130, achieved: 630024.64, theoretical: 433298.96 })).toBe('over_budget'));
  it('flags spend with no budget as unbudgeted', () => expect(budgetPace({ budget: 0, achieved: 9500, theoretical: 0 })).toBe('unbudgeted'));
});
