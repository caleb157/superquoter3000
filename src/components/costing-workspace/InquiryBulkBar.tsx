// The Costing Workspace's selection bar, on the inquiry page: tick SKUs in the Products tab
// and set a field, add price-list items, adjust a cost or price to target without opening the
// workspace. Same bundle, mutations and undo as the workspace (useCostingBundle); the costing
// is only loaded once something is ticked.
import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCostingBundle } from '@/hooks/use-costing-bundle';
import { loadBundle } from '@/lib/costing-workspace';
import { BulkBar } from './BulkBar';

export function InquiryBulkBar({ inquiryId, ids, onClear, onChanged, reloadKey }: {
  inquiryId: string;
  /** The ticked product ids. */
  ids: string[];
  onClear: () => void;
  /** A change was saved: the page should refresh its prices. */
  onChanged: () => void;
  /** Changes when the page's own data changed (a dialog, an import), so the costing is read again. */
  reloadKey: string | number;
}) {
  const loader = useCallback(() => loadBundle(inquiryId), [inquiryId]);
  const { bundle, loading, loadError, rows, apply, saving, savedAt, undo, canUndo, reload } = useCostingBundle(loader);

  // Tell the page once a save has landed; ignore the refresh that this causes.
  const ownSave = useRef(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    if (!savedAt || saving > 0) return;
    ownSave.current = Date.now();
    changed.current();
  }, [savedAt, saving]);
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    if (saving > 0 || Date.now() - ownSave.current < 2500) return;
    void reload();
  }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const inBundle = bundle ? ids.filter(id => rows.some(r => r.p.id === id)) : [];
  const shell = 'pointer-events-none fixed inset-x-4 bottom-5 z-30 hidden md:block';
  const pill = 'pointer-events-auto mx-auto flex w-fit items-center gap-2 rounded-xl border bg-card/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur';

  if (loading) return <div className={shell}><div className={pill}><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> Loading costing for the {ids.length} selected…</div></div>;
  if (!bundle) {
    if (!loadError) return null;
    return <div className={shell}><div className={pill}>Couldn’t load costing for bulk changes. <Button size="sm" variant="outline" className="h-7" onClick={() => void reload()}>Retry</Button></div></div>;
  }
  if (!inBundle.length) return null;

  return (
    <div className={shell}>
      <BulkBar ids={inBundle} rows={rows} bundle={bundle} apply={apply} onClear={onClear}
        extra={(
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {saving > 0 ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : savedAt ? <><Check className="h-3.5 w-3.5 text-primary" /> Saved</> : null}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="outline" className="h-8 w-8" disabled={!canUndo} aria-label="Undo"
                  onClick={() => { if (undo()) toast('Undone'); }}>
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo the last bulk change made from this bar</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="sm" variant="ghost" className="h-8 gap-1.5">
                  <Link to={`/inquiry/${inquiryId}/costing?select=${inBundle.join(',')}`}><ExternalLink className="h-3.5 w-3.5" /> Full sheet</Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open these SKUs in the costing workspace</TooltipContent>
            </Tooltip>
          </div>
        )} />
    </div>
  );
}
