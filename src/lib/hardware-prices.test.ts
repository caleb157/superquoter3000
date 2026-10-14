import { describe, it, expect } from 'vitest';
import { mergeHardwarePrices } from './hardware-prices';

describe('hardware price library', () => {
  it('reads active INR hardware rows from materials and adds old rows not moved yet', () => {
    const materials = [
      { id: 'm1', name: 'Brass knob', cost: 40, unit_type: 'pc', currency: 'INR', category: 'Handles + Knobs', active: true },
      { id: 'm2', name: 'Iron sheet', cost: 90, unit_type: 'kg', currency: 'INR', category: 'Raw Piece', active: true },
      { id: 'm3', name: 'Old hinge', cost: 5, unit_type: 'pc', currency: 'INR', category: 'Other Hardware', active: false },
    ];
    const legacy = [
      { id: 'h1', name: 'brass knob ', unit_cost_inr: 35, units: 'pc' },
      { id: 'h2', name: 'Felt pad', unit_cost_inr: 2, units: null },
    ];
    expect(mergeHardwarePrices(materials, legacy)).toEqual([
      { id: 'm1', name: 'Brass knob', unit_cost_inr: 40, units: 'pc', source: 'materials' },
      { id: 'h2', name: 'Felt pad', unit_cost_inr: 2, units: 'pc', source: 'legacy' },
    ]);
  });
});
