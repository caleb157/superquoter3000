import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/product-clone', () => ({}));
vi.mock('@/lib/costing-seed', () => ({}));
import { repeatSourceInquiry } from './repeat-order';
import { effectiveCertainty, setProjectionDefaults } from './projections';

describe('repeatSourceInquiry', () => {
  it('picks the inquiry most products come from, first picked on a tie', () => {
    expect(repeatSourceInquiry([{ productId: '1', inquiryId: 'a' }, { productId: '2', inquiryId: 'b' }, { productId: '3', inquiryId: 'b' }])).toBe('b');
    expect(repeatSourceInquiry([{ productId: '1', inquiryId: 'a' }, { productId: '2', inquiryId: 'b' }])).toBe('a');
    expect(repeatSourceInquiry([{ productId: '1', inquiryId: null }])).toBeNull();
  });
});

describe('effectiveCertainty for repeat orders', () => {
  setProjectionDefaults({ certainty: 0.3, repeatCertainty: 0.8 });
  it('starts repeats at the repeat default, below an override and booked/cancelled', () => {
    expect(effectiveCertainty({ certainty_override: null, repeat_order: true }, [], 'active')).toBe(0.8);
    expect(effectiveCertainty({ certainty_override: null, repeat_order: false }, [], 'active')).toBe(0.3);
    expect(effectiveCertainty({ certainty_override: 0.5, repeat_order: true }, [], 'active')).toBe(0.5);
    expect(effectiveCertainty({ certainty_override: null, repeat_order: true }, [], 'po')).toBe(1);
    expect(effectiveCertainty({ certainty_override: null, repeat_order: true }, [], 'paused')).toBe(0);
  });
});
