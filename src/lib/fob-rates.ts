// Loads editable FOB rate cards (Settings → FOB Rates) into the pure fob module.
import { supabase } from '@/integrations/supabase/client';
import { setFobRates } from '@/lib/fob';

let loaded: Promise<void> | null = null;

export function loadFobRates(force = false): Promise<void> {
  if (loaded && !force) return loaded;
  loaded = (async () => {
    const { data } = await (supabase as any).from('fob_rates').select('mode, rates');
    const lcl = (data || []).find((r: any) => r.mode === 'LCL')?.rates;
    const fcl = (data || []).find((r: any) => r.mode === 'FCL')?.rates;
    setFobRates({ lcl, fcl });
  })().catch(() => { loaded = null; });
  return loaded;
}
