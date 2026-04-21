import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { ProductStagePills, type StageTrack } from '@/components/ProductStagePills';
import { BulkStageActions } from '@/components/BulkStageActions';
import { NewSampleBatchDialog } from '@/components/NewSampleBatchDialog';

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
  | 'quoting' | 'ready_for_quote' | 'quoted'
  | 'sample_sent';

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
  sample_sent: 'Sample sent',
};

function costingBadge(p: Product): { label: string; cls: string } {
  if (p.target_price_usd && Number(p.target_price_usd) > 0) {
    return { label: 'Priced', cls: 'bg-emerald-100 text-emerald-700' };
  }
  if (p.cogs_done || p.cbm_done || p.overhead_done || p.shipping_done) {
    return { label: 'In Progress', cls: 'bg-amber-100 text-amber-700' };
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
      if (filter === 'in_costing') return p.quote_stage === 'quoting' || p.quote_stage === 'ready_for_quote';
      if (filter === 'sampling') return p.sample_stage === 'sampling';
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
    const selectedProducts = products.filter(p => selected.has(p.id));
    if (selectedProducts.length === 0) return;
    const totalQty = 0; const grandTotal = 0;
    const productsJson = selectedProducts.map(p => ({
      id: p.id, name: p.name,
      target_price_usd: p.target_price_usd, markup_percent: p.markup_percent,
    }));
    const { error } = await (supabase as any).from('quote_snapshots').insert({
      customer_rfq_id: inquiryId,
      quote_number: 'Q-' + Date.now(),
      status: 'draft',
      share_token: crypto.randomUUID(),
      products: productsJson,
      totals: { sku_count: selectedProducts.length, total_qty: totalQty, grand_total: grandTotal },
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Quote draft created');
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
        </div>
      </div>

      <BulkStageActions
        selectedIds={Array.from(selected)}
        onClear={() => setSelected(new Set())}
        onSetStage={handleSetStage}
        onGenerateQuote={handleGenerateQuote}
        onGenerateSampleBatch={() => setBatchOpen(true)}
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
                    <TableCell><ProductStagePills product={{ design_stage: p.design_stage, quote_stage: null, sample_stage: null }} onChange={(t, s) => handleSetSinglePill(p.id, 'design', s)} /></TableCell>
                    <TableCell><ProductStagePills product={{ design_stage: null, quote_stage: p.quote_stage, sample_stage: null }} onChange={(t, s) => handleSetSinglePill(p.id, 'quote', s)} /></TableCell>
                    <TableCell><ProductStagePills product={{ design_stage: null, quote_stage: null, sample_stage: p.sample_stage }} onChange={(t, s) => handleSetSinglePill(p.id, 'sample', s)} /></TableCell>
                    <TableCell><Badge className={cb.cls} variant="secondary">{cb.label}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.updated_at ? formatDistanceToNow(new Date(p.updated_at), { addSuffix: true }) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate(`/product/${p.id}?tab=costing`)}>Costing</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate(`/product/${p.id}?tab=sample-log`)}>Sample Log</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      <NewSampleBatchDialog
        open={batchOpen} onOpenChange={setBatchOpen}
        inquiryId={inquiryId}
        selectedProducts={selectedProducts.map(p => ({ id: p.id, name: p.name, sample_stage: p.sample_stage }))}
        onCreated={() => { setSelected(new Set()); setRefresh(r => r + 1); onChange(); }}
      />
    </div>
  );
}

export type { FilterKey as ProductFilterKey };
