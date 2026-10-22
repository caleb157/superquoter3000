import { describe, expect, it } from 'vitest';
import { localDateStr, taskDueDateError, taskDueState } from './task-helpers';

describe('localDateStr', () => {
  it('uses the local calendar date, not UTC', () => {
    expect(localDateStr(new Date(2026, 9, 12, 0, 30))).toBe('2026-10-12');
  });
});

describe('mandatory task due date', () => {
  it('rejects an empty due date for any task', () => {
    expect(taskDueDateError('')).toBe('Due date is required');
  });
  it('accepts a real date and rejects an invalid calendar date', () => {
    expect(taskDueDateError('2026-10-22')).toBeNull();
    expect(taskDueDateError('2026-02-30')).toBe('Choose a valid due date');
  });
});

describe('task due-date states', () => {
  it('classifies open tasks due today separately', () => {
    expect(taskDueState('2026-10-22', 'open', '2026-10-22')).toBe('today');
    expect(taskDueState('2026-10-23', 'open', '2026-10-22')).toBe('other');
  });
  it('keeps overdue tasks distinct and leaves completed tasks neutral', () => {
    expect(taskDueState('2026-10-21', 'open', '2026-10-22')).toBe('overdue');
    expect(taskDueState('2026-10-22', 'done', '2026-10-22')).toBe('other');
  });
});
