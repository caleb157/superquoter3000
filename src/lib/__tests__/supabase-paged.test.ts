import { describe, expect, it } from 'vitest';
import { fetchAllRows } from '@/lib/supabase-paged';

/** A fake table of `n` rows; records each requested range and how many ran at once. */
function table(n: number, failFrom?: number) {
  const rows = Array.from({ length: n }, (_, i) => i);
  const ranges: number[] = [];
  let running = 0, peak = 0;
  const make = () => ({
    range: async (from: number, to: number) => {
      ranges.push(from);
      peak = Math.max(peak, ++running);
      await new Promise(r => setTimeout(r, 1));
      running--;
      if (failFrom != null && from >= failFrom) return { data: null, error: new Error('boom') };
      return { data: rows.slice(from, to + 1), error: null };
    },
  });
  return { make, rows, ranges, peak: () => peak };
}

describe('fetchAllRows', () => {
  it('asks once when everything fits in the first page', async () => {
    const t = table(999);
    expect(await fetchAllRows(t.make)).toEqual(t.rows);
    expect(t.ranges).toEqual([0]);
  });

  it('returns every row in order, later pages together', async () => {
    const t = table(6500);
    expect(await fetchAllRows(t.make)).toEqual(t.rows);
    expect(t.ranges.sort((a, b) => a - b)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
    expect(t.peak()).toBe(4);
  });

  it('handles a table that ends exactly on a page boundary', async () => {
    const t = table(2000);
    expect(await fetchAllRows(t.make)).toEqual(t.rows);
  });

  it('throws when any page fails', async () => {
    await expect(fetchAllRows(table(5000, 2000).make)).rejects.toThrow('boom');
  });
});
