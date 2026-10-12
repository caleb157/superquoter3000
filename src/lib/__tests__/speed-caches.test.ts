import { afterEach, describe, expect, it, vi } from 'vitest';

const updates: any[] = [];
let updateError: any = null;
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ update: (v: any) => ({ eq: () => { updates.push(v); return Promise.resolve({ error: updateError }); } }) }) },
}));

import { getLiveCosts, invalidateLiveCosts, noteRouteForLiveCosts, setLiveCosts } from '@/lib/live-cost-cache';
import { mhChanged, resetStoredMhState, saveStoredMh, withStoredMh } from '@/lib/stored-man-hours';

describe('live cost cache', () => {
  afterEach(() => { invalidateLiveCosts(); vi.useRealTimers(); });

  it('drops only the inquiry being opened', () => {
    setLiveCosts('inquiry-totals', { i1: 1, i2: 2 }, id => id);
    noteRouteForLiveCosts('/inquiry/i1/costing');
    expect(getLiveCosts('inquiry-totals', ['i1', 'i2'])).toEqual({ i2: 2 });
  });

  it('drops everything when a product or Settings is opened', () => {
    setLiveCosts('product-costs', { p1: 1 }, () => 'i1');
    noteRouteForLiveCosts('/tasks');
    expect(getLiveCosts('product-costs', ['p1'])).toEqual({ p1: 1 });
    noteRouteForLiveCosts('/product/p9');
    expect(getLiveCosts('product-costs', ['p1'])).toEqual({});
  });

  it('expires entries after ten minutes', () => {
    vi.useFakeTimers();
    setLiveCosts('inquiry-totals', { i1: 1 }, id => id);
    vi.advanceTimersByTime(11 * 60_000);
    expect(getLiveCosts('inquiry-totals', ['i1'])).toEqual({});
  });
});

describe('stored man-hours', () => {
  afterEach(() => { resetStoredMhState(); updates.length = 0; updateError = null; });

  it('reads without the column until the SQL has been run', async () => {
    const asked: string[] = [];
    const rows = await withStoredMh('id', async (cols) => {
      asked.push(cols);
      if (cols.includes('calculated_man_hours_per_unit')) throw new Error('column products.calculated_man_hours_per_unit does not exist');
      return ['ok'];
    });
    expect(rows).toEqual(['ok']);
    expect(asked).toEqual(['id, calculated_man_hours_per_unit', 'id']);
    // Writes stop after the first "column missing" answer.
    updateError = { message: 'Could not find the calculated_man_hours_per_unit column' };
    await saveStoredMh([{ id: 'a', manHours: 1 }, { id: 'b', manHours: 2 }]);
    expect(updates).toEqual([]);
  });

  it('saves rounded man-hours and spots real changes only', async () => {
    await saveStoredMh([{ id: 'a', manHours: 1.234567 }]);
    expect(updates).toEqual([{ calculated_man_hours_per_unit: 1.2346 }]);
    expect(mhChanged(null, 1)).toBe(true);
    expect(mhChanged(1.2346, 1.234567)).toBe(false);
    expect(mhChanged(1.2, 1.3)).toBe(true);
  });
});
