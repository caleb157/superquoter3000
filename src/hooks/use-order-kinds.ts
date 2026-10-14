// Hand-set trading / manufacturing kinds per Odoo SO (odoo_order_kinds); see src/lib/order-kind.ts.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { OrderKind, OrderKinds } from '@/lib/order-kind';

/** Loads every hand-set kind; setKind(so, null) goes back to the guess. */
export function useOrderKinds() {
  const [kinds, setKinds] = useState<OrderKinds>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error: err } = await (supabase as any).from('odoo_order_kinds').select('so_name, kind');
      if (!live) return;
      if (err) setError(err.message);
      else setKinds(Object.fromEntries((data ?? []).map((r: { so_name: string; kind: OrderKind }) => [r.so_name, r.kind])));
      setLoaded(true);
    })();
    return () => { live = false; };
  }, []);
  const setKind = useCallback(async (soName: string, kind: OrderKind | null) => {
    const before = kinds;
    setKinds(k => { const n = { ...k }; if (kind) n[soName] = kind; else delete n[soName]; return n; });
    const q = (supabase as any).from('odoo_order_kinds');
    const { error: err } = kind
      ? await q.upsert({ so_name: soName, kind }, { onConflict: 'so_name' })
      : await q.delete().eq('so_name', soName);
    if (err) { setKinds(before); setError(err.message); return false; }
    setError(null);
    return true;
  }, [kinds]);
  return { kinds, loaded, error, setKind };
}
