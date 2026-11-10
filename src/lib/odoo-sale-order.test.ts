import { describe, expect, it } from 'vitest';
import { pricelistFor, soLines } from './odoo-sale-order';

const r = (o: Partial<Parameters<typeof soLines>[0][0]> = {}) => ({ productId: 'a', name: 'Table', sku: 'X', odooId: 5, qty: 10, price: 100, ...o });
describe('Create SO lines', () => {
  it('discount = selling entity retention %, at full sale price', () => {
    const [l] = soLines([r()], 0.1);
    expect(l.discountPct).toBe(10);
    expect(l.price).toBe(100);
    expect(l.lineTotal).toBe(900);
  });
  it('no retention set = no discount', () => { expect(soLines([r()], null)[0].lineTotal).toBe(1000); });
  it('products not in Odoo are blocked', () => { expect(soLines([r({ odooId: null })], 0)[0].ready).toBe(false); });
  it('pricelist follows the inquiry currency', () => {
    expect(pricelistFor([{ id: 1, name: 'INR', currency: 'INR' }, { id: 4, name: 'USD Export', currency: 'USD' }], 'USD')).toBe(4);
  });
});
