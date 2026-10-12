// Shared helpers for the Analytics dashboards.
// Centralizes the date-range math.

export type DateRange = { from: Date; to: Date };

export type RangePreset =
  | '7d' | '14d' | '30d'
  | 'this_q' | 'last_q'
  | 'this_fy' | 'last_fy'
  | 'this_cy' | 'last_cy'
  | 'custom';

export const RANGE_LABELS: Record<RangePreset, string> = {
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
  this_q: 'This quarter',
  last_q: 'Last quarter',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  this_cy: 'This calendar year',
  last_cy: 'Last calendar year',
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
    case 'this_cy':
      return { from: startOfDay(new Date(now.getFullYear(), 0, 1)), to: endOfDay(new Date(now.getFullYear(), 11, 31)) };
    case 'last_cy':
      return { from: startOfDay(new Date(now.getFullYear() - 1, 0, 1)), to: endOfDay(new Date(now.getFullYear() - 1, 11, 31)) };
    case 'custom': {
      const from = custom?.from ? startOfDay(new Date(custom.from + 'T00:00:00')) : startOfDay(new Date(now.getTime() - 29 * 86400000));
      const to = custom?.to ? endOfDay(new Date(custom.to + 'T00:00:00')) : endOfDay(now);
      return { from, to };
    }
  }
}

export function inRange(date: string | Date | null | undefined, range: DateRange): boolean {
  if (!date) return false;
  const t = new Date(date).getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
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

// ---------------- Cashflow forecast ----------------

export type CashflowItem = {
  inquiry_id: string;
  inquiry_number: string;
  customer_name: string;
  amount_usd: number;
  expected_date: Date;
  kind: 'deposit' | 'balance';
};

export type PoInquiryForForecast = {
  id: string;
  rfq_number: string;
  customer_name: string;
  po_received_date: string | null;
  po_total_value_usd: number | null;
  payment_terms_deposit_pct: number | null;
  payment_terms_deposit_due_days: number | null;
  payment_terms_balance_due_days: number | null;
};

