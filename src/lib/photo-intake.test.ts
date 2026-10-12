import { describe, it, expect } from 'vitest';
import { estimateRecord, estimateToIntakeRow, isPhotoEstimated, type ProductEstimate } from './photo-intake';

const est = (over: Partial<ProductEstimate> = {}): ProductEstimate => ({
  name: 'Mango Console', summary: 'A three-drawer console.', product_type: 'Wood Console', percent_wood: 85,
  finishing_difficulty: 'Medium', materials: 'Mango wood, iron legs', weight_kg: 22.46, raw_piece_inr: 4180.4,
  raw_piece_basis: 'Like Console 48', mh_manufacturing: 0, mh_assembly: 0.5, line_items: [], assumptions: ['Back is plywood'],
  confidence: 'medium', ...over,
});

describe('estimateToIntakeRow', () => {
  it('maps the estimate to intake inputs, converting size to inches and wood to a fraction', () => {
    const row = estimateToIntakeRow(est(), { width: 120, depth: 40, height: 80, unit: 'cm' });
    expect(row).toMatchObject({
      name: 'Mango Console', product_type: 'Wood Console', finishing_difficulty: 'Medium',
      percent_wood: 0.85, weight_kg: 22.5, raw_piece_inr: 4180, mh_manufacturing: 0, mh_assembly: 0.5,
      width_inch: 47.24, depth_inch: 15.75, height_inch: 31.5,
    });
  });

  it('prefers the name typed in and leaves blanks out', () => {
    const row = estimateToIntakeRow(est({ product_type: '', finishing_difficulty: '', mh_assembly: 0, raw_piece_inr: 0 }),
      { width: 48, depth: 16, height: 30, unit: 'in', name: '  CCT-CN48 Console ' });
    expect(row.name).toBe('CCT-CN48 Console');
    expect(row).not.toHaveProperty('product_type');
    expect(row).not.toHaveProperty('finishing_difficulty');
    expect(row).not.toHaveProperty('mh_assembly');
    expect(row).not.toHaveProperty('raw_piece_inr');
  });

  it('puts bought-in lines in named slots and rolls extras into the category total', () => {
    const row = estimateToIntakeRow(est({
      line_items: [
        { cogs_type: 'Handles + Knobs', name: 'Brass knob', qty: 3, unit_inr: 60 },
        { cogs_type: 'Handles + Knobs', name: 'Pull A', qty: 1, unit_inr: 10 },
        { cogs_type: 'Handles + Knobs', name: 'Pull B', qty: 1, unit_inr: 10 },
        { cogs_type: 'Handles + Knobs', name: 'Pull C', qty: 2, unit_inr: 15 },
        { cogs_type: 'Subcontracting', name: 'Iron legs', qty: 1, unit_inr: 900 },
        { cogs_type: 'Feet/Buffers', name: 'Glide', qty: 4, unit_inr: 0 },
      ],
    }), { width: 48, depth: 16, height: 30, unit: 'in' });
    expect(row).toMatchObject({ handle1_name: 'Brass knob', handle1_qty: 3, handle1_inr: 60, handle3_name: 'Pull B' });
    expect(row.handles_knobs_inr).toBe(30);
    expect(row.subcontract_inr).toBe(900);
    expect(row).not.toHaveProperty('feet1_name');
  });
});

describe('estimate record', () => {
  it('is estimated until checked', () => {
    const rec = estimateRecord(est(), { width: 1, depth: 2, height: 3, unit: 'in', notes: ' teak ' }, new Date('2026-10-12T00:00:00Z'));
    expect(rec).toMatchObject({ confidence: 'medium', estimated_at: '2026-10-12T00:00:00.000Z', checked_at: null, inputs: { notes: 'teak' } });
    expect(isPhotoEstimated({ photo_estimate: rec })).toBe(true);
    expect(isPhotoEstimated({ photo_estimate: { ...rec, checked_at: '2026-10-13T00:00:00Z' } })).toBe(false);
    expect(isPhotoEstimated({ photo_estimate: null })).toBe(false);
  });
});
