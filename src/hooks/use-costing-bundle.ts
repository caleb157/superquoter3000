// Shared state for anything that edits costing through the workspace bundle (the inquiry
// Costing Workspace and the product Costing tab): load, apply mutations optimistically,
// write through, and persist engine-derived values a moment after edits settle.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { invalidateShipmentPool } from '@/lib/shipment-pool';
import {
  buildRows, computeResults, persistDerived, totals,
  type Apply, type Bundle,
} from '@/lib/costing-workspace';

export function useCostingBundle(loader: (() => Promise<Bundle | null>) | null) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!loader) return;
    const b = await loader();
    bundleRef.current = b;
    setBundle(b);
    setLoading(false);
  }, [loader]);
  useEffect(() => { void load(); }, [load]);
  /** Load again from the database, showing the loading state. */
  const reload = useCallback(() => { setLoading(true); return load(); }, [load]);

  const results = useMemo(() => (bundle ? computeResults(bundle) : new Map()), [bundle]);
  const rows = useMemo(() => (bundle ? buildRows(bundle, results) : []), [bundle, results]);
  const t = useMemo(() => totals(rows), [rows]);

  // Engine-derived values (auto rows, cached price on the product) are written back a
  // moment after edits settle, so lists elsewhere in the app stay current.
  const pendingDerived = useRef<Set<string>>(new Set());
  const derivedTimer = useRef<number | null>(null);
  const flushDerived = useCallback(() => {
    if (derivedTimer.current) window.clearTimeout(derivedTimer.current);
    derivedTimer.current = null;
    const b = bundleRef.current;
    const ids = [...pendingDerived.current];
    pendingDerived.current.clear();
    if (!b || !ids.length) return Promise.resolve();
    return persistDerived(b, computeResults(b), ids).catch(e => console.error('persistDerived', e));
  }, []);
  const scheduleDerived = useCallback((ids: string[]) => {
    ids.forEach(id => pendingDerived.current.add(id));
    if (derivedTimer.current) window.clearTimeout(derivedTimer.current);
    derivedTimer.current = window.setTimeout(() => { void flushDerived(); }, 1500);
  }, [flushDerived]);
  // Leaving the page mid-edit still saves the derived values.
  useEffect(() => () => { void flushDerived(); }, [flushDerived]);

  const apply: Apply = useCallback(build => {
    const cur = bundleRef.current;
    if (!cur) return;
    const m = build(cur);
    if (!m) { toast.error('That value isn’t valid here'); return; }
    bundleRef.current = m.next;
    setBundle(m.next);
    setSaving(s => s + 1);
    m.commit()
      .then(() => {
        setSavedAt(Date.now());
        if (m.next.inq?.id) invalidateShipmentPool(m.next.inq.id);
        // Whole-inquiry FOB pooling means one SKU's CBM can move every SKU's shipping.
        scheduleDerived(m.next.products.map(p => p.id));
      })
      .catch(e => { toast.error(`Couldn’t save: ${e?.message || e}`); void load(); })
      .finally(() => setSaving(s => s - 1));
  }, [load, scheduleDerived]);

  return { bundle, loading, saving, savedAt, load, reload, apply, results, rows, t, scheduleDerived, flushDerived };
}
