import { describe, it, expect } from 'vitest';
import { inquiryQuoteTimings, sampleRequestTimings, monthlyMedians } from './timing-kpis';

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h);

describe('inquiryQuoteTimings', () => {
  const now = at(2026, 10, 11, 12);
  const inquiries = [
    { id: 'a', received_date: '2026-10-01', created_at: at(2026, 10, 2, 9).toISOString(), status: 'active' },
    { id: 'b', received_date: null, created_at: at(2026, 10, 8, 12).toISOString(), status: 'active' },
    { id: 'c', received_date: '2026-10-05', created_at: at(2026, 10, 5, 12).toISOString(), status: 'paused' },
  ];
  const quotes = [
    { customer_rfq_id: 'a', created_at: at(2026, 10, 6, 12).toISOString() },
    { customer_rfq_id: 'a', created_at: at(2026, 10, 4, 0).toISOString() }, // earliest wins, whatever the order
    { customer_rfq_id: null, created_at: at(2026, 10, 1).toISOString() },
  ];
  const rows = inquiryQuoteTimings(inquiries, quotes, now);
  it('stops at the first quote, counted from the received date like the inquiry clock', () => {
    const a = rows.find(r => r.inquiryId === 'a')!;
    expect(a.days).toBe(3);
    expect(a.quotedAt?.toISOString()).toBe(at(2026, 10, 4).toISOString());
    expect(a.waiting).toBe(false);
  });
  it('keeps unquoted inquiries open, waiting only while active', () => {
    const b = rows.find(r => r.inquiryId === 'b')!;
    expect(b.quotedAt).toBeNull();
    expect(b.days).toBe(3);
    expect(b.waiting).toBe(true);
    expect(rows.find(r => r.inquiryId === 'c')!.waiting).toBe(false);
  });
});

describe('sampleRequestTimings', () => {
  it('stops when the last live line is received and skips empty requests', () => {
    const rows = sampleRequestTimings([
      { id: 'r1', request_number: 'SR-1', customer_rfq_id: 'a', requested_date: '2026-10-01', samples: [
        { status: 'completed', completed_at: at(2026, 10, 3).toISOString() },
        { status: 'completed', completed_at: at(2026, 10, 6).toISOString() },
        { status: 'cancelled' },
      ] },
      { id: 'r2', request_number: 'SR-2', customer_rfq_id: 'a', requested_date: '2026-10-09', samples: [{ status: 'pending' }] },
      { id: 'r3', request_number: 'SR-3', customer_rfq_id: 'a', requested_date: '2026-10-09', samples: [{ status: 'cancelled' }] },
    ], at(2026, 10, 11));
    expect(rows.map(r => r.requestId)).toEqual(['r1', 'r2']);
    expect(rows[0].days).toBe(5);
    expect(rows[0].receivedAt?.toISOString()).toBe(at(2026, 10, 6).toISOString());
    expect(rows[1].receivedAt).toBeNull();
    expect(rows[1].days).toBe(2);
  });
});

describe('monthlyMedians', () => {
  it('buckets by the month the clock stopped, oldest first, with empty months kept', () => {
    const m = monthlyMedians([
      { at: at(2026, 10, 2), days: 1 }, { at: at(2026, 10, 20), days: 5 }, { at: at(2026, 10, 25), days: 3 },
      { at: at(2026, 8, 1), days: 4 },
    ], at(2026, 10, 31), 3);
    expect(m.map(x => [x.key, x.median, x.n])).toEqual([['2026-08', 4, 1], ['2026-09', null, 0], ['2026-10', 3, 3]]);
  });
});
