import { describe, expect, it } from 'vitest';
import { productSize } from './product-size';

describe('productSize', () => {
  it('formats W × D × H in inches, trimming decimals', () => {
    expect(productSize({ width_inch: 12, depth_inch: 8.25, height_inch: 4.333 })).toBe('12 × 8.25 × 4.33"');
  });
  it('is null when no size is entered', () => {
    expect(productSize({ width_inch: null, depth_inch: 0, height_inch: undefined })).toBeNull();
    expect(productSize(null)).toBeNull();
  });
  it('marks a missing axis with ?', () => {
    expect(productSize({ width_inch: 10, depth_inch: null, height_inch: 3 })).toBe('10 × ? × 3"');
  });
});
