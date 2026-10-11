// Known-value checks for the iron weight core (src/lib/iron-weight-core.ts). The reference
// figures are mild-steel (7850 kg/m³) handbook values; the app itself uses wrought iron, 7750.
import { describe, expect, it } from 'vitest';
import { DENSITY_WROUGHT_IRON, grandTotal, partWeight, type LegType, type Part } from '@/lib/iron-weight-core';

const STEEL = 7850;
const part = (shape: Part['shape'], dims: Record<string, number>, length = 1000, count = 1, name = 'p'): Part =>
  ({ name, shape, dims, dimUnit: 'mm', length, lengthUnit: 'mm', count });

const tube = (len: number, count: number, name: string) => part('rect_tube', { w: 60, h: 40, t: 3 }, len, count, name);
const EXAMPLE: LegType[] = [
  { name: 'U-frame leg', qty: 2, parts: [tube(700, 2, 'Uprights'), tube(680, 1, 'Foot'), tube(720, 1, 'Top rail')] },
  { name: 'Solid bar leg', qty: 4, parts: [part('square_bar', { a: 40 }, 710, 1, 'Bar')] },
];

describe('iron weight core', () => {
  it('round bar Ø20 mm is 2.466 kg/m', () => {
    const r = partWeight(part('round_bar', { d: 20 }), STEEL);
    expect(r.ok && +r.kgPerMetre.toFixed(3)).toBe(2.466);
  });

  it('round pipe OD 60 × 3 mm wall is 4.217 kg/m', () => {
    const r = partWeight(part('round_pipe', { od: 60, t: 3 }), STEEL);
    expect(r.ok && +r.kgPerMetre.toFixed(3)).toBe(4.217);
  });

  it('example build at ₹135/kg is 60.46 kg and ₹8,163', () => {
    const r = grandTotal(EXAMPLE, { density: STEEL, pricePerKg: 135 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(+r.totalKg.toFixed(2)).toBe(60.46);
    expect(Math.round(r.totalCost!)).toBe(8163);
    expect(r.totalLegs).toBe(6);
  });

  it('the app density is wrought iron, 7750 kg/m³, and is the default', () => {
    expect(DENSITY_WROUGHT_IRON).toBe(7750);
    const def = grandTotal(EXAMPLE, { pricePerKg: 135 });
    const wi = grandTotal(EXAMPLE, { density: 7750, pricePerKg: 135 });
    expect(def.ok && wi.ok && def.totalKg).toBe(wi.ok && wi.totalKg);
    expect(def.ok && +(def.totalKg).toFixed(2)).toBeCloseTo(60.46 * 7750 / 7850, 1);
  });

  it('rejects impossible walls and bad counts with a readable message', () => {
    const wall = partWeight(part('round_pipe', { od: 20, t: 10 }));
    expect(wall.ok ? '' : wall.error).toBe('Wall thickness must be less than half the outer diameter.');
    const cnt = partWeight({ ...part('round_bar', { d: 10 }), count: 1.5 });
    expect(cnt.ok).toBe(false);
    expect(grandTotal([{ name: 'X', qty: 0, parts: [part('round_bar', { d: 10 })] }]).ok).toBe(false);
  });

  it('hides cost when there is no price', () => {
    const r = grandTotal(EXAMPLE, { pricePerKg: 0 });
    expect(r.ok && r.totalCost).toBeUndefined();
  });
});
