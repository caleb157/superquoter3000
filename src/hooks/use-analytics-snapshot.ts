import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Snapshot } from '@/lib/master-analytics';
import { toast } from 'sonner';

export function useAnalyticsSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await (supabase as any).from('analytics_snapshots')
      .select('payload, synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle();
    setSnapshot((data?.payload as Snapshot) ?? null);
    setSyncedAt(data?.synced_at ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async (overheadMonths: number) => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('odoo-analytics-sync', { body: { overhead_months: overheadMonths } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      const w = (data as any)?.warnings || [];
      if (w.length) toast.warning(`Synced with ${w.length} warning(s)`, { description: w.slice(0, 3).join(' · ') });
      else toast.success('Odoo & LaborTrax synced');
      await load();
    } catch (e: any) {
      toast.error('Sync failed', { description: e.message });
    } finally { setSyncing(false); }
  }, [load]);

  return { snapshot, syncedAt, loading, syncing, refresh };
}
