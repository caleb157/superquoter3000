import { describe, expect, it } from 'vitest';
import { bestVendorMatch, vendorSearchWord } from './vendor-match';

describe('vendor match', () => {
  const odoo = [{ id: 1, name: 'MUMINAL TANDOORS PVT. LTD.' }, { id: 2, name: 'Jodhpur Iron Works' }];
  it('suggests the Odoo vendor ignoring Pvt Ltd and case', () => {
    expect(bestVendorMatch('Muminal Tandoors', odoo)?.id).toBe(1);
  });
  it('suggests nothing for an unrelated name', () => {
    expect(bestVendorMatch('Sharma Glass House', odoo)).toBeNull();
  });
  it('searches by the longest meaningful word', () => {
    expect(vendorSearchWord('Muminal Tandoors Pvt Ltd')).toBe('tandoors');
  });
});
