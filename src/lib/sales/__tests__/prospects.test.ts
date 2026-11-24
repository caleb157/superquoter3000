import { describe, expect, it } from 'vitest';
import { Batcher, batchRecords, filtersToParams, moveTier, paramsToFilters, searchArgs, splitLines, type LoadRecord } from '../prospects';

describe('moveTier', () => {
  it('moves up and down on A-D and stops at the ends', () => {
    expect(moveTier('C', 1)).toBe('B');
    expect(moveTier('C', -1)).toBe('D');
    expect(moveTier('A', 1)).toBe('A');
    expect(moveTier('D', -1)).toBe('D');
  });
  it('lifts a company that failed the gate into D', () => {
    expect(moveTier('X', 1)).toBe('D');
    expect(moveTier(null, 1)).toBe('C');
  });
});

describe('searchArgs', () => {
  it('hides gate failures by default', () => {
    const a = searchArgs({}, 0, 50);
    expect(a.p_status).toEqual(['new', 'researching', 'ready', 'promoted']);
    expect(a.p_lists).toBeNull();
    expect(a.p_offset).toBe(0);
  });
  it('shows everything when the full TAM list is picked, and pages', () => {
    const a = searchArgs({ lists: ['tam-raw'], q: '  oak  ' }, 2, 50);
    expect(a.p_status).toBeNull();
    expect(a.p_q).toBe('oak');
    expect(a.p_offset).toBe(100);
  });
  it('uses a picked status as given', () => {
    expect(searchArgs({ status: ['excluded'] }, 0, 50).p_status).toEqual(['excluded']);
  });
});

describe('filters in the URL', () => {
  it('round-trips', () => {
    const f = { q: 'mango', lists: ['weekly-main-2026-11-23'], tiers: ['A', 'B'], inCrm: false, sort: 'trade' as const };
    const p = filtersToParams(f);
    const back = paramsToFilters(k => p[k] ?? null);
    expect(back).toMatchObject(f);
    expect(back.hasPeople).toBeNull();
  });
});

describe('load file', () => {
  const recs: LoadRecord[] = [
    { t: 'list', id: 'a', name: 'A' }, { t: 'list', id: 'b', name: 'B' },
    ...Array.from({ length: 5 }, (_, i) => ({ t: 'p' as const, name: `Co ${i}` })),
    { t: 'pp', full_name: 'X' }, { t: 'pp', full_name: 'Y' },
  ];
  it('batches by kind and size, in file order, with record offsets', () => {
    const out = [...batchRecords(recs, 2)];
    expect(out.map(b => [b.kind, b.rows.length, b.start])).toEqual([
      ['lists', 2, 0], ['prospects', 2, 2], ['prospects', 2, 4], ['prospects', 1, 6], ['people', 2, 7],
    ]);
    expect(out[0].rows[0]).toEqual({ id: 'a', name: 'A' });
  });
  it('skips unknown record types but still counts them', () => {
    const b = new Batcher(10);
    b.push({ t: 'list', id: 'a', name: 'A' });
    b.push({ t: 'zz' } as unknown as LoadRecord);
    const first = b.push({ t: 'p', name: 'Co' });
    expect(first?.kind).toBe('lists');
    expect(b.flush()?.start).toBe(2);
    expect(b.seen).toBe(3);
  });
  it('splits chunks into JSON lines and keeps the tail', () => {
    const a = splitLines('{"t":"p","name":"A"}\n{"t":"p","na');
    expect(a.lines).toHaveLength(1);
    const b = splitLines(a.rest + 'me":"B"}\n\n');
    expect(b.lines[0]).toEqual({ t: 'p', name: 'B' });
    expect(b.rest).toBe('');
  });
});
