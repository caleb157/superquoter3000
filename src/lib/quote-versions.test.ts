import { describe, it, expect } from 'vitest';
import { baseQuoteNumber, isSentQuote, nextVersion, versionedQuoteNumber } from './quote-versions';

describe('quote versions', () => {
  it('treats a quote with a sent date or a sent/viewed/approved status as sent', () => {
    expect(isSentQuote({ sent_at: '2026-10-01T12:00:00Z', status: 'draft' })).toBe(true);
    expect(isSentQuote({ sent_at: null, status: 'viewed' })).toBe(true);
    expect(isSentQuote({ sent_at: null, status: 'draft' })).toBe(false);
    expect(isSentQuote(null)).toBe(false);
  });
  it('builds version numbers from the base quote number', () => {
    expect(baseQuoteNumber('Q-1791727034194-v3')).toBe('Q-1791727034194');
    expect(versionedQuoteNumber('Q-1791727034194', 2)).toBe('Q-1791727034194-v2');
    expect(versionedQuoteNumber('Q-1791727034194-v2', 3)).toBe('Q-1791727034194-v3');
  });
  it('numbers the next version after the highest in the family', () => {
    expect(nextVersion([1])).toBe(2);
    expect(nextVersion([1, 3, 2])).toBe(4);
    expect(nextVersion([null])).toBe(2);
  });
});
