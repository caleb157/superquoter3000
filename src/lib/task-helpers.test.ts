import { describe, expect, it } from 'vitest';
import { localDateStr } from './task-helpers';

describe('localDateStr', () => {
  it('uses the local calendar date, not UTC', () => {
    expect(localDateStr(new Date(2026, 9, 12, 0, 30))).toBe('2026-10-12');
  });
});
