import { describe, expect, it } from 'vitest';
import { applyMoqToLines, touchesMoq } from './quote-moq-sync';

describe('applyMoqToLines', () => {
  const byId = new Map([['p1', { moq: 200, hard_moq: 100 }], ['a1', { moq: 30, hard_moq: null }]]);

  it('updates matching product lines and leaves the rest alone', () => {
    const lines = [
      { product_id: 'p1', moq: 50, hard_moq: null, quantity: 300 },
      { product_id: 'p2', moq: 50 },
      { is_assembly: true, assembly_id: 'a1', product_id: null, moq: 10 },
    ];
    const next = applyMoqToLines(lines, byId, 'product')!;
    expect(next[0]).toEqual({ product_id: 'p1', moq: 200, hard_moq: 100, quantity: 300 });
    expect(next[1]).toBe(lines[1]);
    expect(next[2]).toBe(lines[2]);
  });

  it('matches assembly lines by assembly id', () => {
    const next = applyMoqToLines([{ is_assembly: true, assembly_id: 'a1', moq: 10 }], byId, 'assembly')!;
    expect(next[0]).toMatchObject({ moq: 30, hard_moq: null });
  });

  it('returns null when nothing changed', () => {
    expect(applyMoqToLines([{ product_id: 'p1', moq: 200, hard_moq: 100 }], byId, 'product')).toBeNull();
    expect(applyMoqToLines(null as any, byId, 'product')).toBeNull();
  });
});

describe('touchesMoq', () => {
  it('spots MOQ patches', () => {
    expect(touchesMoq({ moq: 5 })).toBe(true);
    expect(touchesMoq({ hard_moq: null })).toBe(true);
    expect(touchesMoq({ quantity: 5 })).toBe(false);
  });
});
