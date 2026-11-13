import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { roundQuotePrice } from '@/lib/quote-rough';

describe('quote price rounding', () => {
  it('whole rupees for INR, nearest 5 cents for USD, two decimals otherwise', () => {
    expect(roundQuotePrice(949.7, 'INR')).toBe(950);
    expect(roundQuotePrice(1902.49, 'INR')).toBe(1902);
    expect(roundQuotePrice(12.37, 'USD')).toBe(12.35);
    expect(roundQuotePrice(12.38, 'USD')).toBe(12.4);
    expect(roundQuotePrice(20, 'USD')).toBe(20);
    expect(roundQuotePrice(11.236, 'EUR')).toBe(11.24);
    expect(roundQuotePrice(0, 'USD')).toBe(0);
  });
});
