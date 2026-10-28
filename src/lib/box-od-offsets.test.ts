import { describe, expect, it } from 'vitest';
import { boxPly, getBoxOdOffsets, productMasterCartonPlan } from './calculations';

// Box prices as they stand: no row is named plain "5 ply", and the plain "7 ply" rows have zero offsets.
const boxData = [
  { box_type: '3 ply', od_length_add_in: 0.125, od_width_add_in: 0.125, od_height_add_in: 0.125 },
  { box_type: '5 Ply Premium with Print', od_length_add_in: 0.25, od_width_add_in: 0.25, od_height_add_in: 0.75 },
  { box_type: '5 ply with print', od_length_add_in: 0.25, od_width_add_in: 0.25, od_height_add_in: 0.75 },
  { box_type: '7 ply', od_length_add_in: 0, od_width_add_in: 0, od_height_add_in: 0 },
  { box_type: '7 ply H1V1', od_length_add_in: 0.375, od_width_add_in: 0.375, od_height_add_in: 1.25 },
  { box_type: 'Kappa Board with print', od_length_add_in: 0.5, od_width_add_in: 0.5, od_height_add_in: 1.75 },
];

describe('getBoxOdOffsets', () => {
  it('reads the ply count from the board name', () => {
    expect(boxPly('5 Ply Premium with Print')).toBe(5);
    expect(boxPly('7ply')).toBe(7);
    expect(boxPly('Kappa Board')).toBeNull();
  });

  it('uses the exact board when it has offsets', () => {
    expect(getBoxOdOffsets(boxData, '3 ply')).toEqual({ lAdd: 0.125, wAdd: 0.125, hAdd: 0.125 });
    expect(getBoxOdOffsets(boxData, 'Kappa Board with print')).toEqual({ lAdd: 0.5, wAdd: 0.5, hAdd: 1.75 });
  });

  it('falls back to boards of the same ply when the name has no rows', () => {
    expect(getBoxOdOffsets(boxData, '5 ply')).toEqual({ lAdd: 0.25, wAdd: 0.25, hAdd: 0.75 });
  });

  it('skips rows with zero offsets', () => {
    expect(getBoxOdOffsets(boxData, '7 ply')).toEqual({ lAdd: 0.375, wAdd: 0.375, hAdd: 1.25 });
  });

  it('uses the standard thickness when no board of that ply has offsets', () => {
    expect(getBoxOdOffsets([], '5 ply')).toEqual({ lAdd: 0.25, wAdd: 0.25, hAdd: 0.75 });
    expect(getBoxOdOffsets([], 'Mystery board')).toEqual({ lAdd: 0, wAdd: 0, hAdd: 0 });
  });
});

describe('master carton plan', () => {
  it('packs the inner carton by its outside size', () => {
    const plan = productMasterCartonPlan({
      product: { width_inch: 22, depth_inch: 10, height_inch: 3, weight_kg: 1, quantity: 100 },
      cbmRow: { ic_type: '5 ply', ic_width: 23.17, ic_depth: 10.76, ic_height: 3.95, mc_weight_limit_kg: 100 },
      boxData, productType: null, globalSettings: {},
    });
    expect(plan.icOd.w).toBeCloseTo(23.42);
    expect(plan.icOd.d).toBeCloseTo(11.01);
    expect(plan.icOd.h).toBeCloseTo(4.7);
    // Upright, 22.5" of room ÷ 4.70" is only 4 high, so laying it on its side (5 along D × 2 high) wins.
    expect(plan.orientation).toBe('on its side');
    expect(plan.along).toEqual({ w: 1, d: 5, h: 2 });
    expect(plan.mc.depth).toBeCloseTo(4.7 * 5 + 1);
  });
});
