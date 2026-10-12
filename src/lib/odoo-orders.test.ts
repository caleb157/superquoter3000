import { describe, it, expect } from 'vitest';
import { orderLabel, orderStateLabel } from './odoo-orders';

describe('odoo order picker labels', () => {
  it('labels a sales order as customer and reference', () => {
    expect(orderLabel('so', { id: 1, name: 'S00108', state: 'sale', date: null, reference: 'Dining Table Fall Drop', customer: 'West Elm' }))
      .toBe('West Elm · Dining Table Fall Drop');
    expect(orderLabel('so', { id: 2, name: 'S00109', state: 'draft', date: null, reference: '', customer: 'West Elm' })).toBe('West Elm');
    expect(orderLabel('so', { id: 3, name: 'S00110', state: 'draft', date: null, reference: '' })).toBeNull();
  });
  it('labels a manufacturing order by SKU, else product', () => {
    expect(orderLabel('mo', { id: 1, name: 'WH/MO/00225', state: 'confirmed', date: null, reference: 'S00108', sku: 'TBL-ACACIA-84', product: '[TBL-ACACIA-84] Table' }))
      .toBe('TBL-ACACIA-84');
    expect(orderLabel('mo', { id: 2, name: 'WH/MO/00226', state: 'confirmed', date: null, reference: '', sku: '', product: 'Bench' })).toBe('Bench');
  });
  it('names Odoo states in plain words', () => {
    expect(orderStateLabel('so', 'sale')).toBe('Sales order');
    expect(orderStateLabel('mo', 'progress')).toBe('In progress');
    expect(orderStateLabel('so', 'weird')).toBe('weird');
  });
});
