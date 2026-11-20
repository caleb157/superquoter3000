import { describe, it, expect } from 'vitest';
import { DROPSHIP_CATEGORY, FINISHED_CATEGORY, rmHsn, setDropship, type FinishedDraft } from './odoo-bom';

const f = { category: FINISHED_CATEGORY, tracked: false } as FinishedDraft;

describe('dropship', () => {
  it('ticking moves to the dropship category and keeps inventory tracked', () => {
    const d = setDropship(f, true);
    expect(d.category).toBe(DROPSHIP_CATEGORY);
    expect(d.tracked).toBe(true);
  });
  it('unticking returns to Final Product', () => {
    expect(setDropship(setDropship(f, true), false).category).toBe(FINISHED_CATEGORY);
  });
});

describe('raw-material HSN', () => {
  it('an 8-digit code keeps its first 6 digits', () => expect(rmHsn('44191100')).toBe('441911'));
});
