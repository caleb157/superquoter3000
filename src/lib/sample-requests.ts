// Sample requests: one request per batch of samples, with `samples` rows as its lines.
// Stored line statuses: pending = requested, completed = received at our factory (completed_at is
// when it arrived), cancelled. The sample clock runs from the request date until every line that
// isn't cancelled has been received.
import { supabase } from '@/integrations/supabase/client';
import { formatOpenFor, formatQuotedIn, type ClockTone } from '@/lib/inquiry-clock';

export const SAMPLE_STATUS_LABEL: Record<string, string> = {
  pending: 'Requested',
  completed: 'Received at factory',
  cancelled: 'Cancelled',
};
export const SAMPLE_STATUSES = ['pending', 'completed', 'cancelled'] as const;

// Samples are allowed up to 2 weeks (quote terms); amber from 10 days, red from 14 or past required-by.
export const SAMPLE_AMBER_DAYS = 10;
export const SAMPLE_RED_DAYS = 14;
const DAY = 86_400_000;

export type SampleLineLite = { status: string; completed_at?: string | null };
export type SampleClock = { state: 'open' | 'received' | 'empty'; label: string; tone: ClockTone; received: number; total: number; ms: number; stoppedAt?: Date };

function localMidnight(dateOnly: string): Date {
  const [y, m, d] = dateOnly.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function computeSampleClock(
  request: { requested_date: string; required_by_date?: string | null },
  lines: SampleLineLite[],
  now: Date = new Date(),
): SampleClock {
  const live = lines.filter(l => l.status !== 'cancelled');
  const received = live.filter(l => l.status === 'completed');
  const total = live.length;
  const start = localMidnight(request.requested_date);
  if (total === 0) return { state: 'empty', label: 'No samples on this request', tone: 'neutral', received: 0, total: 0, ms: 0 };
  if (received.length === total) {
    const stop = Math.max(...received.map(l => (l.completed_at ? new Date(l.completed_at).getTime() : start.getTime())));
    const ms = Math.max(0, stop - start.getTime());
    return { state: 'received', label: `Samples received in ${formatQuotedIn(ms)}`, tone: 'done', received: total, total, ms, stoppedAt: new Date(stop) };
  }
  const ms = Math.max(0, now.getTime() - start.getTime());
  const pastDue = request.required_by_date ? now.getTime() > localMidnight(request.required_by_date).getTime() + DAY : false;
  const tone: ClockTone = pastDue || ms >= SAMPLE_RED_DAYS * DAY ? 'red' : ms >= SAMPLE_AMBER_DAYS * DAY ? 'amber' : 'neutral';
  return {
    state: 'open',
    label: `Samples requested ${formatOpenFor(ms)} ago, ${received.length} of ${total} received`,
    tone, received: received.length, total, ms,
  };
}

/** Creates one request with a line per product and returns it. Product sample stages follow automatically. */
export async function createSampleRequest(inquiryId: string, productIds: string[]): Promise<{ id?: string; request_number?: string; error?: string }> {
  if (productIds.length === 0) return { error: 'No products selected' };
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { data: req, error } = await (supabase as any).from('sample_requests')
    .insert({ customer_rfq_id: inquiryId, requested_date: ymd }).select('id, request_number').single();
  if (error) return { error: error.message };
  const { error: lErr } = await (supabase as any).from('samples').insert(productIds.map(pid => ({
    request_id: req.id, product_id: pid, customer_rfq_id: inquiryId, status: 'pending', requested_date: ymd,
  })));
  if (lErr) {
    await (supabase as any).from('sample_requests').delete().eq('id', req.id);
    return { error: lErr.message };
  }
  return { id: req.id, request_number: req.request_number };
}
