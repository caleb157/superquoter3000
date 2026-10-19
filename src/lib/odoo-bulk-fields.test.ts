import { describe, expect, it } from 'vitest';
import { defaultFinished } from './odoo-bom';
import { applyOdooBulkFields } from './odoo-bulk-fields';

const original = { ...defaultFinished({ name: 'Table' }), sku: 'LUX-TABLE-STND', hsn: '94036000', taxIds: [12] };

describe('Odoo bulk fields', () => {
  it('cleared HSN and sales tax permit a prefix-only update', () => {
    const result = applyOdooBulkFields(original, 'DKT', '', null);
    expect(result.sku).toBe('DKT-TABLE-STND');
    expect(result.hsn).toBe('94036000');
    expect(result.taxIds).toEqual([12]);
  });
  it('cleared prefix and sales tax permit an HSN-only update', () => {
    const result = applyOdooBulkFields(original, '', '94016900', null);
    expect(result.sku).toBe(original.sku);
    expect(result.hsn).toBe('94016900');
    expect(result.taxIds).toEqual([12]);
  });
  it('cleared prefix and HSN permit a sales-tax-only update', () => {
    const result = applyOdooBulkFields(original, '', '', 18);
    expect(result.sku).toBe(original.sku);
    expect(result.hsn).toBe(original.hsn);
    expect(result.taxIds).toEqual([18]);
  });
});