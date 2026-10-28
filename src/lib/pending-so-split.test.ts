import { describe, expect, it } from 'vitest';
import { splitPendingSos, type CashItem } from './master-analytics';

const so = (over: Partial<CashItem> = {}): CashItem => ({
  kind: 'so', ref: 'S00126', partner: 'DKT', date: '2026-12-10', sign: 1, amount_inr: 1_710_000, amount_usd: 17_100, ...over,
});
const opts = { today: '2026-10-28', pvEntityId: 'pv', defaults: { custDeposit: 0.3, ieDeposit: 0.8 }, projBySo: {} as Record<string, any> };

describe('splitPendingSos', () => {
  it('splits an unlinked SO with the Settings customer deposit: deposit now, balance at delivery', () => {
    const [d, b] = splitPendingSos([so()], opts);
    expect(d).toMatchObject({ kind: 'so_deposit', so_part: 'deposit', date: '2026-10-28', ref: 'S00126 · deposit 30%' });
    expect(d.amount_usd).toBeCloseTo(5_130);
    expect(b).toMatchObject({ kind: 'so', so_part: 'balance', date: '2026-12-10' });
    expect(b.amount_usd).toBeCloseTo(11_970);
  });

  it("uses the linked inquiry's DKT→PV advance when another entity sells", () => {
    const projBySo = { S00126: { selling_entity_id: 'dkt', ie_deposit_pct: 50 } };
    const [d, b] = splitPendingSos([so()], { ...opts, projBySo });
    expect(d.amount_usd).toBeCloseTo(8_550);
    expect(b.amount_usd).toBeCloseTo(8_550);
  });

  it('takes money already received off the deposit first, then the balance', () => {
    // $2,000 matched by PO number: gross 17,100, net 15,100 left.
    const [d, b] = splitPendingSos([so({ amount_inr: 1_510_000, amount_usd: 15_100, gross_inr: 1_710_000, gross_usd: 17_100, advance_applied_inr: 200_000, paid_by_ref_inr: 200_000 })], opts);
    expect(d.amount_usd).toBeCloseTo(3_130);
    expect(d.advance_applied_inr).toBe(200_000);
    expect(b.amount_usd).toBeCloseTo(11_970);
    expect(b.advance_applied_inr).toBeUndefined();

    const [d2, b2] = splitPendingSos([so({ amount_inr: 710_000, amount_usd: 7_100, gross_inr: 1_710_000, gross_usd: 17_100, advance_applied_inr: 1_000_000 })], opts);
    expect(d2).toMatchObject({ amount_usd: 0, advance_covered: true });
    expect(b2.amount_usd).toBeCloseTo(7_100);
  });

  it('keeps a fully covered SO visible at zero, and leaves other items alone', () => {
    const po: CashItem = { kind: 'po', ref: 'P1', partner: 'V', date: '2026-11-01', sign: -1, amount_inr: 10, amount_usd: 1 };
    const out = splitPendingSos([so({ amount_inr: 0, amount_usd: 0, advance_applied_inr: 1_710_000, advance_covered: true }), po], opts);
    expect(out).toHaveLength(3);
    expect(out[0].amount_inr + out[1].amount_inr).toBe(0);
    expect(out[2]).toBe(po);
  });

  it('does not split when the deposit is 0%', () => {
    const out = splitPendingSos([so()], { ...opts, projBySo: { S00126: { cust_deposit_pct: 0 } } });
    expect(out).toHaveLength(1);
  });
});
