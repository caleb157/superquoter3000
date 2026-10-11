// Inquiry clock: how long an inquiry has waited for its first quote.
// Starts at the received date (local midnight), or at the creation time when the inquiry
// was logged that same day, so an inquiry entered at 4pm doesn't start 16 hours behind.
// Stops at the first saved quote. Amber from 3 days open, red from 7.

export type ClockTone = 'neutral' | 'amber' | 'red' | 'done';

export type InquiryClock = {
  state: 'open' | 'quoted';
  ms: number;
  label: string;
  tone: ClockTone;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const AMBER_AFTER_DAYS = 3;
export const RED_AFTER_DAYS = 7;

// Statuses where waiting for a quote is still the live question.
const TICKING_STATUSES = new Set(['active', 'projected_po']);

function localMidnight(dateOnly: string): Date | null {
  const [y, m, d] = dateOnly.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function clockStart(receivedDate: string | null | undefined, createdAt: string | null | undefined): Date | null {
  const created = createdAt ? new Date(createdAt) : null;
  const received = receivedDate ? localMidnight(receivedDate) : null;
  if (!received) return created;
  if (created && sameLocalDay(received, created)) return created;
  return received;
}

/** "6 d 4 h", "5 h 12 m", "35 m" */
export function formatOpenFor(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} m`;
  return `${m} m`;
}

/** "3.2 days", or "5 h" under a day */
export function formatQuotedIn(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < DAY) return `${Math.max(0, Math.round(safe / HOUR))} h`;
  return `${(safe / DAY).toFixed(1)} days`;
}

export function computeInquiryClock(opts: {
  receivedDate?: string | null;
  createdAt?: string | null;
  firstQuoteAt?: string | null;
  status?: string | null;
  now?: Date;
}): InquiryClock | null {
  const start = clockStart(opts.receivedDate, opts.createdAt);
  if (!start) return null;
  if (opts.firstQuoteAt) {
    const ms = Math.max(0, new Date(opts.firstQuoteAt).getTime() - start.getTime());
    return { state: 'quoted', ms, label: `Quoted in ${formatQuotedIn(ms)}`, tone: 'done' };
  }
  const ms = Math.max(0, (opts.now ?? new Date()).getTime() - start.getTime());
  const ticking = TICKING_STATUSES.has(opts.status ?? 'active');
  const tone: ClockTone = !ticking ? 'neutral' : ms >= RED_AFTER_DAYS * DAY ? 'red' : ms >= AMBER_AFTER_DAYS * DAY ? 'amber' : 'neutral';
  return { state: 'open', ms, label: `Open ${formatOpenFor(ms)}, no quote yet`, tone };
}
