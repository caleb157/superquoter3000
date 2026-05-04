// Shared helpers for the Analytics dashboards.
// Centralizes date math, RFQ↔Quote pairing, sample cycle time, and lifecycle durations.

export type DateRange = { from: Date; to: Date };

export type RangePreset =
  | '7d' | '14d' | '30d'
  | 'this_q' | 'last_q'
  | 'this_fy' | 'last_fy'
  | 'custom';

export const RANGE_LABELS: Record<RangePreset, string> = {
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
  this_q: 'This quarter',
  last_q: 'Last quarter',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  custom: 'Custom range',
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfCalendarQuarter(d: Date) {
  const m = d.getMonth();
  const qStart = m - (m % 3);
  return startOfDay(new Date(d.getFullYear(), qStart, 1));
}
function endOfCalendarQuarter(d: Date) {
  const start = startOfCalendarQuarter(d);
  return endOfDay(new Date(start.getFullYear(), start.getMonth() + 3, 0));
}
// Indian fiscal year: Apr 1 → Mar 31
function startOfFY(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return startOfDay(new Date(y, 3, 1));
}
function endOfFY(d: Date) {
  const start = startOfFY(d);
  return endOfDay(new Date(start.getFullYear() + 1, 2, 31));
}

export function rangeFromPreset(preset: RangePreset, custom?: { from?: string; to?: string }): DateRange {
  const now = new Date();
  switch (preset) {
    case '7d':
      return { from: startOfDay(new Date(now.getTime() - 6 * 86400000)), to: endOfDay(now) };
    case '14d':
      return { from: startOfDay(new Date(now.getTime() - 13 * 86400000)), to: endOfDay(now) };
    case '30d':
      return { from: startOfDay(new Date(now.getTime() - 29 * 86400000)), to: endOfDay(now) };
    case 'this_q':
      return { from: startOfCalendarQuarter(now), to: endOfCalendarQuarter(now) };
    case 'last_q': {
      const prev = new Date(now.getFullYear(), now.getMonth() - 3, 15);
      return { from: startOfCalendarQuarter(prev), to: endOfCalendarQuarter(prev) };
    }
    case 'this_fy':
      return { from: startOfFY(now), to: endOfFY(now) };
    case 'last_fy': {
      const prev = new Date(now.getFullYear() - 1, now.getMonth(), 15);
      return { from: startOfFY(prev), to: endOfFY(prev) };
    }
    case 'custom': {
      const from = custom?.from ? startOfDay(new Date(custom.from)) : startOfDay(new Date(now.getTime() - 29 * 86400000));
      const to = custom?.to ? endOfDay(new Date(custom.to)) : endOfDay(now);
      return { from, to };
    }
  }
}

export function inRange(date: string | Date | null | undefined, range: DateRange): boolean {
  if (!date) return false;
  const t = new Date(date).getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

export function pairRfqsToQuotes(
  receivedRfqs: Array<{ id: string; inquiry_id: string; received_date: string }>,
  quotes: Array<{ id: string; customer_rfq_id: string | null; created_at: string }>,
): Array<{ receivedRfqId: string; quoteSnapshotId: string; inquiryId: string; days: number; receivedAt: string; respondedAt: string }> {
  const quotesByInquiry: Record<string, Array<{ id: string; customer_rfq_id: string | null; created_at: string }>> = {};
  quotes.forEach(q => {
    if (!q.customer_rfq_id) return;
    (quotesByInquiry[q.customer_rfq_id] ||= []).push(q);
  });
  Object.values(quotesByInquiry).forEach(arr => arr.sort((a, b) => a.created_at.localeCompare(b.created_at)));

  const rfqsByInquiry: Record<string, Array<{ id: string; inquiry_id: string; received_date: string }>> = {};
  receivedRfqs.forEach(r => { (rfqsByInquiry[r.inquiry_id] ||= []).push(r); });
  Object.values(rfqsByInquiry).forEach(arr => arr.sort((a, b) => a.received_date.localeCompare(b.received_date)));

  const out: Array<{ receivedRfqId: string; quoteSnapshotId: string; inquiryId: string; days: number; receivedAt: string; respondedAt: string }> = [];
  for (const inquiryId of Object.keys(rfqsByInquiry)) {
    const rfqs = rfqsByInquiry[inquiryId];
    const qs = quotesByInquiry[inquiryId] ?? [];
    let qIdx = 0;
    for (const r of rfqs) {
      while (qIdx < qs.length && qs[qIdx].created_at <= r.received_date) qIdx++;
      if (qIdx >= qs.length) break;
      const matched = qs[qIdx];
      const days = (new Date(matched.created_at).getTime() - new Date(r.received_date + 'T00:00:00Z').getTime()) / 86400000;
      out.push({
        receivedRfqId: r.id,
        quoteSnapshotId: matched.id,
        inquiryId,
        days,
        receivedAt: r.received_date,
        respondedAt: matched.created_at,
      });
      qIdx++;
    }
  }
  return out;
}

export function sampleCycleDays(sample: { requested_date: string | null; completed_at: string | null }): number | null {
  if (!sample.requested_date || !sample.completed_at) return null;
  return (new Date(sample.completed_at).getTime() - new Date(sample.requested_date + 'T00:00:00Z').getTime()) / 86400000;
}

export function lifecycleDurations(events: Array<{ customer_id: string; from_status: string | null; to_status: string; occurred_at: string }>) {
  const byCustomer: Record<string, typeof events> = {};
  events.forEach(e => { (byCustomer[e.customer_id] ||= []).push(e); });
  Object.values(byCustomer).forEach(arr => arr.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)));

  const transitions: Array<{ customer_id: string; from_status: string; to_status: string; days: number; occurred_at: string }> = [];
  for (const customerId of Object.keys(byCustomer)) {
    const evs = byCustomer[customerId];
    for (let i = 1; i < evs.length; i++) {
      const prev = evs[i - 1];
      const cur = evs[i];
      const days = (new Date(cur.occurred_at).getTime() - new Date(prev.occurred_at).getTime()) / 86400000;
      transitions.push({
        customer_id: customerId,
        from_status: prev.to_status,
        to_status: cur.to_status,
        days,
        occurred_at: cur.occurred_at,
      });
    }
  }
  return transitions;
}

export function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function fmtDays(d: number | null | undefined): string {
  if (d == null || isNaN(d)) return '—';
  return `${d.toFixed(1)}d`;
}

export function fmtDateShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
