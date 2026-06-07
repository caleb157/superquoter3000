import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, X, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react';
import { computeProductUnitPrices, type ProductUnitPriceMap } from '@/lib/product-pricing';
import type { QuoteProductInput } from '@/lib/quote-creation';
import { fmt } from '@/lib/formatters';
import { convertFromInr, getCachedCurrencyMap, loadCurrencyMap } from '@/lib/currency';

type SelectedProduct = {
  id: string;
  name: string;
  quantity?: number | null;
  target_price_usd?: number | null;
  markup_percent?: number | null;
  // Assembly support: when true, `id` is product_assemblies.id and we skip
  // variant lookup + use the supplied reference price directly.
  is_assembly?: boolean;
  reference_price_usd?: number | null;
  // For assemblies: the USD-equivalent reference price (so the review dialog can
  // show "{currency} ({usd})" alongside non-USD references).
  reference_price_usd_only?: number | null;
};

type Variant = {
  id: string;
  product_id: string;
  variant_name: string;
  wood_price_factor: number | null;
  photo_url: string | null;
};

type LineDraft = {
  key: string;
  product_id: string;
  display_name: string;
  quantity: number;
  price: string; // editable price in chosen currency
  reference_price: number; // calculated reference in chosen currency
  reference_price_usd: number; // calculated reference in USD (for alongside display)
  variant_id?: string | null;
  variant_name?: string | null;
  variant_photo_url?: string | null;
  is_assembly?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProducts: SelectedProduct[];
  currency: string;
  onConfirm: (lines: QuoteProductInput[]) => void;
  saving?: boolean;
};

export function QuotePriceReviewDialog({ open, onOpenChange, selectedProducts, currency, onConfirm, saving }: Props) {
  const [prices, setPrices] = useState<ProductUnitPriceMap>({});
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, Variant[]>>({});
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fmtMoney = (n: number) => fmt.money(n, currency);
  // Prime currency map so conversions are accurate after first render
  useEffect(() => { loadCurrencyMap(); }, []);

  // Load calculated prices + variants whenever the dialog opens with a new selection
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    // Only fetch prices/variants for real product ids (not assemblies)
    const productIds = selectedProducts.filter(p => !p.is_assembly).map(p => p.id);
    (async () => {
      const [priceMap, variantsRes] = await Promise.all([
        productIds.length > 0 ? computeProductUnitPrices(productIds) : Promise.resolve({} as ProductUnitPriceMap),
        productIds.length > 0
          ? supabase.from('product_variants').select('id, product_id, variant_name, wood_price_factor, photo_url').in('product_id', productIds).order('created_at')
          : Promise.resolve({ data: [] } as any),
      ]);
      setPrices(priceMap);
      const byProd: Record<string, Variant[]> = {};
      (variantsRes.data || []).forEach((v: any) => {
        if (!byProd[v.product_id]) byProd[v.product_id] = [];
        byProd[v.product_id].push(v as Variant);
      });
      setVariantsByProduct(byProd);

      const drafts: LineDraft[] = selectedProducts.map(p => {
        const ref = p.is_assembly
          ? Number(p.reference_price_usd ?? 0) // already in display currency, set by caller
          : referencePriceFor(p, priceMap, currency);
        const refUsd = p.is_assembly
          ? Number(p.reference_price_usd_only ?? 0)
          : referencePriceUsd(p, priceMap);
        return {
          key: `base-${p.id}`,
          product_id: p.id,
          display_name: p.name,
          quantity: Number(p.quantity ?? 0),
          price: ref ? ref.toFixed(2) : '',
          reference_price: ref,
          reference_price_usd: refUsd,
          is_assembly: !!p.is_assembly,
        };
      });
      setLines(drafts);
      setLoaded(true);
    })();
  }, [open, selectedProducts.map(p => p.id).join('|'), currency]);

  const totals = useMemo(() => {
    const skus = lines.length;
    const qty = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
    const grand = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.price || 0), 0);
    return { skus, qty, grand };
  }, [lines]);

  const update = (key: string, patch: Partial<LineDraft>) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  };

  const addVariantLine = (productId: string, v: Variant) => {
    const base = lines.find(l => l.product_id === productId && !l.variant_id);
    const baseRef = base?.reference_price || referencePriceFor(selectedProducts.find(p => p.id === productId)!, prices, currency);
    const baseRefUsd = base?.reference_price_usd || referencePriceUsd(selectedProducts.find(p => p.id === productId)!, prices);
    const factor = v.wood_price_factor ?? 1;
    // Quick estimate: scale base reference by the wood factor. User can adjust.
    const estimated = baseRef ? baseRef * factor : 0;
    const estimatedUsd = baseRefUsd ? baseRefUsd * factor : 0;
    const baseName = selectedProducts.find(p => p.id === productId)?.name || '';
    setLines(prev => [
      ...prev,
      {
        key: `var-${v.id}-${Date.now()}`,
        product_id: productId,
        display_name: `${baseName} — ${v.variant_name}`,
        quantity: base?.quantity ?? 0,
        price: estimated ? estimated.toFixed(2) : '',
        reference_price: estimated,
        reference_price_usd: estimatedUsd,
        variant_id: v.id,
        variant_name: v.variant_name,
        variant_photo_url: v.photo_url,
      },
    ]);
  };

  const removeLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key));

  const resetPrice = (key: string) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, price: l.reference_price ? l.reference_price.toFixed(2) : '' } : l));
  };

  const handleConfirm = () => {
    if (lines.length === 0) return;
    const payload: QuoteProductInput[] = lines.map(l => ({
      id: l.product_id,
      name: l.display_name,
      quantity: Number(l.quantity || 0),
      unit_price_override: Number(l.price || 0),
      display_name: l.display_name,
      display_photo_url: l.variant_photo_url ?? null,
      variant_id: l.variant_id ?? null,
      variant_name: l.variant_name ?? null,
      assembly_id: l.is_assembly ? l.product_id : null,
    }));
    onConfirm(payload);
  };

  // Group lines by product so variant rows render under their parent
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map: Record<string, LineDraft[]> = {};
    for (const l of lines) {
      if (!map[l.product_id]) { map[l.product_id] = []; order.push(l.product_id); }
      map[l.product_id].push(l);
    }
    return order.map(pid => ({ pid, items: map[pid] }));
  }, [lines]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review prices & variants</DialogTitle>
          <DialogDescription>
            Set the price for each line. The calculated unit price is shown for reference. Add wood variants as separate lines if you want to quote alternative materials.
          </DialogDescription>
        </DialogHeader>

        {!loaded ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading prices…</div>
        ) : (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {grouped.map((group, gi) => {
              const variants = variantsByProduct[group.pid] || [];
              const baseName = selectedProducts.find(p => p.id === group.pid)?.name || '';
              const usedVariantIds = new Set(group.items.map(i => i.variant_id).filter(Boolean) as string[]);
              const availableVariants = variants.filter(v => !usedVariantIds.has(v.id));
              const moveGroup = (dir: -1 | 1) => {
                const order = grouped.map(g => g.pid);
                const swap = gi + dir;
                if (swap < 0 || swap >= order.length) return;
                [order[gi], order[swap]] = [order[swap], order[gi]];
                setLines(prev => {
                  const buckets: Record<string, typeof prev> = {};
                  for (const l of prev) {
                    (buckets[l.product_id] ||= []).push(l);
                  }
                  return order.flatMap(pid => buckets[pid] || []);
                });
              };
              return (
                <div key={group.pid} className="rounded-md border p-3 space-y-2 bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold truncate">{baseName}</div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                        title="Move up" onClick={() => moveGroup(-1)} disabled={gi === 0}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                        title="Move down" onClick={() => moveGroup(1)} disabled={gi === grouped.length - 1}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {group.items.map(line => (
                    <div key={line.key} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <Label className="text-[10px] text-muted-foreground">
                          {line.variant_id ? 'Variant line' : 'Display name'}
                        </Label>
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={line.display_name}
                            onChange={e => update(line.key, { display_name: e.target.value })}
                            className="h-8 text-xs"
                          />
                          {line.variant_name && (
                            <Badge variant="secondary" className="text-[10px] shrink-0">{line.variant_name}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[10px] text-muted-foreground">Qty</Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={line.quantity}
                          onChange={e => update(line.key, { quantity: Number(e.target.value) })}
                          className="h-8 text-xs text-right"
                        />
                      </div>
                      <div className="col-span-3">
                        <Label className="text-[10px] text-muted-foreground">
                          Unit price ({currency}) <span className="text-muted-foreground/70">· ref {fmtMoney(line.reference_price)}</span>
                        </Label>
                        <Input
                          type="number"
                          step="any"
                          value={line.price}
                          onChange={e => update(line.key, { price: e.target.value })}
                          className="h-8 text-xs text-right"
                        />
                      </div>
                      <div className="col-span-2 flex items-center gap-1 justify-end pb-0.5">
                        <Button
                          type="button" variant="ghost" size="icon" className="h-7 w-7"
                          title="Reset to calculated price"
                          onClick={() => resetPrice(line.key)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        {(line.variant_id || group.items.length > 1) && (
                          <Button
                            type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                            title="Remove line"
                            onClick={() => removeLine(line.key)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}

                  {availableVariants.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="text-[10px] text-muted-foreground self-center">Add as separate line:</span>
                      {availableVariants.map(v => (
                        <Button
                          key={v.id}
                          type="button" variant="outline" size="sm"
                          className="h-6 text-[11px] gap-1"
                          onClick={() => addVariantLine(group.pid, v)}
                        >
                          <Plus className="h-3 w-3" /> {v.variant_name}
                          {v.wood_price_factor != null && v.wood_price_factor !== 1 && (
                            <span className="text-muted-foreground">({v.wood_price_factor}×)</span>
                          )}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {totals.skus} line{totals.skus === 1 ? '' : 's'} · {totals.qty.toLocaleString()} units · <span className="font-semibold text-foreground">{fmtMoney(totals.grand)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={!loaded || saving || lines.length === 0}>
              {saving ? 'Creating…' : 'Create quote draft'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function referencePriceUsd(p: SelectedProduct, prices: ProductUnitPriceMap): number {
  const entry = prices[p.id];
  const supplied = Number(p.reference_price_usd ?? p.target_price_usd ?? 0);
  if (supplied > 0) return supplied;
  return Number(entry?.unit_price_usd) || 0;
}

function referencePriceFor(p: SelectedProduct, prices: ProductUnitPriceMap, currency: string): number {
  const entry = prices[p.id];
  const fx = entry?.exchange_rate ?? Object.values(prices)[0]?.exchange_rate ?? 90;
  const map = getCachedCurrencyMap();
  const supplied = Number(p.reference_price_usd ?? p.target_price_usd ?? 0);
  if (supplied > 0) {
    // supplied is USD; convert to display currency
    if (currency === 'USD') return supplied;
    const inr = supplied * fx;
    return currency === 'INR' ? inr : convertFromInr(map, inr, currency, 'import');
  }
  if (entry && (entry.unit_price_usd > 0 || entry.unit_price_inr > 0)) {
    if (currency === 'INR') return entry.unit_price_inr;
    if (currency === 'USD') return entry.unit_price_usd;
    return convertFromInr(map, entry.unit_price_inr, currency, 'import');
  }
  return 0;
}
