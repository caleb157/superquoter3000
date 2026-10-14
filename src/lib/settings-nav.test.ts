import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, VALID_SECTIONS, resolveSettingsHash, searchSettings } from './settings-nav';

const ids = (q: string) => searchSettings(q).flatMap(g => g.items.map(i => i.id));

describe('settings navigation', () => {
  it('has five groups and every section once', () => {
    expect(NAV_GROUPS.map(g => g.label)).toEqual(['Company', 'Costing rates', 'Labor', 'Logistics', 'Data']);
    expect(new Set(VALID_SECTIONS).size).toBe(VALID_SECTIONS.length);
    expect(VALID_SECTIONS).toHaveLength(17);
    expect(VALID_SECTIONS).not.toContain('vendors'); // edited on /vendors now
    expect(VALID_SECTIONS).toContain('projections');
  });

  it('finds a section by its name or by a setting inside it', () => {
    expect(ids('exchange rate')).toEqual(['general']); // Live rates sit on General
    expect(ids('mc height buffer')).toEqual(['box-data']);
    expect(ids('certainty')).toEqual(['projections']);
    expect(ids('box')).toContain('box-data');
    expect(ids('hourly rate')).toEqual(['general']); // so do Employees
    expect(ids('auto transport')).toEqual(['shipping']);
    expect(ids('below moq')).toEqual([]); // surcharge removed
  });

  it('puts Box prices under Costing rates', () => {
    expect(NAV_GROUPS.find(g => g.label === 'Costing rates')!.items.map(i => i.id)).toContain('box-data');
  });

  it('sends old links of merged sections to their part of General', () => {
    expect(resolveSettingsHash('#team')).toEqual({ section: 'general', anchor: 'team' });
    expect(resolveSettingsHash('#live-rates')).toEqual({ section: 'general', anchor: 'live-rates' });
    expect(resolveSettingsHash('#box-data')).toEqual({ section: 'box-data', anchor: null });
    expect(resolveSettingsHash('#nope')).toBeNull();
  });

  it('matches every word, ignores case and punctuation, and shows all on an empty query', () => {
    expect(ids('FOB   fcl')).toEqual(['shipping', 'fob-rates']);
    expect(ids('labor')).toEqual(['general', 'finishing-difficulty']); // keyword + group name
    expect(ids('zzz')).toEqual([]);
    expect(searchSettings('  ')).toBe(NAV_GROUPS);
  });
});
