import { describe, expect, it } from 'vitest';
import { buildQuoteClauses, paymentTermsFromProjection } from './quote-terms';

describe('paymentTermsFromProjection', () => {
  it('writes deposit and balance', () => {
    expect(paymentTermsFromProjection({ cust_deposit_pct: 0.3, cust_final_pct: 0.7 })).toBe('30% deposit, 70% before shipment');
  });
  it('includes an interim payment', () => {
    expect(paymentTermsFromProjection({ cust_deposit_pct: 0.3, cust_other_pct: 0.2, cust_final_pct: 0.5 }))
      .toBe('30% deposit, 20% during production, 50% before shipment');
  });
  it('derives the balance when final is missing', () => {
    expect(paymentTermsFromProjection({ cust_deposit_pct: 0.5 })).toBe('50% deposit, 50% before shipment');
  });
  it('handles full advance and no deposit', () => {
    expect(paymentTermsFromProjection({ cust_deposit_pct: 1, cust_final_pct: 0 })).toBe('100% in advance');
    expect(paymentTermsFromProjection({ cust_deposit_pct: 0, cust_final_pct: 1 })).toBe('100% before shipment');
  });
  it('returns null without a projection', () => {
    expect(paymentTermsFromProjection(null)).toBeNull();
  });
  it('feeds the payment clause', () => {
    const pay = buildQuoteClauses(null, paymentTermsFromProjection({ cust_deposit_pct: 0.4, cust_final_pct: 0.6 })).find(c => c.key === 'payment');
    expect(pay?.text).toBe('40% deposit, 60% before shipment');
  });
});
