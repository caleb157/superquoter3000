import { describe, it, expect } from 'vitest';
import { clockStart, computeInquiryClock, formatOpenFor, formatQuotedIn } from './inquiry-clock';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe('clockStart', () => {
  it('uses the creation time when the inquiry was logged on its received date', () => {
    const created = local(2026, 10, 5, 16, 0);
    expect(clockStart('2026-10-05', created.toISOString())!.getTime()).toBe(created.getTime());
  });
  it('uses the received date at local midnight when it is earlier than the creation day', () => {
    expect(clockStart('2026-10-01', local(2026, 10, 5, 9).toISOString())!.getTime()).toBe(local(2026, 10, 1).getTime());
  });
  it('falls back to the creation time with no received date', () => {
    const created = local(2026, 10, 5, 9);
    expect(clockStart(null, created.toISOString())!.getTime()).toBe(created.getTime());
  });
});

describe('formatting', () => {
  it('formats open time', () => {
    expect(formatOpenFor((6 * 24 + 4) * 3_600_000 + 59_000)).toBe('6 d 4 h');
    expect(formatOpenFor(5 * 3_600_000 + 12 * 60_000)).toBe('5 h 12 m');
    expect(formatOpenFor(35 * 60_000)).toBe('35 m');
  });
  it('formats time to quote', () => {
    expect(formatQuotedIn(3.2 * 24 * 3_600_000)).toBe('3.2 days');
    expect(formatQuotedIn(5 * 3_600_000)).toBe('5 h');
  });
});

describe('computeInquiryClock', () => {
  const created = local(2026, 10, 1, 10).toISOString();
  it('is neutral under 3 days, amber from 3, red from 7', () => {
    const at = (days: number) => computeInquiryClock({ receivedDate: '2026-10-01', createdAt: created, status: 'active', now: new Date(local(2026, 10, 1, 10).getTime() + days * 86_400_000) })!;
    expect(at(2.9).tone).toBe('neutral');
    expect(at(3).tone).toBe('amber');
    expect(at(7).tone).toBe('red');
    expect(at(7).label).toBe('Open 7 d 0 h, no quote yet');
  });
  it('stays grey for paused or closed inquiries', () => {
    const c = computeInquiryClock({ receivedDate: '2026-10-01', createdAt: created, status: 'paused', now: local(2026, 10, 20) })!;
    expect(c.tone).toBe('neutral');
  });
  it('freezes at the first quote', () => {
    const c = computeInquiryClock({ receivedDate: '2026-10-01', createdAt: created, firstQuoteAt: new Date(local(2026, 10, 1, 10).getTime() + 3.2 * 86_400_000).toISOString(), now: local(2026, 12, 1) })!;
    expect(c.state).toBe('quoted');
    expect(c.label).toBe('Quoted in 3.2 days');
    expect(c.tone).toBe('done');
  });
});
