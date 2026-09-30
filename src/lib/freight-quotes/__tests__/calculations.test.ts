import { describe, it, expect } from 'vitest';
import { computeQuote, chargeableWm, type FqLineInput } from '@/lib/freight-quotes/calculations';

const q = { cbm: 7.8, gross_weight_kg: 2225, wm_kg_per_cbm: 1000, fx_snapshot: { USD: 1, INR: 1 / 95, AUD: 0.65 } };
const L = (bucket: string, charge_basis: string, rate: number | null, currency: string, extra: Partial<FqLineInput> = {}): FqLineInput =>
  ({ bucket, charge_basis, rate, currency, ...extra });

const lines: FqLineInput[] = [
  L('OCEAN_FREIGHT', 'per_cbm', 60, 'USD'),
  L('FOB_ORIGIN', 'per_cbm', 4000, 'INR'),
  L('FOB_ORIGIN', 'flat', 500, 'INR'),
  L('FOB_ORIGIN', 'per_bl', 6500, 'INR'),
  L('FOB_ORIGIN', 'flat', 6500, 'INR'),
  L('FOB_ORIGIN', 'flat', 14500, 'INR'),
  L('FOB_ORIGIN', 'at_actuals', null, 'INR', { user_estimate: 11000 }),
  L('DEST_PORT', 'per_wm', 45, 'USD'),
  L('DEST_PORT', 'flat', 60, 'USD'),
  L('CUSTOMS_IMPORT', 'flat', 125, 'USD'),
  L('DOOR_DELIVERY', 'flat', 318, 'USD'),
  L('DOOR_DELIVERY', 'flat', 80, 'USD', { is_optional: true }),
  L('DEST_PORT', 'per_wm', 206.4, 'AUD'),
  L('DEST_PORT', 'per_bl', 145, 'AUD'),
  L('DEST_PORT', 'per_bl', 300, 'AUD', { applicable: false }),
  L('DEST_PORT', 'per_cbm', 30, 'USD', { applicable: false }),
];

describe('Freight quote acceptance test (Australia LCL)', () => {
  const t = computeQuote(q, lines);
  it('chargeable W/M', () => expect(chargeableWm(7.8, 2225, 1000)).toBeCloseTo(7.8, 6));
  it('FOB = INR 70,200 ≈ USD 739', () => { expect(t.fob_inr).toBeCloseTo(70200, 2); expect(t.fob_usd).toBeCloseTo(738.95, 1); });
  it('ocean freight USD 468', () => expect(t.ocean_usd).toBeCloseTo(468, 6));
  it('everything else ≈ USD 2,543', () => expect(t.everything_else_usd).toBeCloseTo(2542.7, 0));
  it('total ≈ USD 3,282 and ≈ USD 421/CBM', () => { expect(t.ddp_usd).toBeCloseTo(3281.65, 0); expect(t.per_cbm.ddp!).toBeCloseTo(420.7, 0); });
  it('duty warning + excluded lines', () => {
    expect(t.duty_missing).toBe(true);
    expect(t.lines[14].status).toBe('not_applicable');
    expect(t.lines[14].amount_usd).toBeCloseTo(195, 6);
  });
  it('unpriced at-actuals are excluded', () => {
    const u = computeQuote(q, [L('FOB_ORIGIN', 'at_actuals', null, 'INR')]);
    expect(u.unpriced_count).toBe(1); expect(u.fob_usd).toBe(0);
  });
  it('minimum amount applies', () => {
    expect(computeQuote(q, [L('OTHER', 'per_cbm', 1, 'USD', { minimum_amount: 50 })]).ddp_usd).toBe(50);
  });
});
