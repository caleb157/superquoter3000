// Client side of the live-rates-sync edge function (see src/lib/live-rates.ts).
import { supabase } from '@/integrations/supabase/client';
import { isLiveStale } from '@/lib/live-rates';

export type LiveSyncResult = { ok?: boolean; warnings?: string[]; error?: string; currencies_updated?: number };

export async function syncLiveRates(): Promise<LiveSyncResult> {
  const { data, error } = await supabase.functions.invoke('live-rates-sync', { body: {} });
  if (error) return { error: error.message };
  const res = (data || {}) as LiveSyncResult;
  if (!res.error) {
    const { invalidateCurrencyCache } = await import('@/lib/currency');
    invalidateCurrencyCache();
  }
  return res;
}

let autoRan = false;
/** Once per session: refresh live rates in the background when they are stale. */
export async function refreshLiveRatesIfStale(): Promise<void> {
  if (autoRan) return;
  autoRan = true;
  const { data } = await (supabase as any).from('global_settings')
    .select('live_exchange_rate_at, live_labor_at').limit(1).maybeSingle();
  if (!isLiveStale(data.live_exchange_rate_at) && !isLiveStale(data.live_labor_at)) return;
  await syncLiveRates().catch(() => {});
}
