import { describe, expect, it } from 'vitest';
import { postponeDate } from '@/lib/task-postpone';

const today = new Date(2026, 9, 11); // Sun 11 Oct 2026

describe('postponeDate', () => {
  it('moves a future due date out by a day, a week or a month', () => {
    expect(postponeDate('2026-10-20', 'day', today)).toBe('2026-10-21');
    expect(postponeDate('2026-10-20', 'week', today)).toBe('2026-10-27');
    expect(postponeDate('2026-10-20', 'month', today)).toBe('2026-11-20');
  });
  it('counts from today when the task is overdue, due today or has no date', () => {
    expect(postponeDate('2026-09-01', 'day', today)).toBe('2026-10-12');
    expect(postponeDate('2026-10-11', 'week', today)).toBe('2026-10-18');
    expect(postponeDate(null, 'month', today)).toBe('2026-11-11');
  });
  it('clamps month ends', () => {
    expect(postponeDate('2027-01-31', 'month', today)).toBe('2027-02-28');
  });
});
