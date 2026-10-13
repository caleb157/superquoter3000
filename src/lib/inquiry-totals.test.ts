import { describe, it, expect, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { sumInquiryTotals } from './inquiry-totals';
import type { ProductPriceCostMap } from './product-pricing';

const live = (unit_price_usd: number, unit_cost_usd: number, man_hours_per_unit = 0, final_unit_cbm = 0) =>
  ({ unit_price_usd, unit_cost_usd, man_hours_per_unit, final_unit_cbm }) as ProductPriceCostMap[string];

describe('sumInquiryTotals', () => {
  it('uses live engine prices over the stored cache', () => {
    const t = sumInquiryTotals(
      [{ id: 'a', quantity: 2, calculated_unit_price_usd: 999, calculated_unit_cost_usd: 1 }],
      { a: live(100, 80, 1.5, 0.2) },
    );
    expect(t.revenueUsd).toBe(200);
    expect(t.profitUsd).toBe(40);
    expect(t.margin).toBeCloseTo(0.2);
    expect(t.manHours).toBe(3);
    expect(t.cbm).toBeCloseTo(0.4);
  });

  it('falls back to the stored cache only when the engine has no price', () => {
    const t = sumInquiryTotals([{ id: 'a', quantity: 1, calculated_unit_price_usd: 50, calculated_unit_cost_usd: 40 }], {});
    expect(t.revenueUsd).toBe(50);
    expect(t.costUsd).toBe(40);
  });

  it('uses saved man-hours until the live run has the product', () => {
    const products = [{ id: 'a', quantity: 4, calculated_unit_price_usd: 10, calculated_unit_cost_usd: 8, calculated_man_hours_per_unit: 0.5 }];
    expect(sumInquiryTotals(products, {}).manHours).toBe(2);
    expect(sumInquiryTotals(products, { a: live(10, 8, 0.25) }).manHours).toBe(1);
  });

  it('leaves out archived products', () => {
    const t = sumInquiryTotals(
      [{ id: 'a', quantity: 1 }, { id: 'b', quantity: 1, archived_at: '2026-10-01' }],
      { a: live(10, 5), b: live(1000, 1) },
    );
    expect(t.revenueUsd).toBe(10);
    expect(t.productCount).toBe(1);
  });

  it('sums engine rupees for INR inquiries, converting saved USD only at a live rate', () => {
    const inr = (usdPrice: number, usdCost: number, fx: number) =>
      ({ unit_price_usd: usdPrice, unit_cost_usd: usdCost, unit_price_inr: usdPrice * fx + 0.3, unit_cost_inr: usdCost * fx, exchange_rate: fx, man_hours_per_unit: 0, final_unit_cbm: 0 }) as ProductPriceCostMap[string];
    const t = sumInquiryTotals(
      [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1, calculated_unit_price_usd: 10, calculated_unit_cost_usd: 8 }],
      { a: inr(10, 8, 90) },
    );
    expect(t.revenueInr).toBeCloseTo(2 * 900.3 + 900, 6);
    expect(t.profitInr).toBeCloseTo(2 * (900.3 - 720) + 180, 6);
    // Before the live run there is no rate, so rupees are unknown rather than wrong.
    expect(sumInquiryTotals([{ id: 'b', quantity: 1, calculated_unit_price_usd: 10, calculated_unit_cost_usd: 8 }], {}).revenueInr).toBeNull();
  });
});
