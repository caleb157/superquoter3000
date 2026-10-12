import { describe, expect, it } from 'vitest';
import { DEFAULT_QUOTE_CLAUSES, buildQuoteClauses, diffQuoteTerms, effectiveQuoteClauses, paymentTermsFromProjection } from './quote-terms';

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

describe('diffQuoteTerms', () => {
  const a = { key: 'a', title: 'Validity', text: '30 days' };
  const b = { key: 'b', title: 'Lead time', text: '60 days' };
  const c = { key: 'c', title: 'Warranty', text: '1 year' };
  it('lists added, removed, renamed and edited clauses', () => {
    expect(diffQuoteTerms([a, b], [a, c])).toEqual(['Added "Warranty"', 'Removed "Lead time"']);
    expect(diffQuoteTerms([a, b], [{ ...a, title: 'Price validity' }, { ...b, text: '45 days' }]))
      .toEqual(['Renamed "Validity" to "Price validity"', 'Changed the text of "Lead time"']);
  });
  it('notices a reorder and nothing else when only the order moved', () => {
    expect(diffQuoteTerms([a, b], [b, a])).toEqual(['Changed the order']);
    expect(diffQuoteTerms([a, b, c], [a, c])).toEqual(['Removed "Lead time"']);
  });
  it('is empty when nothing changed', () => {
    expect(diffQuoteTerms([a, b], [{ ...a }, { ...b }])).toEqual([]);
  });
  it('treats an empty entity list as the defaults', () => {
    expect(effectiveQuoteClauses(null)).toBe(DEFAULT_QUOTE_CLAUSES);
    expect(effectiveQuoteClauses([a])).toEqual([a]);
  });
});
