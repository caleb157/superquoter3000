// Shared state for anything that edits costing through the workspace bundle (the inquiry
// Costing Workspace and the product Costing tab): load, apply mutations optimistically,
// write through, and persist engine-derived values a moment after edits settle. Every
// applied edit is kept as a before/after pair so it can be undone and redone.
import { quoteCurrencyOf } from '@/lib/quote-currency';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { invalidateShipmentPool } from '@/lib/shipment-pool';
import {
  buildRows, computeResults, persistDerived, restoreRows, totals,
  type Apply, type Bundle,
} from '@/lib/costing-workspace';

const MAX_HISTORY = 100;
type Step = { before: Bundle; after: Bundle };

export function useCostingBundle(loader: (() => Promise<Bundle | null>) | null) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** Set when the last load failed. The previous bundle (if any) is kept, so nothing is recomputed from partial data. */
  const [loadError, setLoadError] = useState<string | null>(null);

  // Undo history since the last load. Reloading starts fresh: the figures may have moved underneath.
  const undoStack = useRef<Step[]>([]);
  const redoStack = useRef<Step[]>([]);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const syncHistory = () => setHistorySize({ undo: undoStack.current.length, redo: redoStack.current.length });

  const load = useCallback(async () => {
    if (!loader) return;
    undoStack.current = []; redoStack.current = []; setHistorySize({ undo: 0, redo: 0 });
    try {
      const b = await loader();
      bundleRef.current = b;
      setBundle(b);
      setLoadError(null);
    } catch (e: any) {
      console.error('costing load', e);
      setLoadError(e?.message || String(e));
      if (bundleRef.current) toast.error('Couldn’t reload costing. Showing the last loaded figures.');
    } finally {
      setLoading(false);
    }
  }, [loader]);
  useEffect(() => { void load(); }, [load]);
  /** Load again from the database, showing the loading state. */
  const reload = useCallback(() => { setLoading(true); return load(); }, [load]);

  const results = useMemo(() => (bundle ? computeResults(bundle) : new Map()), [bundle]);
  const rows = useMemo(() => (bundle ? buildRows(bundle, results) : []), [bundle, results]);
  const t = useMemo(() => totals(rows, quoteCurrencyOf(bundle?.inq)), [rows, bundle?.inq]);

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

  const run = useCallback((build: Parameters<Apply>[0], record: 'edit' | 'undo' | 'redo' | null) => {
    const cur = bundleRef.current;
    if (!cur) return false;
    const m = build(cur);
    if (!m) { if (record === 'edit') toast.error('That value isn’t valid here'); return false; }
    if (record === 'edit') {
      undoStack.current = [...undoStack.current, { before: cur, after: m.next }].slice(-MAX_HISTORY);
      redoStack.current = [];
      syncHistory();
    }
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
    return true;
  }, [load, scheduleDerived]);

  const apply: Apply = useCallback(build => { run(build, 'edit'); }, [run]);

  /** Put back the last edit (Ctrl+Z). Returns false when there is nothing to undo. */
  const undo = useCallback(() => {
    const step = undoStack.current[undoStack.current.length - 1];
    if (!step) return false;
    undoStack.current = undoStack.current.slice(0, -1);
    run(cur => restoreRows(cur, step.before, step.after), 'undo');
    redoStack.current = [...redoStack.current, step];
    syncHistory();
    return true;
  }, [run]);
  /** Re-apply the last undone edit (Ctrl+Y / Ctrl+Shift+Z). */
  const redo = useCallback(() => {
    const step = redoStack.current[redoStack.current.length - 1];
    if (!step) return false;
    redoStack.current = redoStack.current.slice(0, -1);
    run(cur => restoreRows(cur, step.after, step.before), 'redo');
    undoStack.current = [...undoStack.current, step];
    syncHistory();
    return true;
  }, [run]);

  return {
    bundle, loading, loadError, saving, savedAt, load, reload, apply, results, rows, t, scheduleDerived, flushDerived,
    undo, redo, canUndo: historySize.undo > 0, canRedo: historySize.redo > 0,
  };
}
