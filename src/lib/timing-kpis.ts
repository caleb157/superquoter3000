// Timing KPIs for the analytics dashboard, read from the same clocks shown on each inquiry:
// inquiry → first quote (src/lib/inquiry-clock.ts) and sample request → every live sample
// received at our factory (src/lib/sample-requests.ts). So the dashboard can't disagree with
// what the inquiry page says.
import { clockStart, computeInquiryClock } from '@/lib/inquiry-clock';
import { computeSampleClock, type SampleLineLite } from '@/lib/sample-requests';
import { median } from '@/lib/analytics-helpers';

const DAY = 86_400_000;
const WAITING_STATUSES = new Set(['active', 'projected_po']);

export type InquiryTiming = {
  inquiryId: string;
  start: Date;
  quotedAt: Date | null;
  days: number;
  /** Open and still waiting on a quote (active / projected PO); paused or cancelled ones aren't. */
  waiting: boolean;
};

export function inquiryQuoteTimings(
  inquiries: Array<{ id: string; received_date: string | null; created_at: string | null; status: string | null }>,
  quotes: Array<{ customer_rfq_id: string | null; created_at: string }>,
  now: Date = new Date(),
): InquiryTiming[] {
  const first = new Map<string, string>();
  for (const q of quotes) {
    if (!q.customer_rfq_id) continue;
    const cur = first.get(q.customer_rfq_id);
    if (!cur || q.created_at < cur) first.set(q.customer_rfq_id, q.created_at);
  }
  const out: InquiryTiming[] = [];
  for (const i of inquiries) {
    const firstQuoteAt = first.get(i.id) ?? null;
    const clock = computeInquiryClock({ receivedDate: i.received_date, createdAt: i.created_at, firstQuoteAt, status: i.status, now });
    const start = clockStart(i.received_date, i.created_at);
    if (!clock || !start) continue;
    out.push({
      inquiryId: i.id, start, quotedAt: firstQuoteAt ? new Date(firstQuoteAt) : null, days: clock.ms / DAY,
      waiting: clock.state === 'open' && WAITING_STATUSES.has(i.status ?? 'active'),
    });
  }
  return out;
}

export type SampleTiming = {
  requestId: string;
  number: string;
  inquiryId: string | null;
  requestedDate: string;
  receivedAt: Date | null;
  days: number;
  received: number;
  total: number;
};

export function sampleRequestTimings(
  requests: Array<{ id: string; request_number: string; customer_rfq_id: string | null; requested_date: string; required_by_date?: string | null; samples?: SampleLineLite[] | null }>,
  now: Date = new Date(),
): SampleTiming[] {
  const out: SampleTiming[] = [];
  for (const r of requests) {
    const c = computeSampleClock(r, r.samples ?? [], now);
    if (c.state === 'empty') continue;
    out.push({
      requestId: r.id, number: r.request_number, inquiryId: r.customer_rfq_id, requestedDate: r.requested_date,
      receivedAt: c.state === 'received' ? c.stoppedAt ?? null : null, days: c.ms / DAY, received: c.received, total: c.total,
    });
  }
  return out;
}

export type MonthPoint = { key: string; label: string; median: number | null; n: number };

/** Median days per calendar month (by the date the clock stopped), for the `months` months ending with `end`'s month. */
export function monthlyMedians(points: Array<{ at: Date; days: number }>, end: Date, months = 6): MonthPoint[] {
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const buckets = new Map<string, number[]>();
  for (const p of points) {
    const k = keyOf(p.at);
    buckets.set(k, [...(buckets.get(k) ?? []), p.days]);
  }
  const out: MonthPoint[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(end.getFullYear(), end.getMonth() - k, 1);
    const vals = buckets.get(keyOf(d)) ?? [];
    out.push({ key: keyOf(d), label: d.toLocaleDateString(undefined, { month: 'short' }), median: median(vals), n: vals.length });
  }
  return out;
}
