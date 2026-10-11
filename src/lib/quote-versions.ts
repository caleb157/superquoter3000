// Quote versions: editing a quote that has been sent never changes what the customer got.
// The first save creates a new draft version (Q-123-v2, Q-123-v3, ...) and the edit lands there.
// Every version points at the first one (version_of); the first has version 1 and no version_of.
import { supabase } from '@/integrations/supabase/client';

export function isSentQuote(q: { sent_at?: string | null; status?: string | null } | null | undefined): boolean {
  if (!q) return false;
  return !!q.sent_at || ['sent', 'viewed', 'approved'].includes(q.status ?? '');
}

/** "Q-123-v2" -> "Q-123"; numbers without a version suffix are returned as they are. */
export function baseQuoteNumber(quoteNumber: string | null | undefined): string {
  return (quoteNumber ?? '').replace(/-v\d+$/, '');
}

export function versionedQuoteNumber(quoteNumber: string | null | undefined, version: number): string {
  const base = baseQuoteNumber(quoteNumber) || 'Q';
  return version <= 1 ? base : `${base}-v${version}`;
}

/** Next version for a family, given the versions it already has. */
export function nextVersion(existing: Array<number | null | undefined>): number {
  return Math.max(1, ...existing.map(v => Number(v || 1))) + 1;
}

// Fields that describe the customer's response to one particular sent copy; a new version starts clean.
const RESET_ON_COPY = ['id', 'created_at', 'sent_at', 'viewed_at', 'approved_at', 'approved_by', 'customer_selections'];

/** Copies a quote into a new draft version and returns the new row's id and number. */
export async function createQuoteVersion(quoteId: string): Promise<{ id?: string; quote_number?: string; version?: number; error?: string }> {
  const { data: src, error } = await (supabase as any).from('quote_snapshots').select('*').eq('id', quoteId).maybeSingle();
  if (error || !src) return { error: error?.message ?? 'Quote not found' };
  const rootId: string = src.version_of ?? src.id;
  const { data: family } = await (supabase as any).from('quote_snapshots')
    .select('version').or(`id.eq.${rootId},version_of.eq.${rootId}`);
  const version = nextVersion(((family ?? []) as any[]).map(r => r.version));

  const copy: any = { ...src };
  RESET_ON_COPY.forEach(k => { delete copy[k]; });
  copy.status = 'draft';
  copy.share_token = crypto.randomUUID();
  copy.version = version;
  copy.version_of = rootId;
  copy.quote_number = versionedQuoteNumber(src.quote_number, version);

  const { data, error: insErr } = await (supabase as any).from('quote_snapshots')
    .insert(copy).select('id, quote_number').single();
  if (insErr) return { error: insErr.message };
  return { id: data.id, quote_number: data.quote_number, version };
}
