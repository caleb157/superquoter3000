import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Upload, X, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { ProductStagePills, SingleStagePill, type StageTrack } from '@/components/ProductStagePills';
import { BulkStageActions } from '@/components/BulkStageActions';
import { GenerateSampleDialog } from '@/components/GenerateSampleDialog';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { UploadParseDialog } from '@/components/UploadParseDialog';
import { QuickAddProductsDialog } from '@/components/QuickAddProductsDialog';
import { CopyProductsDialog } from '@/components/CopyProductsDialog';
import { CopyProductsToInquiryDialog } from '@/components/CopyProductsToInquiryDialog';
import { HardwareSyncDialog } from '@/components/HardwareSyncDialog';
import { getHardwareSyncPlan, applyHardwareSync, type HardwareSyncPlan, type HardwareConflict, type ConflictResolution } from '@/lib/hardware-sync';
import { QuotePriceReviewDialog } from '@/components/QuotePriceReviewDialog';
import { BulkCostingUpdateDialog } from '@/components/BulkCostingUpdateDialog';
import { BulkQuantityDialog } from '@/components/BulkQuantityDialog';
import { BulkLogRfqRfsDialog } from '@/components/BulkLogRfqRfsDialog';
import type { QuoteProductInput } from '@/lib/quote-creation';
import { fmt } from '@/lib/formatters';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';
import { computeProductPriceAndCost, type ProductPriceCostMap } from '@/lib/product-pricing';

type Product = {
  id: string; name: string; sku: string | null; photo_url: string | null; updated_at: string | null;
  quantity: number | null;
  design_stage: string | null; quote_stage: string | null; sample_stage: string | null;
  target_price_usd: number | null; markup_percent: number | null;
  cogs_done: boolean | null; cbm_done: boolean | null; overhead_done: boolean | null;
  shipping_done: boolean | null; revenue_done: boolean | null;
  calculated_unit_price_usd: number | null;
  sample_stage_was?: string | null;
};

type FilterKey =
  | 'all' | 'needs_design' | 'in_costing' | 'sampling'
  // raw stage filters (from dashboard stage-pill links)
  | 'need_design' | 'designed'
  | 'quoting' | 'ready_for_quote' | 'quoted';

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_design', label: 'Needs Design' },
  { key: 'in_costing', label: 'In Costing' },
  { key: 'sampling', label: 'Sampling' },
];

const RAW_STAGE_LABELS: Partial<Record<FilterKey, string>> = {
  need_design: 'Need design',
  designed: 'Designed',
  quoting: 'Quoting',
  ready_for_quote: 'Ready for quote',
  quoted: 'Quoted',
};

function costingBadge(p: Product): { label: string; cls: string } {
  const flags = [p.cbm_done, p.cogs_done, p.overhead_done, p.shipping_done, p.revenue_done];
  const done = flags.filter(Boolean).length;
  if (done === 5) {
    return { label: 'Priced', cls: 'bg-emerald-100 text-emerald-700' };
  }
  if (done > 0) {
    return { label: `In Progress (${done}/5)`, cls: 'bg-amber-100 text-amber-700' };
  }
  return { label: 'Empty', cls: 'bg-muted text-muted-foreground' };
}

type Props = {
  inquiryId: string;
  initialFilter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  onChange: () => void; // refetch trigger for cards/quotes/samples
  refreshKey?: number;
};

export function InquiryProductsTab({ inquiryId, initialFilter, onFilterChange, onChange, refreshKey = 0 }: Props) {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [livePrices, setLivePrices] = useState<ProductPriceCostMap>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [hwPlan, setHwPlan] = useState<HardwareSyncPlan | null>(null);
  const [hwOpen, setHwOpen] = useState(false);
  const [hwEntityId, setHwEntityId] = useState<string>('');
  const [hwEntityName, setHwEntityName] = useState<string>('');
  const [hwCurrency, setHwCurrency] = useState<'USD' | 'INR'>('USD');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [pendingLines, setPendingLines] = useState<QuoteProductInput[] | null>(null);
  const [bulkCostingOpen, setBulkCostingOpen] = useState(false);
  const [bulkQtyOpen, setBulkQtyOpen] = useState(false);
  const [logRfqOpen, setLogRfqOpen] = useState(false);
  const [logRfsOpen, setLogRfsOpen] = useState(false);
  const [copyToOpen, setCopyToOpen] = useState(false);
  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<Product>({
    storageKey: `inquiry-products-sort:${inquiryId}`,
    defaultColumn: 'name',
    defaultDirection: 'asc',
  });

  const displayPriceUsd = (p: Product) => {
    const live = livePrices[p.id]?.unit_price_usd;
    if (live && live > 0) return live;
    return Number(p.calculated_unit_price_usd ?? p.target_price_usd ?? 0);
  };

  useEffect(() => {
    supabase.from('product_types').select('id, name').order('name').then(({ data }) => {
      if (data) setProductTypes(data);
    });
  }, []);

  useEffect(() => { setFilter(initialFilter); }, [initialFilter]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, sku, photo_url, quantity, updated_at, design_stage, quote_stage, sample_stage, target_price_usd, markup_percent, cogs_done, cbm_done, overhead_done, shipping_done, revenue_done, calculated_unit_price_usd')
        .eq('customer_rfq_id', inquiryId)
        .order('updated_at', { ascending: false });
      const rows = data ?? [];
      setProducts(rows);
      if (rows.length > 0) {
        const prices = await computeProductPriceAndCost(rows.map((p: any) => p.id));
        setLivePrices(prices);
      } else {
        setLivePrices({});
      }
    })();
  }, [inquiryId, refresh, refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = products.filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (filter === 'needs_design') return p.design_stage === 'need_design';
      if (filter === 'in_costing') {
        const flags = [p.cbm_done, p.cogs_done, p.overhead_done, p.shipping_done, p.revenue_done];
        const done = flags.filter(Boolean).length;
        // In costing = any quoting stage, OR partial costing progress (started but not all 5 done)
        return p.quote_stage === 'quoting' || p.quote_stage === 'ready_for_quote' || (done > 0 && done < 5);
      }
      if (filter === 'sampling') return p.sample_stage === 'sampling';
      // Raw stage matches (from dashboard stage-pill links)
      if (filter === 'need_design' || filter === 'designed') return p.design_stage === filter;
      if (filter === 'quoting' || filter === 'ready_for_quote' || filter === 'quoted') return p.quote_stage === filter;
      return true;
    });
    return sortItems(base, {
      name: (p) => (p.name || '').toLowerCase(),
      price: displayPriceUsd,
      updated: (p) => p.updated_at ? new Date(p.updated_at).getTime() : 0,
    });
  }, [products, search, filter, sortItems]);

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(filtered.map(p => p.id)) : new Set());
  };
  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const handleSetStage = async (track: StageTrack, stage: string | null) => {
    const ids = Array.from(selected);
    const col = track === 'design' ? 'design_stage' : track === 'quote' ? 'quote_stage' : 'sample_stage';
    const { error } = await (supabase as any).from('products').update({ [col]: stage }).in('id', ids);
    if (error) { toast.error(error.message); return; }
    // When bulk-marking products as 'sampled', also complete any pending samples in the sample log
    if (track === 'sample' && stage === 'sampled') {
      const { error: sErr } = await (supabase as any)
        .from('samples')
        .update({ status: 'completed' })
        .in('product_id', ids)
        .eq('status', 'pending');
      if (sErr) { toast.error('Products updated, but failed to complete samples: ' + sErr.message); }
    }
    toast.success(`Updated ${ids.length} product${ids.length === 1 ? '' : 's'}`);
    setRefresh(r => r + 1);
    onChange();
  };

  const handleSetSinglePill = async (productId: string, track: StageTrack, stage: string | null) => {
    const col = track === 'design' ? 'design_stage' : track === 'quote' ? 'quote_stage' : 'sample_stage';
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, [col]: stage } : p));
    const { error } = await (supabase as any).from('products').update({ [col]: stage }).eq('id', productId);
    if (error) { toast.error(error.message); setRefresh(r => r + 1); return; }
    onChange();
  };

  const handleGenerateQuote = async () => {
    const selectedProductsLocal = products.filter(p => selected.has(p.id));
    if (selectedProductsLocal.length === 0) return;
    const [{ data: entities }, { data: inq }] = await Promise.all([
      supabase.from('company_entities').select('id, name').order('name'),
      (supabase as any).from('customer_rfqs').select('quoting_entity_id, quoting_currency').eq('id', inquiryId).maybeSingle(),
    ]);
    if (!entities || entities.length === 0) {
      toast.error('Set up a Company Entity in Settings before generating quotes.');
      return;
    }
    const preferredEntity = inq?.quoting_entity_id && entities.find(e => e.id === inq.quoting_entity_id)
      ? entities.find(e => e.id === inq.quoting_entity_id)!
      : entities[0];
    const cur = (inq?.quoting_currency as 'USD' | 'INR') || 'USD';
    setHwEntityId(preferredEntity.id);
    setHwEntityName(preferredEntity.name);
    setHwCurrency(cur);
    // Open the price-review dialog first so the user can confirm/override prices
    // and add variants as separate lines before we run hardware sync + create the snapshot.
    setPendingLines(null);
    setReviewOpen(true);
  };

  // Called when the user confirms the price-review dialog
  const handleReviewConfirm = async (lines: QuoteProductInput[]) => {
    setPendingLines(lines);
    setReviewSaving(true);
    const productIds = Array.from(new Set(lines.map(l => l.id)));
    const plan = await getHardwareSyncPlan(productIds);
    if (plan.newItems.length === 0 && plan.conflicts.length === 0) {
      await finalizeQuote(hwEntityId, hwEntityName, plan, [], hwCurrency, lines);
      return;
    }
    setHwPlan(plan);
    setReviewOpen(false);
    setReviewSaving(false);
    setHwOpen(true);
  };

  const finalizeQuote = async (
    entityId: string,
    entityName: string,
    plan: HardwareSyncPlan,
    resolved: Array<HardwareConflict & { resolution: ConflictResolution }>,
    currency: 'USD' | 'INR' = 'USD',
    lines?: QuoteProductInput[],
  ) => {
    if (plan.newItems.length || resolved.some(r => r.resolution === 'update')) {
      const sync = await applyHardwareSync(plan.newItems, resolved);
      if (sync.error) { toast.error('Hardware sync failed: ' + sync.error); return; }
      if (sync.added || sync.updated) {
        toast.success(`Hardware library: +${sync.added} added, ${sync.updated} updated`);
      }
    }
    const linesToUse = lines ?? pendingLines ?? products
      .filter(p => selected.has(p.id))
      .map(p => ({ id: p.id, name: p.name, target_price_usd: p.target_price_usd, markup_percent: p.markup_percent } as QuoteProductInput));
    const { createQuoteSnapshot, defaultValidUntil } = await import('@/lib/quote-creation');
    const result = await createQuoteSnapshot({
      inquiryId,
      selectedProducts: linesToUse,
      entityId,
      validUntil: defaultValidUntil(),
      currency,
    });
    setHwOpen(false);
    setHwPlan(null);
    setReviewOpen(false);
    setReviewSaving(false);
    setPendingLines(null);
    if (result.error) { toast.error(result.error); return; }
    toast.success(`Quote draft created with ${entityName} (${currency})`);
    setSelected(new Set());
    onChange();
  };

  const selectedProducts = products.filter(p => selected.has(p.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTER_CHIPS.map(c => (
            <Button
              key={c.key}
              variant={filter === c.key ? 'secondary' : 'ghost'}
              size="sm" className="h-8 text-xs"
              onClick={() => { setFilter(c.key); onFilterChange(c.key); }}
            >{c.label}</Button>
          ))}
          {RAW_STAGE_LABELS[filter] && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs gap-1 bg-primary/10 text-primary hover:bg-primary/20"
              onClick={() => { setFilter('all'); onFilterChange('all'); }}
            >
              {RAW_STAGE_LABELS[filter]} <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setQuickAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add products
          </Button>
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setCopyOpen(true)}>
            <Copy className="h-4 w-4" /> Copy from existing
          </Button>
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" /> Upload & parse
          </Button>
        </div>
      </div>

      <CopyProductsDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        targetInquiryId={inquiryId}
        onCopied={() => { setRefresh(r => r + 1); onChange(); }}
      />

      <UploadParseDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        inquiryId={inquiryId}
        productTypes={productTypes}
        onProductsCreated={() => { setRefresh(r => r + 1); onChange(); }}
      />

      <QuickAddProductsDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        inquiryId={inquiryId}
        onCreated={() => { setRefresh(r => r + 1); onChange(); }}
      />

      <BulkStageActions
        selectedIds={Array.from(selected)}
        onClear={() => setSelected(new Set())}
        onSetStage={handleSetStage}
        onGenerateQuote={handleGenerateQuote}
        onGenerateSamples={() => setBatchOpen(true)}
        onBulkCosting={() => setBulkCostingOpen(true)}
        onBulkQuantity={() => setBulkQtyOpen(true)}
        onLogRfq={() => setLogRfqOpen(true)}
        onLogRfs={() => setLogRfsOpen(true)}
        onCopyToInquiry={() => setCopyToOpen(true)}
      />

      <CopyProductsToInquiryDialog
        open={copyToOpen}
        onOpenChange={setCopyToOpen}
        sourceInquiryId={inquiryId}
        productIds={Array.from(selected)}
        productNames={selectedProducts.map(p => p.name)}
        onCopied={() => { setSelected(new Set()); }}
      />

      <BulkLogRfqRfsDialog
        open={logRfqOpen}
        onOpenChange={setLogRfqOpen}
        kind="rfq"
        inquiryId={inquiryId}
        selectedProductIds={Array.from(selected)}
        onDone={() => { setSelected(new Set()); setRefresh(r => r + 1); onChange(); }}
      />

      <BulkLogRfqRfsDialog
        open={logRfsOpen}
        onOpenChange={setLogRfsOpen}
        kind="rfs"
        inquiryId={inquiryId}
        selectedProductIds={Array.from(selected)}
        onDone={() => { setSelected(new Set()); setRefresh(r => r + 1); onChange(); }}
      />

      <BulkQuantityDialog
        open={bulkQtyOpen}
        onOpenChange={setBulkQtyOpen}
        selectedProductIds={Array.from(selected)}
        onApplied={() => { setRefresh(r => r + 1); onChange(); }}
      />

      <BulkCostingUpdateDialog
        open={bulkCostingOpen}
        onOpenChange={setBulkCostingOpen}
        selectedProductIds={Array.from(selected)}
        selectedProductNames={selectedProducts.map(p => p.name)}
        onApplied={() => { setRefresh(r => r + 1); onChange(); }}
      />

      {filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No products in this inquiry yet.
        </CardContent></Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block"><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={filtered.length > 0 && filtered.every(p => selected.has(p.id))}
                    onCheckedChange={(v) => toggleAll(!!v)}
                  />
                </TableHead>
                <SortableHeader column="name" label="Name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                <TableHead className="text-xs">Design</TableHead>
                <TableHead className="text-xs">Quote</TableHead>
                <TableHead className="text-xs">Sample</TableHead>
                <TableHead className="text-xs">Costing</TableHead>
                <SortableHeader column="price" label="Unit Price" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                <SortableHeader column="updated" label="Updated" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => {
                const cb = costingBadge(p);
                return (
                  <TableRow key={p.id} className={cn(selected.has(p.id) && 'bg-muted/40')}>
                    <TableCell>
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggleOne(p.id, !!v)} />
                    </TableCell>
                    <TableCell>
                      <button className="text-sm font-medium hover:underline text-left flex flex-col items-start" onClick={() => navigate(`/product/${p.id}`)}>
                        <span>{p.name}</span>
                        {p.sku && <span className="italic text-[11px] font-normal text-muted-foreground/70">{p.sku}</span>}
                      </button>
                    </TableCell>
                    <TableCell><SingleStagePill track="design" value={p.design_stage} onChange={(s) => handleSetSinglePill(p.id, 'design', s)} /></TableCell>
                    <TableCell><SingleStagePill track="quote" value={p.quote_stage} onChange={(s) => handleSetSinglePill(p.id, 'quote', s)} /></TableCell>
                    <TableCell><SingleStagePill track="sample" value={p.sample_stage} onChange={(s) => handleSetSinglePill(p.id, 'sample', s)} /></TableCell>
                    <TableCell><Badge className={cb.cls} variant="secondary">{cb.label}</Badge></TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {displayPriceUsd(p) ? fmt.usd(displayPriceUsd(p)) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.updated_at ? formatDistanceToNow(new Date(p.updated_at), { addSuffix: true }) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <ConfirmDeleteButton
                        itemLabel={`product "${p.name}"`}
                        iconOnly
                        onConfirm={async () => {
                          const { error } = await supabase.from('products').delete().eq('id', p.id);
                          if (error) throw error;
                          setRefresh(r => r + 1);
                          onChange();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </CardContent></Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map(p => {
              const cb = costingBadge(p);
              const isSelected = selected.has(p.id);
              return (
                <Card
                  key={p.id}
                  className={cn(
                    'cursor-pointer active:bg-accent/50 transition-colors',
                    isSelected && 'ring-2 ring-primary',
                  )}
                  onClick={() => navigate(`/product/${p.id}`)}
                >
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div onClick={e => e.stopPropagation()} className="pt-0.5">
                        <Checkbox checked={isSelected} onCheckedChange={(v) => toggleOne(p.id, !!v)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate">{p.name}</div>
                        {p.sku && <div className="italic text-[11px] text-muted-foreground/70 truncate">{p.sku}</div>}
                        <div className="text-[11px] text-muted-foreground">
                          {p.updated_at ? formatDistanceToNow(new Date(p.updated_at), { addSuffix: true }) : '—'}
                        </div>
                      </div>
                      <Badge className={cn(cb.cls, 'text-[10px] shrink-0')} variant="secondary">{cb.label}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <SingleStagePill track="design" value={p.design_stage} onChange={(s) => handleSetSinglePill(p.id, 'design', s)} />
                      <SingleStagePill track="quote" value={p.quote_stage} onChange={(s) => handleSetSinglePill(p.id, 'quote', s)} />
                      <SingleStagePill track="sample" value={p.sample_stage} onChange={(s) => handleSetSinglePill(p.id, 'sample', s)} />
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t text-[11px]">
                      <span className="font-mono tabular-nums font-medium">
                        {displayPriceUsd(p) ? fmt.usd(displayPriceUsd(p)) : '—'}
                      </span>
                      <div onClick={e => e.stopPropagation()}>
                        <ConfirmDeleteButton
                          itemLabel={`product "${p.name}"`}
                          iconOnly
                          onConfirm={async () => {
                            const { error } = await supabase.from('products').delete().eq('id', p.id);
                            if (error) throw error;
                            setRefresh(r => r + 1);
                            onChange();
                          }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <GenerateSampleDialog
        open={batchOpen} onOpenChange={setBatchOpen}
        inquiryId={inquiryId}
        preSelectedProductIds={selectedProducts.map(p => p.id)}
        onCreated={() => { setSelected(new Set()); setRefresh(r => r + 1); onChange(); }}
      />
      <QuotePriceReviewDialog
        open={reviewOpen}
        onOpenChange={(o) => { if (!o) { setReviewOpen(false); setReviewSaving(false); } }}
        selectedProducts={selectedProducts.map(p => ({
          id: p.id,
          name: p.name,
          quantity: p.quantity ?? null,
          reference_price_usd: displayPriceUsd(p),
          target_price_usd: p.target_price_usd,
          markup_percent: p.markup_percent,
        }))}
        currency={hwCurrency}
        onConfirm={handleReviewConfirm}
        saving={reviewSaving}
      />
      <HardwareSyncDialog
        open={hwOpen}
        plan={hwPlan}
        onCancel={() => { setHwOpen(false); setHwPlan(null); setPendingLines(null); }}
        onConfirm={(resolved) => { if (hwPlan) finalizeQuote(hwEntityId, hwEntityName, hwPlan, resolved, hwCurrency, pendingLines || undefined); }}
      />
    </div>
  );
}

export type { FilterKey as ProductFilterKey };
