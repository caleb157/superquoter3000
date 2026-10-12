import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, VALID_SECTIONS, searchSettings } from './settings-nav';

const ids = (q: string) => searchSettings(q).flatMap(g => g.items.map(i => i.id));

describe('settings navigation', () => {
  it('has five groups and every section once', () => {
    expect(NAV_GROUPS.map(g => g.label)).toEqual(['Company', 'Costing rates', 'Labor', 'Logistics', 'Data']);
    expect(new Set(VALID_SECTIONS).size).toBe(VALID_SECTIONS.length);
    expect(VALID_SECTIONS).toHaveLength(24);
    expect(VALID_SECTIONS).toContain('projections');
  });

  it('finds a section by its name or by a setting inside it', () => {
    expect(ids('exchange rate')).toEqual(['general']);
    expect(ids('Bubble')).toEqual(['wrapping']);
    expect(ids('certainty')).toEqual(['projections']);
    expect(ids('box')).toContain('box-data');
    expect(ids('hourly rate')).toEqual(['employees']);
  });

  it('matches every word, ignores case and punctuation, and shows all on an empty query', () => {
    expect(ids('FOB   fcl')).toEqual(['shipping', 'fob-rates']);
    expect(ids('labor')).toEqual(['employees', 'finishing-difficulty']); // group name matches
    expect(ids('zzz')).toEqual([]);
    expect(searchSettings('  ')).toBe(NAV_GROUPS);
  });
});
