import { supabase } from '@/integrations/supabase/client';
import { setProjectionDefaults, getProjectionDefaults, type ProjectionDefaults } from '@/lib/projections';

let loading: Promise<ProjectionDefaults> | null = null;

/** Loads Settings → Projections defaults once per session into the projections module cache. */
export function loadProjectionDefaults(force = false): Promise<ProjectionDefaults> {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data } = await (supabase as any)
      .from('global_settings')
      .select('default_certainty_pct, default_cust_deposit_pct, default_ie_deposit_pct')
      .limit(1).maybeSingle();
    if (data) setProjectionDefaults({
      certainty: Number(data.default_certainty_pct ?? 0.3),
      custDeposit: Number(data.default_cust_deposit_pct ?? 0.3),
      ieDeposit: Number(data.default_ie_deposit_pct ?? 0.8),
    });
    return getProjectionDefaults();
  })();
  return loading;
}
