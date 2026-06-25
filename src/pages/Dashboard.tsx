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
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Search, FileText, Package2, Plus, ChevronRight, MoreVertical, Pin, RotateCcw } from 'lucide-react';
import {
  DndContext, DragEndEvent, PointerSensor, useDroppable, useDraggable, useSensor, useSensors,
} from '@dnd-kit/core';

import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { CreateInquiryDialog } from '@/components/CreateInquiryDialog';
import { useArrowKeyRowNav, useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { rowNavHandlers } from '@/lib/row-nav';
import { RowContextMenu } from '@/components/RowContextMenu';
import { usePersistentState, useScrollRestoration } from '@/hooks/use-persistent-state';

import {
  furthestStageBucket,
  productStageBuckets,
  productWeight,
  STAGE_BUCKET_LABELS,
  STAGE_BUCKET_ORDER,
  STAGE_BUCKET_COLOR,
  type StageBucket,
} from '@/lib/pipeline-weights';
import { fmt } from '@/lib/formatters';

import { INQUIRY_STATUS_COLORS, statusLabel, type InquiryStatus } from '@/lib/inquiry-status';
import { useDocumentTitle } from '@/hooks/use-document-title';
import {
  ACTIVE_SUBSTAGES, KANBAN_COL_TO_STATUS, KANBAN_LABEL_TO_OVERRIDE, KANBAN_SUBSTAGE_LABEL,
  inquiryKanbanColumn, visibleKanbanColumns, type KanbanColumn,
} from '@/lib/inquiry-kanban';
import { applyInquiryStatusChange } from '@/lib/inquiry-status-transition';


const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  high: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  normal: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  low: 'bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400',
};
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type StatusFilter = 'all' | 'active' | 'paused' | 'projected_po' | 'po' | 'cancelled' | 'complete' | 'open';

type Inquiry = {
  id: string; rfq_number: string; title: string | null; status: string;
  priority: string;
  customer_id: string | null; updated_at: string; created_at: string;
  kanban_substage_override: string | null;
};
type Customer = { id: string; name: string | null; company: string | null };
type Product = {
  id: string; customer_rfq_id: string | null; name: string; quantity: number | null;
  design_stage: string | null; quote_stage: string | null; sample_stage: string | null;
  cbm_done: boolean | null; cogs_done: boolean | null; overhead_done: boolean | null;
  shipping_done: boolean | null; revenue_done: boolean | null;
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

  const [search, setSearch] = usePersistentState<string>('dashboard.search', '');
  const [statusFilter, setStatusFilter] = usePersistentState<StatusFilter>('dashboard.statusFilter', 'open');
  useScrollRestoration('dashboard.scroll', !loading);
  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<Inquiry>({ storageKey: 'inquiries-sort' });
  const [refreshKey, setRefreshKey] = useState(0);

  const [showNewInquiry, setShowNewInquiry] = useState(false);
  const [newInquiryStatus, setNewInquiryStatus] = useState<'active' | 'projected_po'>('active');

  const [reviewProductIds, setReviewProductIds] = useState<Set<string>>(new Set());
  

  

  const mobileListRef = useRef<HTMLDivElement>(null);
  const desktopListRef = useRef<HTMLDivElement>(null);
  useArrowKeyRowNav(mobileListRef);
  useArrowKeyRowNav(desktopListRef);
  useKeyboardShortcuts({ onNewItem: () => setShowNewInquiry(true) });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [inq, cust, prod, cogsRev, ohRev] = await Promise.all([
        supabase.from('customer_rfqs').select('*').order('updated_at', { ascending: false }),
        supabase.from('customers').select('id, name, company'),
        supabase.from('products').select('id, customer_rfq_id, name, quantity, design_stage, quote_stage, sample_stage, cbm_done, cogs_done, overhead_done, shipping_done, revenue_done'),
        supabase.from('cogs_items').select('product_id').eq('include', 'Review').limit(100000),
        supabase.from('overhead_items').select('product_id').eq('include', 'Review').limit(100000),
      ]);
      setInquiries((inq.data ?? []) as Inquiry[]);
      setCustomers((cust.data ?? []) as Customer[]);
      setProducts((prod.data ?? []) as Product[]);
      const rset = new Set<string>();
      (cogsRev.data ?? []).forEach((r: any) => r.product_id && rset.add(r.product_id));
      (ohRev.data ?? []).forEach((r: any) => r.product_id && rset.add(r.product_id));
      setReviewProductIds(rset);
      setLoading(false);
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

  const reviewInquiryIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of products) {
      if (p.customer_rfq_id && reviewProductIds.has(p.id)) s.add(p.customer_rfq_id);
    }
    return s;
  }, [products, reviewProductIds]);



  const inquiryStatusById = useMemo(
    () => Object.fromEntries(inquiries.map(i => [i.id, i.status])),
    [inquiries],
  );
  const activeInquiries = inquiries.filter(i => i.status !== 'cancelled' && i.status !== 'complete').length;
  const poInquiries = inquiries.filter(i => i.status === 'po').length;
  const projectedPoCount = inquiries.filter(i => i.status === 'projected_po').length;
  const activeProducts = products.filter(p => p.design_stage || p.quote_stage || p.sample_stage).length;
  const totalProducts = products.length;



  const productsByStageBucket = useMemo(() => {
    const counts: Record<StageBucket, number> = {
      not_started: 0, need_design: 0, designed: 0,
      quoting: 0, ready_for_quote: 0, quoted: 0,
      sampling: 0, sampled: 0, po: 0,
    };
    for (const p of products) {
      const inqStatus = p.customer_rfq_id ? inquiryStatusById[p.customer_rfq_id] : null;
      if (inqStatus === 'cancelled' || inqStatus === 'complete') continue;
      for (const b of productStageBuckets(p, inqStatus)) counts[b] += 1;
    }
    return counts;
  }, [products, inquiryStatusById]);

  const visibleInquiries = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = inquiries.filter(i => {
      if (statusFilter === 'open' && (i.status === 'cancelled' || i.status === 'complete')) return false;
      if (statusFilter !== 'all' && statusFilter !== 'open' && i.status !== statusFilter) return false;
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
        priority: (i) => PRIORITY_RANK[i.priority] ?? 99,
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
        <div className="max-w-7xl mx-auto space-y-3 sm:space-y-4 px-1 sm:px-0">
          {/* Stats — 1 col on xs, 2 col on sm, 4 col on md+ */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
            <StatCard label="Active Inquiries" value={activeInquiries} />
            <StatCard label="Total Products" value={totalProducts} />
            <StatCard label="Active Products" value={activeProducts} />
            <StatCard label="PO Inquiries" value={poInquiries} />
            <StatCard label="Projected POs" value={projectedPoCount} />
          </div>

          {/* Stage buckets */}
          <Card>
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
                        'flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-2.5 py-2 sm:py-1.5 rounded-md hover:opacity-80 transition min-h-[44px] sm:min-h-0',
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
                <SelectItem value="open">Open (no complete/cancelled)</SelectItem>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="projected_po">Projected PO</SelectItem>
                <SelectItem value="po">PO</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 ml-auto">
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => { setNewInquiryStatus('projected_po'); setShowNewInquiry(true); }}>
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Projected PO</span><span className="sm:hidden">Proj. PO</span>
              </Button>
              <Button size="sm" className="h-9 gap-1.5" onClick={() => { setNewInquiryStatus('active'); setShowNewInquiry(true); }}>
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Inquiry</span><span className="sm:hidden">New</span>
              </Button>
            </div>
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
                  <RowContextMenu key={inq.id} path={`/inquiry/${inq.id}`}>
                  <Card
                    data-row-nav
                    tabIndex={0}
                    role="link"
                    aria-label={`Open inquiry ${inq.rfq_number}`}
                    className={cn(
                      "row-action active:scale-[0.99] transition-transform",
                      reviewInquiryIds.has(inq.id) && 'bg-amber-100 dark:bg-amber-500/15 border-l-2 border-amber-500',
                    )}
                    {...rowNavHandlers(navigate, `/inquiry/${inq.id}`, { from: { label: 'Dashboard', path: '/' } })}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] text-muted-foreground">{inq.rfq_number}</span>
                            {reviewInquiryIds.has(inq.id) && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200" title="Contains products that need review">⚠ Review</span>
                            )}
                            <span className={cn(
                              'px-1.5 py-0.5 rounded text-[10px] font-medium',
                              INQUIRY_STATUS_COLORS[inq.status] || 'bg-muted',
                            )}>{statusLabel(inq.status)}</span>
                          </div>
                          <div className="font-bold text-base leading-tight mt-1 truncate">
                            {inq.title || <span className="text-muted-foreground italic font-normal text-sm">Untitled</span>}
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
                  </RowContextMenu>
                );
              })
            )}
          </div>

          {/* Desktop: kanban board */}
          <DesktopKanban
            loading={loading}
            inquiries={inquiries}
            visibleInquiries={visibleInquiries}
            productsByInquiry={productsByInquiry}
            customerMap={customerMap}
            reviewInquiryIds={reviewInquiryIds}
            statusFilter={statusFilter}
            navigate={navigate}
            isAllStagesEmpty={isAllStagesEmpty}
            renderStagePillsRow={renderStagePillsRow}
            setInquiries={setInquiries}
            setRefreshKey={setRefreshKey}
            setShowNewInquiry={setShowNewInquiry}
            desktopListRef={desktopListRef}
          />
        </div>


        <CreateInquiryDialog
          open={showNewInquiry}
          onOpenChange={setShowNewInquiry}
          defaultStatus={newInquiryStatus}
          onCreated={(id) => {
            setRefreshKey(k => k + 1);
            navigate(`/inquiry/${id}?tab=${newInquiryStatus === 'projected_po' ? 'projection' : 'products'}`);
          }}
        />
      </TooltipProvider>
      
    </AppLayout>
  );
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  useDocumentTitle('Inquiries');
  return (
    <Card>
      <CardContent className="pt-3 pb-2.5 sm:pt-4 sm:pb-3">
        <div className="text-xl sm:text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-[11px] sm:text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}


// ---------- Desktop Kanban Board ----------

type StatusFilterT = StatusFilter;

const COLUMN_COLOR: Record<KanbanColumn, string> = {
  Idea: INQUIRY_STATUS_COLORS.active,
  Costing: INQUIRY_STATUS_COLORS.active,
  Quoted: INQUIRY_STATUS_COLORS.active,
  Sampling: INQUIRY_STATUS_COLORS.active,
  Paused: INQUIRY_STATUS_COLORS.paused,
  'Projected PO': INQUIRY_STATUS_COLORS.projected_po,
  PO: INQUIRY_STATUS_COLORS.po,
  Complete: INQUIRY_STATUS_COLORS.complete,
  Cancelled: INQUIRY_STATUS_COLORS.cancelled,
};

type DesktopKanbanProps = {
  loading: boolean;
  inquiries: Inquiry[];
  visibleInquiries: Inquiry[];
  productsByInquiry: Record<string, Product[]>;
  customerMap: Record<string, Customer>;
  reviewInquiryIds: Set<string>;
  statusFilter: StatusFilterT;
  navigate: ReturnType<typeof useNavigate>;
  isAllStagesEmpty: (prods: Product[] | undefined) => boolean;
  renderStagePillsRow: (prods: Product[] | undefined, inquiryId: string) => React.ReactNode;
  setInquiries: React.Dispatch<React.SetStateAction<Inquiry[]>>;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  setShowNewInquiry: (open: boolean) => void;
  desktopListRef: React.RefObject<HTMLDivElement>;
};

function DesktopKanban(props: DesktopKanbanProps) {
  const {
    loading, inquiries, visibleInquiries, productsByInquiry, customerMap, reviewInquiryIds,
    statusFilter, navigate, isAllStagesEmpty, renderStagePillsRow,
    setInquiries, setRefreshKey, setShowNewInquiry, desktopListRef,
  } = props;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const columns = useMemo(() => visibleKanbanColumns(statusFilter), [statusFilter]);

  const byColumn = useMemo(() => {
    const m: Record<string, Inquiry[]> = {};
    for (const col of columns) m[col] = [];
    for (const inq of visibleInquiries) {
      const col = inquiryKanbanColumn(inq, productsByInquiry[inq.id]);
      if (m[col]) m[col].push(inq);
    }
    return m;
  }, [columns, visibleInquiries, productsByInquiry]);

  const applyOptimistic = (inq: Inquiry, target: KanbanColumn): Inquiry => {
    if (ACTIVE_SUBSTAGES.includes(target)) {
      return { ...inq, status: 'active', kanban_substage_override: KANBAN_LABEL_TO_OVERRIDE[target] };
    }
    return { ...inq, status: KANBAN_COL_TO_STATUS[target], kanban_substage_override: null };
  };

  const moveInquiryToColumn = async (inquiryId: string, target: KanbanColumn) => {
    const inq = inquiries.find(i => i.id === inquiryId);
    if (!inq) return;
    const currentColumn = inquiryKanbanColumn(inq, productsByInquiry[inq.id]);
    if (currentColumn === target) return;
    const prev = inq;
    setInquiries(list => list.map(i => i.id === inquiryId ? applyOptimistic(i, target) : i));

    if (ACTIVE_SUBSTAGES.includes(target)) {
      if (inq.status !== 'active') {
        const result = await applyInquiryStatusChange(inquiryId, 'active', { previousStatus: inq.status });
        if (!result.ok) {
          setInquiries(list => list.map(i => i.id === inquiryId ? prev : i));
          toast.error(result.error ?? 'Could not move inquiry');
          return;
        }
      }
      const overrideValue = KANBAN_LABEL_TO_OVERRIDE[target];
      const { error } = await (supabase as any).from('customer_rfqs')
        .update({ kanban_substage_override: overrideValue }).eq('id', inquiryId);
      if (error) {
        setInquiries(list => list.map(i => i.id === inquiryId ? prev : i));
        toast.error('Could not move inquiry');
        return;
      }
    } else {
      const newStatus = KANBAN_COL_TO_STATUS[target];
      const result = await applyInquiryStatusChange(inquiryId, newStatus, { previousStatus: inq.status });
      if (!result.ok) {
        setInquiries(list => list.map(i => i.id === inquiryId ? prev : i));
        toast.error(result.error ?? 'Could not move inquiry');
        return;
      }
      // Clear override since it only applies within 'active'.
      await (supabase as any).from('customer_rfqs')
        .update({ kanban_substage_override: null }).eq('id', inquiryId);
    }
    setRefreshKey(k => k + 1);
  };

  const clearOverride = async (inquiryId: string) => {
    setInquiries(list => list.map(i => i.id === inquiryId ? { ...i, kanban_substage_override: null } : i));
    const { error } = await (supabase as any).from('customer_rfqs')
      .update({ kanban_substage_override: null }).eq('id', inquiryId);
    if (error) toast.error('Could not reset placement');
    setRefreshKey(k => k + 1);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    void moveInquiryToColumn(active.id as string, over.id as KanbanColumn);
  };

  if (loading) {
    return <div className="hidden md:block p-8 text-sm text-muted-foreground text-center">Loading…</div>;
  }
  if (visibleInquiries.length === 0) {
    return (
      <div className="hidden md:block">
        {inquiries.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-sm text-muted-foreground">No inquiries yet.</div>
            <Button size="sm" onClick={() => setShowNewInquiry(true)}>+ New Inquiry</Button>
          </div>
        ) : (
          <div className="p-8 text-sm text-muted-foreground text-center">No inquiries match your filters.</div>
        )}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div ref={desktopListRef} className="hidden md:flex gap-4 overflow-x-auto pb-2">
        {columns.map(col => {
          const items = byColumn[col] ?? [];
          return (
            <div key={col} className="w-80 shrink-0">
              <div className="flex items-baseline justify-between px-1 mb-2">
                <div className="flex items-center gap-2">
                  <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-semibold', COLUMN_COLOR[col])}>{col}</span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
              </div>
              <KanbanColumnDropzone id={col}>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No inquiries</p>
                ) : items.map(inq => (
                  <DraggableKanbanCard key={inq.id} inq={inq}>
                    <KanbanInquiryCard
                      inq={inq}
                      prods={productsByInquiry[inq.id]}
                      customer={inq.customer_id ? customerMap[inq.customer_id] : null}
                      hasReview={reviewInquiryIds.has(inq.id)}
                      navigate={navigate}
                      isAllStagesEmpty={isAllStagesEmpty}
                      renderStagePillsRow={renderStagePillsRow}
                      onMoveTo={(target) => moveInquiryToColumn(inq.id, target)}
                      onClearOverride={() => clearOverride(inq.id)}
                      onDelete={async () => {
                        const { error } = await supabase.from('customer_rfqs').delete().eq('id', inq.id);
                        if (error) throw error;
                        setRefreshKey(k => k + 1);
                      }}
                    />
                  </DraggableKanbanCard>
                ))}
              </KanbanColumnDropzone>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}

function KanbanColumnDropzone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-[120px] rounded-lg p-1.5 border border-dashed transition-colors',
        isOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/20',
      )}
    >
      {children}
    </div>
  );
}

function DraggableKanbanCard({ inq, children }: { inq: Inquiry; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: inq.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn('mb-2 outline-none', isDragging && 'opacity-60')}
    >
      {children}
    </div>
  );
}

type KanbanCardProps = {
  inq: Inquiry;
  prods: Product[] | undefined;
  customer: Customer | null;
  hasReview: boolean;
  navigate: ReturnType<typeof useNavigate>;
  isAllStagesEmpty: (prods: Product[] | undefined) => boolean;
  renderStagePillsRow: (prods: Product[] | undefined, inquiryId: string) => React.ReactNode;
  onMoveTo: (target: KanbanColumn) => void;
  onClearOverride: () => void;
  onDelete: () => Promise<void>;
};

function KanbanInquiryCard({
  inq, prods, customer, hasReview, navigate,
  isAllStagesEmpty, renderStagePillsRow, onMoveTo, onClearOverride, onDelete,
}: KanbanCardProps) {
  const navHandlers = rowNavHandlers(navigate, `/inquiry/${inq.id}`, { from: { label: 'Dashboard', path: '/' } });
  return (
    <RowContextMenu path={`/inquiry/${inq.id}`}>
      <Card
        data-row-nav
        tabIndex={0}
        role="link"
        aria-label={`Open inquiry ${inq.rfq_number}`}
        className={cn(
          'row-action active:scale-[0.99] transition-transform',
          hasReview && 'bg-amber-100 dark:bg-amber-500/15 border-l-2 border-amber-500',
        )}
        {...navHandlers}
      >
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-[11px] text-muted-foreground">{inq.rfq_number}</span>
                {hasReview && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200" title="Contains products that need review">⚠ Review</span>
                )}
                <span className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] font-medium',
                  INQUIRY_STATUS_COLORS[inq.status] || 'bg-muted',
                )}>{statusLabel(inq.status)}</span>
                {inq.kanban_substage_override && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Pin className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="top">Manually placed — may not match product progress below.</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="font-bold text-sm leading-tight mt-1 truncate">
                {inq.title || <span className="text-muted-foreground italic font-normal text-xs">Untitled</span>}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {customer?.name || customer?.company || 'No customer'}
              </div>
            </div>
            <div onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
                  {(['Idea','Costing','Quoted','Sampling'] as KanbanColumn[]).map(c => (
                    <DropdownMenuItem key={c} onClick={() => onMoveTo(c)}>{c}</DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  {(['Paused','Projected PO','PO','Complete','Cancelled'] as KanbanColumn[]).map(c => (
                    <DropdownMenuItem key={c} onClick={() => onMoveTo(c)}>{c}</DropdownMenuItem>
                  ))}
                  {inq.kanban_substage_override && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onClearOverride}>
                        <RotateCcw className="h-3.5 w-3.5 mr-2" /> Reset to automatic
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {!isAllStagesEmpty(prods) && renderStagePillsRow(prods, inq.id)}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{prods?.length ?? 0} {prods?.length === 1 ? 'product' : 'products'}</span>
            <span>{formatDistanceToNow(new Date(inq.updated_at), { addSuffix: true })}</span>
          </div>

          <div className="flex justify-end pt-0.5" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
            <ConfirmDeleteButton
              itemLabel={`inquiry ${inq.rfq_number}`}
              description={`This permanently removes inquiry ${inq.rfq_number} and all of its products, quotes, samples, and tasks.`}
              iconOnly
              onConfirm={onDelete}
            />
          </div>
        </CardContent>
      </Card>
    </RowContextMenu>
  );
}

export default Dashboard;

