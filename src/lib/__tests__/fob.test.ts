import { describe, it, expect } from 'vitest';
import { computeFcl, computeLcl, computeFob } from '@/lib/fob';

const fx = 94;

describe('FOB calculator (Jodhpur ICD FCL + LCL)', () => {
  it('FCL 64.31 CBM → 1 × 40ft', () => {
    const o = computeFcl(64.31, fx);
    expect(o.mix).toBe('1 × 40ft');
    expect(o.total_inr).toBeCloseTo(124098.5, 2);
    expect(o.per_cbm_inr).toBeCloseTo(1929.69, 2);
  });
  it('FCL 20 CBM → 1 × 20ft', () => {
    const o = computeFcl(20, fx);
    expect(o.mix).toBe('1 × 20ft');
    expect(o.total_inr).toBeCloseTo(84023.5, 2);
  });
  it('FCL 90 CBM → 40ft + 20ft beats 2 × 40ft', () => {
    const o = computeFcl(90, fx);
    expect(o.mix).toBe('1 × 40ft + 1 × 20ft');
    expect(o.total_inr).toBeCloseTo(208122, 2);
  });
  it('FCL 64.31 CBM with ISPM', () => {
    expect(computeFcl(64.31, fx, { fumigation: 'ispm' }).total_inr).toBeCloseTo(133098.5, 2);
  });
  it('LCL 48.01 CBM / 223 cartons, with and without trucking', () => {
    // Spec figures (113,018.84 / 65,006.92) imply an unrounded pool of ~48.0119 CBM.
    expect(computeLcl(48.01192, 223, fx).total_inr).toBeCloseTo(113018.84, 1);
    expect(computeLcl(48.01192, 223, fx, false).total_inr).toBeCloseTo(65006.92, 1);
  });
  it('computeFob selects the requested type', () => {
    expect(computeFob('FOB_LCL_NO_TRUCK', 10, 50, fx).selected.mode).toBe('FOB_LCL_NO_TRUCK');
    expect(computeFob('FOB_FCL', 10, 50, fx).selected.mode).toBe('FOB_FCL');
  });
});
