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
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { ProductStagePills, SingleStagePill, type StageTrack } from '@/components/ProductStagePills';
import { BulkStageActions } from '@/components/BulkStageActions';
import { GenerateSampleDialog } from '@/components/GenerateSampleDialog';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { UploadParseDialog } from '@/components/UploadParseDialog';
import { QuickAddProductsDialog } from '@/components/QuickAddProductsDialog';
import { CopyProductsDialog } from '@/components/CopyProductsDialog';
import { HardwareSyncDialog } from '@/components/HardwareSyncDialog';
import { getHardwareSyncPlan, applyHardwareSync, type HardwareSyncPlan, type HardwareConflict, type ConflictResolution } from '@/lib/hardware-sync';
import { QuotePriceReviewDialog } from '@/components/QuotePriceReviewDialog';
import { BulkCostingUpdateDialog } from '@/components/BulkCostingUpdateDialog';
import type { QuoteProductInput } from '@/lib/quote-creation';
import { computeProductPriceAndCost, type ProductPriceCostMap } from '@/lib/product-pricing';
import { fmt } from '@/lib/formatters';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';

type Product = {
  id: string; name: string; updated_at: string | null;
  design_stage: string | null; quote_stage: string | null; sample_stage: string | null;
  target_price_usd: number | null; markup_percent: number | null;
  cogs_done: boolean | null; cbm_done: boolean | null; overhead_done: boolean | null;
  shipping_done: boolean | null; revenue_done: boolean | null;
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
};

export function InquiryProductsTab({ inquiryId, initialFilter, onFilterChange, onChange }: Props) {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
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
        .select('id, name, updated_at, design_stage, quote_stage, sample_stage, target_price_usd, markup_percent, cogs_done, cbm_done, overhead_done, shipping_done, revenue_done')
        .eq('customer_rfq_id', inquiryId)
        .order('updated_at', { ascending: false });
      setProducts(data ?? []);
    })();
  }, [inquiryId, refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
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
  }, [products, search, filter]);

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
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={filtered.length > 0 && filtered.every(p => selected.has(p.id))}
                    onCheckedChange={(v) => toggleAll(!!v)}
                  />
                </TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Design</TableHead>
                <TableHead className="text-xs">Quote</TableHead>
                <TableHead className="text-xs">Sample</TableHead>
                <TableHead className="text-xs">Costing</TableHead>
                <TableHead className="text-xs">Updated</TableHead>
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
                      <button className="text-sm font-medium hover:underline text-left" onClick={() => navigate(`/product/${p.id}`)}>
                        {p.name}
                      </button>
                    </TableCell>
                    <TableCell><SingleStagePill track="design" value={p.design_stage} onChange={(s) => handleSetSinglePill(p.id, 'design', s)} /></TableCell>
                    <TableCell><SingleStagePill track="quote" value={p.quote_stage} onChange={(s) => handleSetSinglePill(p.id, 'quote', s)} /></TableCell>
                    <TableCell><SingleStagePill track="sample" value={p.sample_stage} onChange={(s) => handleSetSinglePill(p.id, 'sample', s)} /></TableCell>
                    <TableCell><Badge className={cb.cls} variant="secondary">{cb.label}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.updated_at ? formatDistanceToNow(new Date(p.updated_at), { addSuffix: true }) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate(`/product/${p.id}?tab=costing`)}>Costing</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate(`/product/${p.id}?tab=sample-log`)}>Sample Log</Button>
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent></Card>
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
          quantity: (p as any).quantity ?? null,
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
