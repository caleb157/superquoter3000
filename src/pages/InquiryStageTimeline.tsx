// Inquiry Sample Timeline — segmented stage board for every non-archived product
// in one inquiry. Rows = products, lanes = the three existing stage tracks
// (design / quote / sample) rendered as segmented progress bars.
//
// NOTE: the schema stores only the CURRENT stage per product, so this is a
// status board, not a date-based Gantt. A true time-based timeline would need
// stage-change history (product_stage_history {product_id, track, stage, changed_at})
// populated going forward — deliberately not built in this pass.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CalendarClock, Search } from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { ProductStagePills, STAGE_LABEL, STAGE_OPTIONS, type StageTrack } from '@/components/ProductStagePills';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { supabase } from '@/integrations/supabase/client';
import { customerPrimary } from '@/lib/customer-name';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Inquiry = {
  id: string;
  rfq_number: string;
  title: string | null;
  customers: { id: string; name: string | null; company: string | null } | null;
};

type Product = {
  id: string;
  name: string;
  sku: string | null;
  photo_url: string | null;
  sort_order: number | null;
  design_stage: string | null;
  quote_stage: string | null;
  sample_stage: string | null;
};

type Task = {
  id: string;
  product_id: string | null;
  title: string;
  due_date: string | null;
  status: string;
};

const TRACKS: { track: StageTrack; label: string }[] = [
  { track: 'design', label: 'Design' },
  { track: 'quote', label: 'Quote' },
  { track: 'sample', label: 'Sample' },
];

const trackValue = (p: Product, t: StageTrack) =>
  t === 'design' ? p.design_stage : t === 'quote' ? p.quote_stage : p.sample_stage;

const trackColumn: Record<StageTrack, 'design_stage' | 'quote_stage' | 'sample_stage'> = {
  design: 'design_stage',
  quote: 'quote_stage',
  sample: 'sample_stage',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function InquiryStageTimeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const inquiryId = searchParams.get('inquiry') || '';
  const navigate = useNavigate();

  const [inquiryOptions, setInquiryOptions] = useState<{ id: string; rfq_number: string; title: string | null }[]>([]);
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [sortKey, setSortKey] = useState<'order' | 'name' | 'progress' | 'due'>('order');

  useDocumentTitle(inquiry ? `Timeline — ${inquiry.title || inquiry.rfq_number}` : 'Sample Timeline');

  useEffect(() => {
    supabase
      .from('customer_rfqs')
      .select('id, rfq_number, title')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data }) => setInquiryOptions((data as any[]) || []));
  }, []);

  useEffect(() => {
    if (!inquiryId) { setLoading(false); setProducts([]); setInquiry(null); return; }

    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: inq }, { data: prods }, { data: tsk }] = await Promise.all([
        supabase
          .from('customer_rfqs')
          .select('id, rfq_number, title, customers(id, name, company)')
          .eq('id', inquiryId)
          .maybeSingle(),
        supabase
          .from('products')
          .select('id, name, sku, photo_url, sort_order, design_stage, quote_stage, sample_stage')
          .eq('customer_rfq_id', inquiryId)
          .is('archived_at', null)
          .order('sort_order', { ascending: true }),
        supabase.from('tasks').select('id, product_id, title, due_date, status').eq('inquiry_id', inquiryId),
      ]);
      if (cancelled) return;
      setInquiry((inq as any) || null);
      setProducts((prods as any[]) || []);
      setTasks((tsk as any[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [inquiryId]);

  /** product_id -> open tasks with a due date, soonest first */
  const tasksByProduct = useMemo(() => {
    const m: Record<string, Task[]> = {};
    tasks
      .filter(t => t.product_id && t.due_date && t.status !== 'completed' && t.status !== 'cancelled')
      .forEach(t => { (m[t.product_id!] ||= []).push(t); });
    Object.values(m).forEach(list => list.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')));
    return m;
  }, [tasks]);

  const today = todayIso();
  const dueInfo = (productId: string) => {
    const list = tasksByProduct[productId] || [];
    if (!list.length) return null;
    const next = list[0];
    return { next, count: list.length, overdue: (next.due_date || '') < today };
  };

  const progress = (p: Product) =>
    TRACKS.reduce((sum, t) => {
      const v = trackValue(p, t.track);
      const opts = STAGE_OPTIONS[t.track];
      const idx = v ? opts.indexOf(v) : -1;
      return sum + (idx < 0 ? 0 : (idx + 1) / opts.length);
    }, 0) / TRACKS.length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = products.filter(p => {
      if (q && !`${p.sku || ''} ${p.name}`.toLowerCase().includes(q)) return false;
      if (stageFilter !== 'all') {
        if (stageFilter === 'none') {
          if (p.design_stage || p.quote_stage || p.sample_stage) return false;
        } else if (![p.design_stage, p.quote_stage, p.sample_stage].includes(stageFilter)) return false;
      }
      return true;
    });
    return rows.sort((a, b) => {
      if (sortKey === 'name') return (a.sku || a.name).localeCompare(b.sku || b.name);
      if (sortKey === 'progress') return progress(a) - progress(b);
      if (sortKey === 'due') {
        const da = dueInfo(a.id)?.next.due_date || '9999-12-31';
        const db = dueInfo(b.id)?.next.due_date || '9999-12-31';
        return da.localeCompare(db);
      }
      return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);
    });
  }, [products, search, stageFilter, sortKey, tasksByProduct]);

  const overdueCount = visible.filter(p => dueInfo(p.id)?.overdue).length;

  const updateStage = async (productId: string, track: StageTrack, stage: string | null) => {
    const col = trackColumn[track];
    const prev = products;
    setProducts(ps => ps.map(p => (p.id === productId ? { ...p, [col]: stage } as Product : p)));
    const { error } = await supabase.from('products').update({ [col]: stage } as never).eq('id', productId);
    if (error) {
      setProducts(prev);
      toast.error('Could not update stage');
    }
  };

  return (
    <AppLayout>
      <TooltipProvider delayDuration={200}>
        <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
          <PageBreadcrumbs
            canonical={[{ label: 'Tools', to: '/tools' }]}
            current="Sample Timeline"
          />

          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Sample Timeline</h1>
              <p className="text-sm text-muted-foreground">
                Stage board across Design, Quote and Sample tracks
                {inquiry?.customers ? ` — ${customerPrimary(inquiry.customers)}` : ''}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={inquiryId}
                onValueChange={v => setSearchParams(v ? { inquiry: v } : {})}
              >
                <SelectTrigger className="h-9 w-[260px]"><SelectValue placeholder="Select an inquiry…" /></SelectTrigger>
                <SelectContent>
                  {inquiryOptions.map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.rfq_number} — {o.title || 'Untitled'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {inquiryId && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/inquiry/${inquiryId}`)}>
                  <ArrowLeft className="h-4 w-4" /> Inquiry
                </Button>
              )}
            </div>
          </div>


          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-9 pl-8"
                placeholder="Search SKU or product…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Stage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                <SelectItem value="none">No stage set</SelectItem>
                {TRACKS.flatMap(t =>
                  STAGE_OPTIONS[t.track].map(s => (
                    <SelectItem key={`${t.track}-${s}`} value={s}>{t.label}: {STAGE_LABEL[s]}</SelectItem>
                  )),
                )}
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={v => setSortKey(v as any)}>
              <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="order">Sort: inquiry order</SelectItem>
                <SelectItem value="name">Sort: name / SKU</SelectItem>
                <SelectItem value="progress">Sort: least progress</SelectItem>
                <SelectItem value="due">Sort: soonest due</SelectItem>
              </SelectContent>
            </Select>
            {overdueCount > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> {overdueCount} overdue
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">{visible.length} products</span>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="hidden md:grid grid-cols-[minmax(220px,1.4fr)_repeat(3,minmax(160px,1fr))_220px] gap-2 px-3 py-2 bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              <div>Product</div>
              {TRACKS.map(t => <div key={t.track}>{t.label}</div>)}
              <div>Due / stages</div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading timeline…</div>
            ) : visible.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {inquiryId ? 'No products match these filters.' : 'Select an inquiry to load its stage timeline.'}
              </div>

            ) : (
              visible.map(p => {
                const due = dueInfo(p.id);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'grid md:grid-cols-[minmax(220px,1.4fr)_repeat(3,minmax(160px,1fr))_220px] gap-2 px-3 py-2.5 border-t items-center',
                      'hover:bg-muted/40 transition-colors',
                      due?.overdue && 'bg-red-50/60 dark:bg-red-500/5',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {p.photo_url ? (
                        <img src={p.photo_url} alt={p.name} className="h-9 w-9 rounded object-cover border shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded bg-muted border shrink-0" />
                      )}
                      <div className="min-w-0">
                        <Link
                          to={`/product/${p.id}`}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {p.name}
                        </Link>
                        <div className="text-[11px] text-muted-foreground truncate">{p.sku || '—'}</div>
                      </div>
                    </div>

                    {TRACKS.map(t => (
                      <StageLane key={t.track} track={t.track} value={trackValue(p, t.track)} />
                    ))}

                    <div className="flex flex-col items-start gap-1.5">
                      {due ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border',
                                due.overdue
                                  ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              <CalendarClock className="h-3 w-3" />
                              {due.next.due_date}
                              {due.count > 1 && ` +${due.count - 1}`}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {due.overdue ? 'Overdue: ' : 'Next task: '}{due.next.title}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">No open tasks</span>
                      )}
                      <div className="flex flex-wrap gap-1"><ProductStagePills product={p} onChange={(track, stage) => updateStage(p.id, track, stage)} /></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Stages reflect current status only — historical stage dates aren't tracked yet, so this is a segmented
            status board rather than a date-based Gantt.
          </p>
        </div>
      </TooltipProvider>
    </AppLayout>
  );
}

function StageLane({ track, value }: { track: StageTrack; value: string | null | undefined }) {
  const opts = STAGE_OPTIONS[track];
  const idx = value ? opts.indexOf(value) : -1;
  const isDone = idx === opts.length - 1;
  return (
    <div className="min-w-0">
      <div className="flex gap-0.5">
        {opts.map((s, i) => {
          const reached = idx >= 0 && i <= idx;
          const current = i === idx;
          return (
            <Tooltip key={s}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'h-2.5 flex-1 rounded-sm transition-colors',
                    !reached && 'bg-muted',
                    reached && !isDone && 'bg-amber-300 dark:bg-amber-500/50',
                    reached && isDone && 'bg-emerald-400 dark:bg-emerald-500/60',
                    current && 'ring-1 ring-offset-1 ring-foreground/25',
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>{STAGE_LABEL[s] ?? s}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1 text-[11px] truncate text-muted-foreground">
        {value ? STAGE_LABEL[value] ?? value : 'Not started'}
      </div>
    </div>
  );
}
