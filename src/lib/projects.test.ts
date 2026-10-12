import { describe, expect, it } from 'vitest';
import { isProjectOverdue, projectStatusMeta, sortProjects } from './projects';

describe('projects', () => {
  it('sorts by status, then soonest end date, then name', () => {
    const list = sortProjects([
      { name: 'B', status: 'done' as const, end_date: '2026-01-01' },
      { name: 'Z', status: 'in_progress' as const, end_date: null },
      { name: 'A', status: 'in_progress' as const, end_date: '2026-12-01' },
      { name: 'C', status: 'paused' as const, end_date: '2026-02-01' },
      { name: 'M', status: 'in_progress' as const, end_date: '2026-11-01' },
    ]);
    expect(list.map(p => p.name)).toEqual(['M', 'A', 'Z', 'C', 'B']);
  });

  it('flags only open projects past their end date', () => {
    expect(isProjectOverdue({ status: 'in_progress', end_date: '2026-10-01' }, '2026-10-12')).toBe(true);
    expect(isProjectOverdue({ status: 'paused', end_date: '2026-10-12' }, '2026-10-12')).toBe(false);
    expect(isProjectOverdue({ status: 'done', end_date: '2026-10-01' }, '2026-10-12')).toBe(false);
    expect(isProjectOverdue({ status: 'in_progress', end_date: null }, '2026-10-12')).toBe(false);
  });

  it('falls back to In progress for an unknown status', () => {
    expect(projectStatusMeta('x').label).toBe('In progress');
    expect(projectStatusMeta('cancelled').label).toBe('Cancelled');
  });
});
