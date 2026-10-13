import { afterEach, describe, expect, it, vi } from 'vitest';

const engineCalls: string[][] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q,
        range: () => Promise.resolve({ data: [{ id: 'p1' }, { id: 'p2' }], error: null }),
      };
      return q;
    },
  },
}));
vi.mock('@/lib/product-pricing', () => ({
  computeProductPriceAndCost: async (ids: string[]) => {
    engineCalls.push(ids);
    return Object.fromEntries(ids.map((id) => [id, { unit_price_usd: engineCalls.length }]));
  },
}));

import { computeInquiryPriceAndCost, resetInquiryPricing } from '@/lib/inquiry-pricing';

describe('shared inquiry pricing', () => {
  afterEach(() => { resetInquiryPricing(); engineCalls.length = 0; vi.useRealTimers(); });

  it('runs the engine once for cards that load together', async () => {
    const since = Date.now();
    const [a, b, c] = await Promise.all([
      computeInquiryPriceAndCost('i1', since),
      computeInquiryPriceAndCost('i1', since),
      computeInquiryPriceAndCost('i1', since),
    ]);
    expect(engineCalls).toEqual([['p1', 'p2']]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('runs again for a reload that starts after the last run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    await computeInquiryPriceAndCost('i1', Date.now());
    vi.setSystemTime(2_000);
    const fresh = await computeInquiryPriceAndCost('i1', Date.now());
    expect(engineCalls).toHaveLength(2);
    expect(fresh.p1.unit_price_usd).toBe(2);
  });

  it('keeps inquiries apart', async () => {
    const since = Date.now();
    await Promise.all([computeInquiryPriceAndCost('i1', since), computeInquiryPriceAndCost('i2', since)]);
    expect(engineCalls).toHaveLength(2);
  });
});
