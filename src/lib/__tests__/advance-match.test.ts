import { describe, it, expect } from 'vitest';
import { applyRefPayments, waterfallRemainder, poRefTokens, soRefTokens, type MatchItem } from '../../../supabase/functions/_shared/advance-match';

const so = (ref: string, date: string, amt: number, custRef = ''): MatchItem =>
  ({ ref, partner_id: 1, date, amount_inr: amt, amount_usd: amt / 100, tokens: [...soRefTokens(ref), ...poRefTokens(custRef)] });
const custTokens = (t: string) => [...soRefTokens(t), ...poRefTokens(t)];

describe('advance matching', () => {
  it('applies a payment naming an SO to that SO, not the oldest', () => {
    const items = [so('S00120', '2026-12-01', 500000), so('S00135', '2027-01-23', 400000)];
    const left = applyRefPayments(items, [{ partner_id: 1, inr: 251940, name: 'PBNK', text: 'S00135 Boxes PO1094 RTGS' }], custTokens);
    expect(items[1].amount_inr).toBe(400000 - 251940);
    expect(items[0].amount_inr).toBe(500000);
    expect(left.get(1) ?? 0).toBe(0);
  });
  it('matches a vendor PO number in a bank description', () => {
    const items: MatchItem[] = [
      { ref: 'P01100', partner_id: 7, date: '2026-11-01', amount_inr: 100000, amount_usd: 0, tokens: poRefTokens('P01100') },
      { ref: 'P01122', partner_id: 7, date: '2026-12-01', amount_inr: 100000, amount_usd: 0, tokens: poRefTokens('P01122') },
    ];
    applyRefPayments(items, [{ partner_id: 7, inr: 61500, name: 'BNK', text: 'NEFT DR-ICIC0007854-WOODEN ART-P01122' }], poRefTokens);
    expect(items[1].amount_inr).toBe(38500);
    expect(items[0].amount_inr).toBe(100000);
  });
  it('waterfalls an unreferenced advance to the oldest open order', () => {
    const items = [so('S00135', '2027-01-23', 400000), so('S00120', '2026-12-01', 500000)];
    const left = applyRefPayments(items, [{ partner_id: 1, inr: 30000, name: 'BNK', text: 'ADVANCE' }], custTokens);
    waterfallRemainder(items, pid => left.get(pid) ?? 0);
    expect(items[1].amount_inr).toBe(470000);
    expect(items[0].amount_inr).toBe(400000);
  });
  it('ignores RBI purpose code P0103', () => {
    expect(poRefTokens('S00126 UTC P00038 P0103')).toEqual(['P38']);
  });
});
