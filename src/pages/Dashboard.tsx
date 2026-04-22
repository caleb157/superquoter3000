import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, FileText, Package2, Plus, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';
import { GenerateQuoteDialog } from '@/components/GenerateQuoteDialog';
import { GenerateSampleDialog } from '@/components/GenerateSampleDialog';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { NewInquiryDialog } from '@/components/NewInquiryDialog';

import {
  furthestStageBucket,
  productWeight,
  STAGE_BUCKET_LABELS,
  STAGE_BUCKET_ORDER,
  STAGE_BUCKET_COLOR,
  type StageBucket,
} from '@/lib/pipeline-weights';
import { fmt } from '@/lib/formatters';
import { computeProductUnitPrices, type ProductUnitPriceMap } from '@/lib/product-pricing';

const INQUIRY_STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300',
  po: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
};

type StatusFilter = 'all' | 'active' | 'paused' | 'po' | 'cancelled' | 'not_cancelled';

type Inquiry = {
  id: string; rfq_number: string; title: string | null; status: string;
  customer_id: string | null; updated_at: string; created_at: string;
};
type Customer = { id: string; name: string | null; company: string | null };
type Product = {
  id: string; customer_rfq_id: string | null; name: string; quantity: number | null;
  design_stage: string | null; quote_stage: string | null; sample_stage: string | null;
  target_price_usd: number | null;
};

const DESIGN_PILLS: { key: string; label: string; cls: string }[] = [
  { key: 'need_design', label: 'need',     cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  { key: 'designed',    label: 'designed', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
];
const QUOTE_PILLS: { key: string; label: string; cls: string }[] = [
  { key: 'quoting',         label: 'quoting', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  { key: 'ready_for_quote', label: 'ready',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  { key: 'quoted',          label: 'quoted',  cls: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' },
];
const SAMPLE_PILLS: { key: string; label: string; cls: string }[] = [
  { key: 'sampling', label: 'sampling', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
];

const Dashboard = () => {
  const navigate = useNavigate();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('not_cancelled');
  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<Inquiry>({ storageKey: 'inquiries-sort' });
  const [refreshKey, setRefreshKey] = useState(0);

  const [quoteDialog, setQuoteDialog] = useState<{ id: string; rfq: string } | null>(null);
  const [sampleDialog, setSampleDialog] = useState<{ id: string; rfq: string } | null>(null);
  const [showNewInquiry, setShowNewInquiry] = useState(false);

  const [unitPrices, setUnitPrices] = useState<ProductUnitPriceMap>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [inq, cust, prod] = await Promise.all([
        supabase.from('customer_rfqs').select('*').order('updated_at', { ascending: false }),
        supabase.from('customers').select('id, name, company'),
        supabase.from('products').select('id, customer_rfq_id, name, quantity, design_stage, quote_stage, sample_stage, target_price_usd'),
      ]);
      setInquiries((inq.data ?? []) as Inquiry[]);
      setCustomers((cust.data ?? []) as Customer[]);
      const prodList = (prod.data ?? []) as Product[];
      setProducts(prodList);
      setLoading(false);
      // Compute current unit prices for weighted pipeline value (async, non-blocking for UI)
      try {
        const ids = prodList.map(p => p.id);
        const prices = await computeProductUnitPrices(ids);
        setUnitPrices(prices);
      } catch (e) {
        console.error('Failed to compute unit prices', e);
      }
    })();
  }, [refreshKey]);

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map(c => [c.id, c])),
    [customers],
  );
  const productsByInquiry = useMemo(() => {
    const m: Record<string, Product[]> = {};
    products.forEach(p => {
      if (!p.customer_rfq_id) return;
      (m[p.customer_rfq_id] ||= []).push(p);
    });
    return m;
  }, [products]);

  const inquiryStatusById = useMemo(
    () => Object.fromEntries(inquiries.map(i => [i.id, i.status])),
    [inquiries],
  );
  const activeInquiries = inquiries.filter(i => i.status !== 'cancelled').length;
  const poInquiries = inquiries.filter(i => i.status === 'po').length;
  const activeProducts = products.filter(p => p.design_stage || p.quote_stage || p.sample_stage).length;
  const totalProducts = products.length;

  const pipelineValueUsd = useMemo(() => {
    let total = 0;
    for (const p of products) {
      const inqStatus = p.customer_rfq_id ? inquiryStatusById[p.customer_rfq_id] : null;
      if (inqStatus === 'cancelled') continue;
      const w = productWeight(p, inqStatus);
      if (w === 0) continue;
      const qty = p.quantity ?? 0;
      // Use the live computed unit price; fall back to target only if costing has no result yet.
      const computed = unitPrices[p.id]?.unit_price_usd ?? 0;
      const price = computed > 0 ? computed : Number(p.target_price_usd ?? 0);
      total += qty * price * w;
    }
    return total;
  }, [products, inquiryStatusById, unitPrices]);

  const productsByStageBucket = useMemo(() => {
    const counts: Record<StageBucket, number> = {
      not_started: 0, need_design: 0, designed: 0,
      quoting: 0, ready_for_quote: 0, quoted: 0,
      sampling: 0, po: 0,
    };
    for (const p of products) {
      const inqStatus = p.customer_rfq_id ? inquiryStatusById[p.customer_rfq_id] : null;
      if (inqStatus === 'cancelled') continue;
      counts[furthestStageBucket(p, inqStatus)] += 1;
    }
    return counts;
  }, [products, inquiryStatusById]);

  const visibleInquiries = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = inquiries.filter(i => {
      if (statusFilter === 'not_cancelled' && i.status === 'cancelled') return false;
      if (statusFilter !== 'all' && statusFilter !== 'not_cancelled' && i.status !== statusFilter) return false;
      if (!q) return true;
      const cust = i.customer_id ? customerMap[i.customer_id] : null;
      const custName = (cust?.name || cust?.company || '').toLowerCase();
      return (
        i.rfq_number.toLowerCase().includes(q) ||
        (i.title ?? '').toLowerCase().includes(q) ||
        custName.includes(q)
      );
    });

    // Default ordering: most recently updated first when no explicit sort selected.
    if (!sortColumn || !sortDirection) {
      list = [...list].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    } else {
      const getters: Record<string, (i: Inquiry) => string | number> = {
        rfq: (i) => i.rfq_number.toLowerCase(),
        customer: (i) => (customerMap[i.customer_id ?? '']?.name || customerMap[i.customer_id ?? '']?.company || '').toLowerCase(),
        title: (i) => (i.title ?? '').toLowerCase(),
        status: (i) => i.status,
        products: (i) => productsByInquiry[i.id]?.length ?? 0,
        updated: (i) => new Date(i.updated_at).getTime(),
      };
      list = sortItems(list, getters);
    }
    return list;
  }, [inquiries, customerMap, productsByInquiry, search, statusFilter, sortColumn, sortDirection, sortItems]);

  const stageCounts = (prods: Product[] | undefined, track: 'design' | 'quote' | 'sample') => {
    const counts: Record<string, number> = {};
    if (!prods) return counts;
    const col = track === 'design' ? 'design_stage' : track === 'quote' ? 'quote_stage' : 'sample_stage';
    for (const p of prods) {
      const v = (p as any)[col];
      if (v) counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
  };

  const renderStageCell = (
    prods: Product[] | undefined,
    inquiryId: string,
    pills: { key: string; label: string; cls: string }[],
    track: 'design' | 'quote' | 'sample',
  ) => {
    const counts = stageCounts(prods, track);
    const visible = pills.filter(p => (counts[p.key] ?? 0) > 0);
    if (visible.length === 0) return <span className="text-muted-foreground/60">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map(p => (
          <button
            key={p.key}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/inquiry/${inquiryId}?tab=products&stage=${p.key}`);
            }}
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums hover:opacity-80',
              p.cls,
            )}
          >
            {counts[p.key]} {p.label}
          </button>
        ))}
      </div>
    );
  };

  const renderStagePillsRow = (prods: Product[] | undefined, inquiryId: string) => {
    const all: { count: number; label: string; cls: string; key: string }[] = [];
    [...DESIGN_PILLS, ...QUOTE_PILLS, ...SAMPLE_PILLS].forEach(p => {
      let track: 'design' | 'quote' | 'sample' = 'design';
      if (QUOTE_PILLS.find(x => x.key === p.key)) track = 'quote';
      else if (SAMPLE_PILLS.find(x => x.key === p.key)) track = 'sample';
      const c = stageCounts(prods, track)[p.key] ?? 0;
      if (c > 0) all.push({ count: c, label: p.label, cls: p.cls, key: `${track}-${p.key}` });
    });
    if (all.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {all.map(p => (
          <span
            key={p.key}
            className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums', p.cls)}
          >
            {p.count} {p.label}
          </span>
        ))}
      </div>
    );
  };

  const isAllStagesEmpty = (prods: Product[] | undefined) => {
    if (!prods || prods.length === 0) return true;
    return !prods.some(p => p.design_stage || p.quote_stage || p.sample_stage);
  };

  return (
    <AppLayout>
      <TooltipProvider>
        <div className="max-w-7xl mx-auto space-y-3 sm:space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <StatCard label="Active Inquiries" value={activeInquiries} />
            <StatCard label="Total Products" value={totalProducts} />
            <StatCard label="Active Products" value={activeProducts} />
            <StatCard label="PO Inquiries" value={poInquiries} />
          </div>

          {/* Pipeline + stage buckets */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-3">
            <Card className="lg:col-span-1">
              <CardContent className="pt-4 pb-3">
                <div className="text-xs text-muted-foreground mb-1">Weighted Pipeline Value</div>
                <div className="text-xl sm:text-2xl font-bold tabular-nums">{fmt.usd(pipelineValueUsd)}</div>
                <div className="text-[11px] text-muted-foreground mt-2 leading-snug hidden sm:block">
                  Σ (qty × unit price × stage weight). Designed 25% · Quoted 50% · Sampling 75% · PO 100%.
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-muted-foreground">Products by Stage</div>
                  <div className="text-[11px] text-muted-foreground hidden sm:block">Tap to filter</div>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {STAGE_BUCKET_ORDER.map(b => {
                    const count = productsByStageBucket[b];
                    if (count === 0) return null;
                    return (
                      <button
                        key={b}
                        onClick={() => navigate(`/products?stage=${b}`)}
                        className={cn(
                          'flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md hover:opacity-80 transition',
                          STAGE_BUCKET_COLOR[b],
                        )}
                      >
                        <span className="text-sm font-bold tabular-nums">{count}</span>
                        <span className="text-[11px] font-medium">{STAGE_BUCKET_LABELS[b]}</span>
                      </button>
                    );
                  })}
                  {STAGE_BUCKET_ORDER.every(b => productsByStageBucket[b] === 0) && (
                    <div className="text-xs text-muted-foreground italic py-1">No products yet.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter bar — wraps cleanly on mobile */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search # · title · customer"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="h-9 flex-1 min-w-[130px] sm:max-w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="not_cancelled">All (no cancelled)</SelectItem>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="po">PO</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-9 flex-1 min-w-[130px] sm:max-w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">Sort: Updated</SelectItem>
                <SelectItem value="created">Sort: Created</SelectItem>
                <SelectItem value="product_count">Sort: Product Count</SelectItem>
                <SelectItem value="customer">Sort: Customer</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-9 gap-1.5 ml-auto" onClick={() => setShowNewInquiry(true)}>
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Inquiry</span><span className="sm:hidden">New</span>
            </Button>
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden space-y-2">
            {loading ? (
              <div className="p-8 text-sm text-muted-foreground text-center">Loading…</div>
            ) : visibleInquiries.length === 0 ? (
              <Card><CardContent className="py-10 text-sm text-muted-foreground text-center">
                {inquiries.length === 0 ? 'No inquiries yet.' : 'No matches.'}
              </CardContent></Card>
            ) : (
              visibleInquiries.map(inq => {
                const prods = productsByInquiry[inq.id];
                const cust = inq.customer_id ? customerMap[inq.customer_id] : null;
                const noProducts = !prods || prods.length === 0;
                return (
                  <Card
                    key={inq.id}
                    className="active:scale-[0.99] transition-transform"
                    onClick={() => navigate(`/inquiry/${inq.id}`)}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] text-muted-foreground">{inq.rfq_number}</span>
                            <span className={cn(
                              'px-1.5 py-0.5 rounded text-[10px] font-medium capitalize',
                              INQUIRY_STATUS_COLORS[inq.status] || 'bg-muted',
                            )}>{inq.status}</span>
                          </div>
                          <div className="font-semibold text-sm leading-tight mt-1 truncate">
                            {inq.title || <span className="text-muted-foreground italic font-normal">Untitled</span>}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {cust?.name || cust?.company || 'No customer'}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                      </div>

                      {!isAllStagesEmpty(prods) && renderStagePillsRow(prods, inq.id)}

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{prods?.length ?? 0} {prods?.length === 1 ? 'product' : 'products'}</span>
                        <span>{formatDistanceToNow(new Date(inq.updated_at), { addSuffix: true })}</span>
                      </div>

                      <div className="flex gap-1.5 pt-1" onClick={e => e.stopPropagation()}>
                        <Button
                          size="sm" variant="outline"
                          className="h-8 text-xs gap-1 flex-1"
                          disabled={noProducts}
                          onClick={() => setQuoteDialog({ id: inq.id, rfq: inq.rfq_number })}
                        >
                          <FileText className="h-3 w-3" /> Quote
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          className="h-8 text-xs gap-1 flex-1"
                          disabled={noProducts}
                          onClick={() => setSampleDialog({ id: inq.id, rfq: inq.rfq_number })}
                        >
                          <Package2 className="h-3 w-3" /> Sample
                        </Button>
                        <ConfirmDeleteButton
                          itemLabel={`inquiry ${inq.rfq_number}`}
                          description={`This permanently removes inquiry ${inq.rfq_number} and all of its products, quotes, samples, and tasks.`}
                          iconOnly
                          onConfirm={async () => {
                            const { error } = await supabase.from('customer_rfqs').delete().eq('id', inq.id);
                            if (error) throw error;
                            setRefreshKey(k => k + 1);
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Desktop: table */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-sm text-muted-foreground text-center">Loading…</div>
              ) : visibleInquiries.length === 0 ? (
                inquiries.length === 0 ? (
                  <div className="p-12 text-center space-y-3">
                    <div className="text-sm text-muted-foreground">No inquiries yet.</div>
                    <Button size="sm" onClick={() => setShowNewInquiry(true)}>+ New Inquiry</Button>
                  </div>
                ) : (
                  <div className="p-8 text-sm text-muted-foreground text-center">No inquiries match your filters.</div>
                )
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-[120px]">#</TableHead>
                      <TableHead className="text-xs">Customer</TableHead>
                      <TableHead className="text-xs">Title</TableHead>
                      <TableHead className="text-xs w-[88px]">Status</TableHead>
                      <TableHead className="text-xs w-[70px] text-right">Products</TableHead>
                      <TableHead className="text-xs">Design</TableHead>
                      <TableHead className="text-xs">Quote</TableHead>
                      <TableHead className="text-xs">Sample</TableHead>
                      <TableHead className="text-xs w-[100px]">Updated</TableHead>
                      <TableHead className="text-xs text-right w-[190px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleInquiries.map(inq => {
                      const prods = productsByInquiry[inq.id];
                      const cust = inq.customer_id ? customerMap[inq.customer_id] : null;
                      const noProducts = !prods || prods.length === 0;
                      const stagesEmpty = isAllStagesEmpty(prods);

                      const goToInquiry = () => navigate(`/inquiry/${inq.id}`);

                      return (
                        <TableRow
                          key={inq.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={goToInquiry}
                        >
                          <TableCell className="font-mono text-xs">{inq.rfq_number}</TableCell>
                          <TableCell className="text-sm truncate max-w-[180px]">
                            {cust?.name || cust?.company || '—'}
                          </TableCell>
                          <TableCell className="text-sm truncate max-w-[260px]">
                            {inq.title || <span className="text-muted-foreground italic">Untitled</span>}
                          </TableCell>
                          <TableCell>
                            <span className={cn(
                              'px-2 py-0.5 rounded text-[11px] font-medium capitalize',
                              INQUIRY_STATUS_COLORS[inq.status] || 'bg-muted',
                            )}>{inq.status}</span>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {prods?.length ?? 0}
                          </TableCell>
                          <TableCell>
                            {stagesEmpty
                              ? <span className="text-muted-foreground/60">—</span>
                              : renderStageCell(prods, inq.id, DESIGN_PILLS, 'design')}
                          </TableCell>
                          <TableCell>
                            {stagesEmpty
                              ? <span className="text-muted-foreground/60">—</span>
                              : renderStageCell(prods, inq.id, QUOTE_PILLS, 'quote')}
                          </TableCell>
                          <TableCell>
                            {stagesEmpty
                              ? <span className="text-muted-foreground/60">—</span>
                              : renderStageCell(prods, inq.id, SAMPLE_PILLS, 'sample')}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(inq.updated_at), { addSuffix: true })}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                              <ActionButton
                                disabled={noProducts}
                                tooltip={noProducts ? 'No products' : 'Generate quote'}
                                icon={<FileText className="h-3 w-3" />}
                                label="Quote"
                                onClick={() => setQuoteDialog({ id: inq.id, rfq: inq.rfq_number })}
                              />
                              <ActionButton
                                disabled={noProducts}
                                tooltip={noProducts ? 'No products' : 'Generate sample batch'}
                                icon={<Package2 className="h-3 w-3" />}
                                label="Sample"
                                onClick={() => setSampleDialog({ id: inq.id, rfq: inq.rfq_number })}
                              />
                              <ConfirmDeleteButton
                                itemLabel={`inquiry ${inq.rfq_number}`}
                                description={`This permanently removes inquiry ${inq.rfq_number} and all of its products, quotes, samples, and tasks. This cannot be undone.`}
                                iconOnly
                                onConfirm={async () => {
                                  const { error } = await supabase.from('customer_rfqs').delete().eq('id', inq.id);
                                  if (error) throw error;
                                  setRefreshKey(k => k + 1);
                                }}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {quoteDialog && (
          <GenerateQuoteDialog
            open={!!quoteDialog}
            onOpenChange={(o) => !o && setQuoteDialog(null)}
            inquiryId={quoteDialog.id}
            inquiryNumber={quoteDialog.rfq}
            onCreated={() => setRefreshKey(k => k + 1)}
          />
        )}
        {sampleDialog && (
          <GenerateSampleDialog
            open={!!sampleDialog}
            onOpenChange={(o) => !o && setSampleDialog(null)}
            inquiryId={sampleDialog.id}
            inquiryNumber={sampleDialog.rfq}
            onCreated={() => setRefreshKey(k => k + 1)}
          />
        )}
        <NewInquiryDialog
          open={showNewInquiry}
          onOpenChange={setShowNewInquiry}
          onCreated={(id) => {
            setRefreshKey(k => k + 1);
            navigate(`/inquiry/${id}?tab=products`);
          }}
        />
      </TooltipProvider>
      
    </AppLayout>
  );
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-2.5 sm:pt-4 sm:pb-3">
        <div className="text-xl sm:text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-[11px] sm:text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function ActionButton({
  disabled, tooltip, icon, label, onClick,
}: {
  disabled?: boolean; tooltip: string; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  const btn = (
    <Button
      size="sm" variant="outline"
      className="h-7 px-2 text-xs gap-1"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}{label}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span tabIndex={0}>{btn}</span> : btn}
      </TooltipTrigger>
      <TooltipContent><span className="text-xs">{tooltip}</span></TooltipContent>
    </Tooltip>
  );
}

export default Dashboard;
