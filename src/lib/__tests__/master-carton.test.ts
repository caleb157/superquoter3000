import { describe, it, expect } from 'vitest';
import { planMasterCarton, productMasterCartonPlan, computePackagedUnitCbm } from '@/lib/calculations';

const base = {
  max: { w: 25, d: 25, h: 25 }, wdBuffer: 1, hBuffer: 2.5,
  weightLimitKg: 20, emptyWeightKg: 1.5, productWeightKg: 0, quantity: 300, productsPerIc: 1,
};

describe('planMasterCarton', () => {
  it('13.13 × 10.63 × 4 in a 25" carton: 10 upright, 12 on its side', () => {
    const p = planMasterCarton({ ...base, icOd: { w: 13.13, d: 10.63, h: 4 } });
    expect(p.usable).toEqual({ w: 24, d: 24, h: 22.5 });
    expect(p.orientation).toBe('on its side');
    expect(p.placed).toEqual({ w: 13.13, d: 4, h: 10.63 });
    expect(p.along).toEqual({ w: 1, d: 6, h: 2 });
    expect(p.pieces).toBe(12);
    expect(p.limit).toBe('size');
    expect(planMasterCarton({ ...base, icOd: { w: 13.13, d: 10.63, h: 4 }, manualLayout: { w: 1, d: 2, h: 5 } }).pieces).toBe(10);
  });

  it('12 × 10 × 6: 12 upright, 16 on its side', () => {
    const p = planMasterCarton({ ...base, icOd: { w: 12, d: 10, h: 6 } });
    expect(p.orientation).toBe('on its side');
    expect(p.pieces).toBe(16);
  });

  it('two 12.5" cartons do not fit across 24" of usable room', () => {
    const p = planMasterCarton({ ...base, icOd: { w: 12.5, d: 12.5, h: 5.5 } });
    expect(p.along).toEqual({ w: 1, d: 1, h: 4 });
    expect(p.orientation).toBe('upright'); // on its side also holds 4, so it stays upright
    expect(planMasterCarton({ ...base, wdBuffer: 0, icOd: { w: 12.5, d: 12.5, h: 5.5 } }).pieces).toBe(16);
  });

  it('lays a carton too tall to stand down instead of overflowing the carton', () => {
    // 23" tall does not fit under 22.5"; on its side it is 1 × 4 × 2.
    const p = planMasterCarton({ ...base, icOd: { w: 11, d: 6, h: 23 } });
    expect(p.icFits).toBe(true);
    expect(p.orientation).toBe('on its side');
    expect(p.pieces).toBe(8);
    expect(planMasterCarton({ ...base, icOd: { w: 30, d: 30, h: 30 } }).icFits).toBe(false);
  });

  it('caps at the order quantity and the weight limit', () => {
    expect(planMasterCarton({ ...base, quantity: 3, icOd: { w: 5, d: 5, h: 5 } }).pieces).toBe(3);
    const w = planMasterCarton({ ...base, productWeightKg: 4, icOd: { w: 5, d: 5, h: 5 } });
    expect(w.pieces).toBe(4);
    expect(w.limit).toBe('weight');
  });

  it('a typed override replaces the count but keeps the calculated carton', () => {
    const auto = planMasterCarton({ ...base, icOd: { w: 12.5, d: 12.5, h: 5.5 } });
    const p = planMasterCarton({ ...base, icOd: { w: 12.5, d: 12.5, h: 5.5 }, override: 16 });
    expect(p.autoPieces).toBe(4);
    expect(p.pieces).toBe(16);
    expect(p.override).toBe(16);
    expect(p.mc).toEqual(auto.mc);
  });

  it('a hand layout sets the carton size', () => {
    const p = planMasterCarton({ ...base, icOd: { w: 10, d: 10, h: 10 }, manualLayout: { w: 2, d: 1, h: 1 } });
    expect(p.pieces).toBe(2);
    expect(p.mc).toEqual({ width: 21, depth: 11, height: 12.5 });
    expect(p.limit).toBe('manual');
  });
});

describe('packed CBM uses the same plan', () => {
  it('unit CBM = master carton volume ÷ Pcs/MC, override included', () => {
    const product = { width_inch: 11.5, depth_inch: 11.5, height_inch: 4.5, packaging_type: 'ic_mc', quantity: 300 };
    const cbmRow = { ic_width: 12.5, ic_depth: 12.5, ic_height: 5.5, products_per_mc_override: 16 };
    const args = { product, cbmRow, boxData: [], productType: null, globalSettings: { mc_height_buffer_inch: 2.5 } };
    const plan = productMasterCartonPlan(args);
    expect(plan.pieces).toBe(16);
    // No Box prices rows, so the 7 ply board adds its standard thickness to the master carton's outside.
    const vol = ((plan.mc.width + 0.375) * (plan.mc.depth + 0.375) * (plan.mc.height + 1.25)) / 61020;
    expect(computePackagedUnitCbm(args)).toBeCloseTo(vol / 16, 8);
  });
});
