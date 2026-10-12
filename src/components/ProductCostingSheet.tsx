// The product page's Costing tab: the Costing Workspace's product panel in page mode.
// It loads the product's whole inquiry (so FOB shipping is pooled exactly as in the
// workspace), makes sure the rows costing needs exist, and saves through the same
// mutations, so the product page and the workspace can never disagree.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProductVendorsPanel } from '@/components/ProductVendorsPanel';
import { ProductPanel } from '@/components/costing-workspace/ProductPanel';
import { useCostingBundle } from '@/hooks/use-costing-bundle';
import { ensureCostingRowsOnOpen, resetAutoCosting } from '@/lib/costing-seed';
import { loadProductBundle } from '@/lib/costing-workspace';

export type ProductCostingSummary = {
  unitPriceInr: number;
  unitPriceUsd: number;
  unitCostInr: number;
  unitCostUsd: number;
  exchangeRate: number;
};

export function ProductCostingSheet({ productId, onSummaryChange }: {
  productId: string;
  /** Reports the live unit cost and price (the product page header shows them). */
  onSummaryChange?: (s: ProductCostingSummary) => void;
}) {
  const loader = useCallback(async () => {
    try {
      await ensureCostingRowsOnOpen(productId);
    } catch (e) {
      console.error('ensureCostingRowsOnOpen', e);
    }
    return loadProductBundle(productId);
  }, [productId]);
  const { bundle, loading, loadError, saving, savedAt, load, reload, apply, rows, scheduleDerived } = useCostingBundle(loader);
  const row = rows.find(r => r.p.id === productId);
  const [recalcing, setRecalcing] = useState(false);

  // Write the engine's values back once on open, so lists elsewhere match what this sheet shows.
  const persistedOnOpen = useRef(false);
  useEffect(() => {
    if (!bundle || persistedOnOpen.current) return;
    persistedOnOpen.current = true;
    scheduleDerived([productId]);
  }, [bundle, productId, scheduleDerived]);

  useEffect(() => {
    if (!row || !onSummaryChange) return;
    onSummaryChange({
      unitPriceInr: row.priceInr,
      unitPriceUsd: row.priceUsd,
      unitCostInr: row.costInr,
      unitCostUsd: row.costUsd,
      exchangeRate: row.r.exchangeRate,
    });
  }, [row?.priceInr, row?.priceUsd, row?.costInr, row?.costUsd, row?.r.exchangeRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const recalculate = async () => {
    setRecalcing(true);
    try {
      const restored = await resetAutoCosting(productId);
      await load();
      scheduleDerived([productId]);
      toast.success(restored > 0 ? `Recalculated auto costs (restored ${restored} row${restored === 1 ? '' : 's'})` : 'Recalculated auto costs');
    } catch (e: any) {
      toast.error(`Couldn’t recalculate: ${e?.message || e}`);
    } finally {
      setRecalcing(false);
    }
  };

  if (loading) return <div className="py-16 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!bundle && loadError) return (
    <div className="py-16 text-center text-sm text-muted-foreground space-y-3">
      <p>Couldn’t load this product’s costing. Nothing was changed.</p>
      <Button variant="outline" size="sm" onClick={() => void reload()}>Retry</Button>
    </div>
  );
  if (!bundle || !row) return <div className="py-16 text-center text-sm text-muted-foreground">This product couldn’t be loaded.</div>;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-[72px]">
            {saving > 0 ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : savedAt ? <><Check className="h-3.5 w-3.5 text-primary" /> Saved</> : null}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bundle.inq?.id && !row.p.archived_at && (
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to={`/inquiry/${bundle.inq.id}/costing?sku=${productId}`}><ExternalLink className="h-3.5 w-3.5" /> Open in costing workspace</Link>
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={recalculate} disabled={recalcing}>
              <RefreshCw className={recalcing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              {recalcing ? 'Recalculating…' : 'Recalculate auto costs'}
            </Button>
          </div>
        </div>
        <ProductPanel row={row} bundle={bundle} apply={apply} page onReload={() => void load()} />
        <ProductVendorsPanel productId={productId} />
      </div>
    </TooltipProvider>
  );
}
