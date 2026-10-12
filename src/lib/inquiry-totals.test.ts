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

  it('leaves out archived products', () => {
    const t = sumInquiryTotals(
      [{ id: 'a', quantity: 1 }, { id: 'b', quantity: 1, archived_at: '2026-10-01' }],
      { a: live(10, 5), b: live(1000, 1) },
    );
    expect(t.revenueUsd).toBe(10);
    expect(t.productCount).toBe(1);
  });
});
