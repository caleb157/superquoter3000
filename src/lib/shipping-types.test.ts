import { describe, expect, it } from 'vitest';
import { currentShippingTypeName, findShippingType } from './shipping-types';

describe('retired shipping types', () => {
  it('maps old names to their replacement', () => {
    expect(currentShippingTypeName('FOB Navasheva')).toBe('FOB MUMBAI LCL');
    expect(currentShippingTypeName('fob mundra')).toBe('FOB Mundra via Jodhpur ICD');
    expect(currentShippingTypeName('FOB - 40HC standard')).toBe('FOB Mundra via Jodhpur ICD');
    expect(currentShippingTypeName('EX Works shipped to Mumbai')).toBe('FOB MUMBAI LCL');
  });
  it('leaves current and custom names alone', () => {
    expect(currentShippingTypeName('EXW Jodhpur')).toBe('EXW Jodhpur');
    expect(currentShippingTypeName(' FOB Mumbai port, consolidated ')).toBe('FOB Mumbai port, consolidated');
    expect(currentShippingTypeName('')).toBeNull();
  });
  it('finds the replacement type in a list', () => {
    const types = [{ name: 'FOB MUMBAI LCL' }, { name: 'FOB Mundra via Jodhpur ICD' }];
    expect(findShippingType(types, 'FOB Navasheva')?.name).toBe('FOB MUMBAI LCL');
    expect(findShippingType(types, 'Air')).toBeUndefined();
  });
});
