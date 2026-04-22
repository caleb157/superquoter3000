import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { NewInquiryDialog } from '@/components/NewInquiryDialog';
import { useArrowKeyRowNav, useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

import {
  furthestStageBucket,
  productWeight,
  STAGE_BUCKET_LABELS,
  STAGE_BUCKET_ORDER,
  STAGE_BUCKET_COLOR,
  type StageBucket,
} from '@/lib/pipeline-weights';
import { fmt } from '@/lib/formatters';
import { computeProductPriceAndCost, type ProductPriceCostMap } from '@/lib/product-pricing';

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

  const [showNewInquiry, setShowNewInquiry] = useState(false);

  const [productPricing, setProductPricing] = useState<ProductPriceCostMap>({});
  const [showPipelineDebug, setShowPipelineDebug] = useState(false);

  const mobileListRef = useRef<HTMLDivElement>(null);
  const desktopListRef = useRef<HTMLDivElement>(null);
  useArrowKeyRowNav(mobileListRef);
  useArrowKeyRowNav(desktopListRef);
  useKeyboardShortcuts({ onNewItem: () => setShowNewInquiry(true) });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [inq, cust, prod] = await Promise.all([
        supabase.from('customer_rfqs').select('*').order('updated_at', { ascending: false }),
        supabase.from('customers').select('id, name, company'),
        supabase.from('products').select('id, customer_rfq_id, name, quantity, design_stage, quote_stage, sample_stage'),
      ]);
      setInquiries((inq.data ?? []) as Inquiry[]);
      setCustomers((cust.data ?? []) as Customer[]);
      const prodList = (prod.data ?? []) as Product[];
      setProducts(prodList);
      setLoading(false);
      // Compute current FOB cost + unit price for weighted pipeline (async, non-blocking)
      try {
        const ids = prodList.map(p => p.id);
        const pricing = await computeProductPriceAndCost(ids);
        setProductPricing(pricing);
      } catch (e) {
        console.error('Failed to compute product pricing', e);
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

  // Live FOB total per inquiry: Σ (qty × unit_cost_usd) over its products.
  // Recomputes whenever pricing or product list changes.
  const fobByInquiry = useMemo(() => {
    const m: Record<string, { total: number; missing: number }> = {};
    for (const p of products) {
      if (!p.customer_rfq_id) continue;
      const entry = (m[p.customer_rfq_id] ||= { total: 0, missing: 0 });
      const qty = p.quantity ?? 0;
      const cost = productPricing[p.id]?.unit_cost_usd ?? 0;
      if (cost === 0 || qty === 0) {
        entry.missing += 1;
      } else {
        entry.total += qty * cost;
      }
    }
    return m;
  }, [products, productPricing]);

  const inquiryStatusById = useMemo(
    () => Object.fromEntries(inquiries.map(i => [i.id, i.status])),
    [inquiries],
  );
  const activeInquiries = inquiries.filter(i => i.status !== 'cancelled').length;
  const poInquiries = inquiries.filter(i => i.status === 'po').length;
  const activeProducts = products.filter(p => p.design_stage || p.quote_stage || p.sample_stage).length;
  const totalProducts = products.length;

  const pipelineDetail = useMemo(() => {
    let total = 0;
    let counted = 0;
    let skippedNoCost = 0;
    let skippedNoQty = 0;
    const contributors: Array<{ name: string; qty: number; cost: number; weight: number; value: number }> = [];
    for (const p of products) {
      const inqStatus = p.customer_rfq_id ? inquiryStatusById[p.customer_rfq_id] : null;
      if (inqStatus === 'cancelled') continue;
      const w = productWeight(p, inqStatus);
      if (w === 0) continue;
      const qty = p.quantity ?? 0;
      if (qty === 0) { skippedNoQty += 1; continue; }
      // Use live-computed FOB cost. Do NOT fall back to target_price_usd — that's revenue, not cost,
      // and mixing the two inflates the metric. If costing isn't done, skip.
      const cost = productPricing[p.id]?.unit_cost_usd ?? 0;
      if (cost === 0) { skippedNoCost += 1; continue; }
      const value = qty * cost * w;
      total += value;
      counted += 1;
      contributors.push({ name: p.name, qty, cost, weight: w, value });
    }
    contributors.sort((a, b) => b.value - a.value);
    return { total, counted, skippedNoCost, skippedNoQty, top: contributors.slice(0, 5) };
  }, [products, inquiryStatusById, productPricing]);

  const pipelineValueUsd = pipelineDetail.total;

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
        order_value: (i) => fobByInquiry[i.id]?.total ?? 0,
      };
      list = sortItems(list, getters);
    }
    return list;
  }, [inquiries, customerMap, productsByInquiry, fobByInquiry, search, statusFilter, sortColumn, sortDirection, sortItems]);

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
                  Σ (qty × FOB cost × stage weight). Only products with completed costing counted.
                  Designed 25% · Quoted 50% · Sampling 75% · PO 100%.
                </div>
                <button
                  type="button"
                  onClick={() => setShowPipelineDebug(v => !v)}
                  className="text-[10px] text-muted-foreground/70 hover:text-foreground mt-1.5 underline-offset-2 hover:underline"
                >
                  {showPipelineDebug ? 'hide debug' : 'debug'}
                </button>
                {showPipelineDebug && (
                  <div className="text-[10px] text-muted-foreground mt-1.5 space-y-0.5 leading-snug">
                    <div>Counted: <span className="tabular-nums text-foreground">{pipelineDetail.counted}</span> · skipped no costing: <span className="tabular-nums">{pipelineDetail.skippedNoCost}</span> · skipped qty=0: <span className="tabular-nums">{pipelineDetail.skippedNoQty}</span></div>
                    {pipelineDetail.top.length > 0 && (
                      <div className="pt-1">
                        <div className="font-medium text-foreground/80">Top contributors:</div>
                        {pipelineDetail.top.map((c, i) => (
                          <div key={i} className="truncate">
                            • {c.name}: {c.qty} × {fmt.usd(c.cost)} × {Math.round(c.weight * 100)}% = <span className="tabular-nums text-foreground">{fmt.usd(c.value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
            <Button size="sm" className="h-9 gap-1.5 ml-auto" onClick={() => setShowNewInquiry(true)}>
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Inquiry</span><span className="sm:hidden">New</span>
            </Button>
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden space-y-2" ref={mobileListRef}>
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
                    data-row-nav
                    tabIndex={0}
                    role="link"
                    aria-label={`Open inquiry ${inq.rfq_number}`}
                    className="row-action active:scale-[0.99] transition-transform"
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
                        <span className="tabular-nums">
                          <FobValue
                            entry={fobByInquiry[inq.id]}
                            productCount={prods?.length ?? 0}
                            compact
                          />
                        </span>
                        <span>{formatDistanceToNow(new Date(inq.updated_at), { addSuffix: true })}</span>
                      </div>

                      <div className="flex justify-end pt-1" onClick={e => e.stopPropagation()}>
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
          <Card className="hidden md:block" ref={desktopListRef as any}>
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
                      <SortableHeader column="rfq" label="#" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs w-[120px]" />
                      <SortableHeader column="customer" label="Customer" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader column="title" label="Title" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs w-[88px]" />
                      <SortableHeader column="products" label="Products" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs w-[70px] text-right" />
                      <TableHead className="text-xs">Design</TableHead>
                      <TableHead className="text-xs">Quote</TableHead>
                      <TableHead className="text-xs">Sample</TableHead>
                      <SortableHeader column="updated" label="Updated" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs w-[100px]" />
                      <SortableHeader column="order_value" label="Order Value" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs w-[110px] text-right" />
                      <TableHead className="text-xs text-right w-[60px]">Actions</TableHead>
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
                          data-row-nav
                          tabIndex={0}
                          role="link"
                          aria-label={`Open inquiry ${inq.rfq_number}`}
                          className="row-action cursor-pointer hover:bg-muted/50 focus-visible:bg-muted focus-visible:!ring-inset"
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
                          <TableCell className="text-right text-xs tabular-nums">
                            <FobValue
                              entry={fobByInquiry[inq.id]}
                              productCount={prods?.length ?? 0}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
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

function FobValue({
  entry, productCount, compact = false,
}: {
  entry: { total: number; missing: number } | undefined;
  productCount: number;
  compact?: boolean;
}) {
  if (!productCount) {
    return <span className="text-muted-foreground/60">—</span>;
  }
  const total = entry?.total ?? 0;
  const missing = entry?.missing ?? 0;
  const allMissing = total === 0 && missing > 0;

  const valueLabel = allMissing ? '—' : fmt.usd(total);
  const tooltipText = allMissing
    ? 'No costed products yet'
    : missing > 0
      ? `${missing} product${missing === 1 ? '' : 's'} not yet costed — value is partial`
      : `Σ qty × FOB cost across ${productCount} product${productCount === 1 ? '' : 's'}`;

  const inner = (
    <span className={cn(
      'inline-flex items-baseline gap-1',
      allMissing && 'text-muted-foreground/70',
    )}>
      <span className={compact ? 'font-medium text-foreground' : 'font-semibold'}>{valueLabel}</span>
      {missing > 0 && !allMissing && (
        <span className="text-[10px] text-warning">·{missing}?</span>
      )}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent><span className="text-xs">{tooltipText}</span></TooltipContent>
    </Tooltip>
  );
}

export default Dashboard;
