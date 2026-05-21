import { describe, it, expect } from 'vitest';
import { npmToMarkup, markupToNpm } from '@/lib/calculations';

describe('NPM <-> Markup', () => {
  it('round-trips markup→npm→markup', () => {
    expect(npmToMarkup(markupToNpm(0.25))).toBeCloseTo(0.25, 10);
    expect(npmToMarkup(markupToNpm(0.5))).toBeCloseTo(0.5, 10);
  });
  it('round-trips npm→markup→npm', () => {
    expect(markupToNpm(npmToMarkup(0.20))).toBeCloseTo(0.20, 10);
    expect(markupToNpm(npmToMarkup(0.33))).toBeCloseTo(0.33, 10);
  });
  it('known examples', () => {
    expect(npmToMarkup(0.20)).toBeCloseTo(0.25, 10);
    expect(markupToNpm(0.25)).toBeCloseTo(0.20, 10);
    expect(npmToMarkup(0.25)).toBeCloseTo(1 / 3, 10);
  });
  it('handles edge cases', () => {
    expect(npmToMarkup(0)).toBe(0);
    expect(markupToNpm(0)).toBe(0);
    expect(npmToMarkup(1)).toBe(Infinity);
  });
});
