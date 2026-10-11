// Costing Workspace — one place to cost an inquiry.
//
// Start from the whole inquiry (the bulk grid: price vs target, cost build-up, vendor
// quotes, hardware, packaging, setup) and drill into any SKU (the product panel) without
// leaving the page. Replaces the separate Pricing Grid, Target Grid and Bulk Costing Editor.
// All numbers come from the shared costing engine via src/lib/costing-workspace.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, FileSpreadsheet, Keyboard, Loader2, RefreshCw, Search, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

import { AppLayout } from '@/components/AppLayout';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { CostingIntakeDialog } from '@/components/CostingIntakeDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { customerPrimary } from '@/lib/customer-name';
import { invalidateShipmentPool } from '@/lib/shipment-pool';
import { cn } from '@/lib/utils';
import {
  buildRows, computeResults, loadBundle, persistDerived, totals,
  type Apply, type Bundle, type WorkspaceRow,
} from '@/lib/costing-workspace';
import { BulkBar } from '@/components/costing-workspace/BulkBar';
import { ProductPanel } from '@/components/costing-workspace/ProductPanel';
import { WorkspaceTable } from '@/components/costing-workspace/WorkspaceTable';
import { QuotesToolbar } from '@/components/costing-workspace/QuotesToolbar';
import { VIEWS } from '@/components/costing-workspace/columns';
import { Stat, focusCell, focusNavEl, pct, usd } from '@/components/costing-workspace/cells';

type Filter = 'all' | 'over' | 'flagged' | 'notarget';
type Sort = 'sheet' | 'gap' | 'price' | 'name' | 'name_desc' | 'sku' | 'sku_desc';
const natural = (a: unknown, b: unknown) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });

export default function CostingWorkspace() {
  const { id: inquiryId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [bundle, setBundle] = useState<Bundle | null>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('sheet');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [extraSlots, setExtraSlots] = useState(0);
  const [intakeOpen, setIntakeOpen] = useState(false);

  const viewId = params.get('view') || 'price';
  const view = VIEWS.find(v => v.id === viewId) ?? VIEWS[0];
  const openId = params.get('sku');
  const setParam = (k: string, v: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (v == null) next.delete(k); else next.set(k, v);
    return next;
  }, { replace: true });

  const load = useCallback(async () => {
    if (!inquiryId) return;
    const b = await loadBundle(inquiryId);
    bundleRef.current = b;
    setBundle(b);
    setLoading(false);
  }, [inquiryId]);
  useEffect(() => { void load(); }, [load]);

  const results = useMemo(() => (bundle ? computeResults(bundle) : new Map()), [bundle]);
  const rows = useMemo(() => (bundle ? buildRows(bundle, results) : []), [bundle, results]);
  const t = useMemo(() => totals(rows), [rows]);

  useDocumentTitle(bundle ? `Costing · ${bundle.inq.title || bundle.inq.rfq_number}` : 'Costing workspace');

  // ---------- writes ----------

  // Engine-derived values (auto rows, cached price on the product) are written back a
  // moment after edits settle, so lists elsewhere in the app stay current.
  const pendingDerived = useRef<Set<string>>(new Set());
  const derivedTimer = useRef<number | null>(null);
  const scheduleDerived = useCallback((ids: string[]) => {
    ids.forEach(id => pendingDerived.current.add(id));
    if (derivedTimer.current) window.clearTimeout(derivedTimer.current);
    derivedTimer.current = window.setTimeout(() => {
      const b = bundleRef.current;
      const idsNow = [...pendingDerived.current];
      pendingDerived.current.clear();
      if (!b || !idsNow.length) return;
      persistDerived(b, computeResults(b), idsNow).catch(e => console.error('persistDerived', e));
    }, 1500);
  }, []);

  const apply: Apply = useCallback(build => {
    const cur = bundleRef.current;
    if (!cur) return;
    const m = build(cur);
    if (!m) { toast.error('That value isn’t valid here'); return; }
    bundleRef.current = m.next;
    setBundle(m.next);
    setSaving(s => s + 1);
    m.commit()
      .then(() => {
        setSavedAt(Date.now());
        invalidateShipmentPool(inquiryId);
        // Whole-inquiry FOB pooling means one SKU's CBM can move every SKU's shipping.
        scheduleDerived(m.next.products.map(p => p.id));
      })
      .catch(e => { toast.error(`Couldn’t save: ${e?.message || e}`); void load(); })
      .finally(() => setSaving(s => s - 1));
  }, [inquiryId, load, scheduleDerived]);

  // ---------- filtering & sorting ----------

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter(r => !q || `${r.p.name} ${r.p.sku || ''} ${r.rawVendor}`.toLowerCase().includes(q));
    if (filter === 'over') out = out.filter(r => (r.gapUsd ?? 0) > 0.005);
    if (filter === 'flagged') out = out.filter(r => r.flags.some(f => f.kind !== 'target'));
    if (filter === 'notarget') out = out.filter(r => r.targetUsd == null);
    if (sort === 'gap') out = [...out].sort((a, b) => (b.gapPct ?? -Infinity) - (a.gapPct ?? -Infinity));
    if (sort === 'price') out = [...out].sort((a, b) => b.priceUsd - a.priceUsd);
    if (sort === 'name') out = [...out].sort((a, b) => natural(a.p.name, b.p.name));
    if (sort === 'name_desc') out = [...out].sort((a, b) => natural(b.p.name, a.p.name));
    if (sort === 'sku') out = [...out].sort((a, b) => natural(a.p.sku, b.p.sku));
    if (sort === 'sku_desc') out = [...out].sort((a, b) => natural(b.p.sku, a.p.sku));
    return out;
  }, [rows, search, filter, sort]);

  const maxQuotes = useMemo(() => rows.reduce((m, r) => Math.max(m, r.quotes.length), 0), [rows]);
  const quoteSlots = Math.max(3, maxQuotes) + extraSlots;

  // ---------- selection ----------

  const toggleRow = (idx: number, shift: boolean) => {
    const pid = visibleRows[idx].p.id;
    setSelected(prev => {
      const next = new Set(prev);
      const on = !prev.has(pid);
      if (shift && lastClicked.current != null) {
        const [a, b] = [Math.min(lastClicked.current, idx), Math.max(lastClicked.current, idx)];
        for (let i = a; i <= b; i++) { const id = visibleRows[i]?.p.id; if (id) { if (on) next.add(id); else next.delete(id); } }
      } else if (on) next.add(pid); else next.delete(pid);
      return next;
    });
    lastClicked.current = idx;
  };
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(r => selected.has(r.p.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visibleRows.map(r => r.p.id)));

  // ---------- panel navigation ----------

  const openIdx = visibleRows.findIndex(r => r.p.id === openId);
  const openRow: WorkspaceRow | undefined = rows.find(r => r.p.id === openId);
  const go = (d: number) => {
    const next = visibleRows[openIdx + d];
    if (next) setParam('sku', next.p.id);
  };
  const gridId = view.id === 'quotes' && !openId ? 'quotes' : openId ? 'compact' : view.id;
  /** Put keyboard focus on a row's name cell (or the first row when none is given). */
  const focusRow = (pid?: string | null) => requestAnimationFrame(() => {
    const el = pid ? document.querySelector<HTMLElement>(`[data-col="name"][data-pid="${pid}"]`) : null;
    if (!focusNavEl(el)) focusCell(gridId, 0, 'name');
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const tag = el?.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable;
      if (e.key === 'Escape' && openId && !e.defaultPrevented && (!typing || el.closest('[data-grid]'))) {
        setParam('sku', null); focusRow(openId); return;
      }
      if (typing || e.defaultPrevented || el?.closest?.('[data-grid]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'g') { e.preventDefault(); focusRow(openId); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= VIEWS.length) { setParam('view', VIEWS[n - 1].id === 'price' ? null : VIEWS[n - 1].id); return; }
      if (openId && (e.key === 'j' || e.key === 'ArrowDown')) { e.preventDefault(); go(1); }
      if (openId && (e.key === 'k' || e.key === 'ArrowUp')) { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- export ----------

  const exportXlsx = () => {
    if (!bundle) return;
    const header = ['SKU', 'Name', 'Qty', 'Raw vendor', 'Raw piece ₹', 'Subcontract ₹', 'Outsourced ₹', 'Hardware ₹', 'Finishing ₹', 'Packaging ₹',
      'Other COGS ₹', 'Labor & OH ₹', 'Shipping ₹', 'Unit cost ₹', 'NPM %', 'Contribution %', 'Indirect OH ₹', 'Price ₹', 'Price $', 'Target $', 'Gap $', 'Unit CBM', 'Issues'];
    const data = rows.map(r => [
      r.p.sku || '', r.p.name || '', r.qty, r.rawVendor, r.buckets.raw_piece, r.buckets.subcontract, r.buckets.outsourced, r.buckets.hardware,
      r.buckets.finishing, r.buckets.packaging, r.buckets.other, r.buckets.labor, r.buckets.shipping, r.costInr,
      +(r.margin * 100).toFixed(2), +(r.contribution * 100).toFixed(2), r.indirectInr, r.priceInr, +r.priceUsd.toFixed(2), r.targetUsd ?? '', r.gapUsd == null ? '' : +r.gapUsd.toFixed(2),
      +r.r.finalUnitCbm.toFixed(4), r.flags.map(f => f.msg).join('; '),
    ].map(v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
    const ws = XLSX.utils.aoa_to_sheet([
      ['Inquiry', bundle.inq.rfq_number], ['Title', bundle.inq.title || ''], ['Customer', customerPrimary(bundle.customer)],
      ['Generated', new Date().toISOString()], [], header, ...data,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Costing');
    XLSX.writeFile(wb, `${bundle.inq.rfq_number}_costing.xlsx`);
  };

  // ---------- render ----------

  if (loading) {
    return <AppLayout><div className="py-24 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div></AppLayout>;
  }
  if (!bundle) return <AppLayout><div className="py-24 text-center text-muted-foreground">Inquiry not found.</div></AppLayout>;

  const title = bundle.inq.title || bundle.inq.rfq_number;
  const targetDelta = t.withTarget ? rows.filter(r => r.targetUsd != null).reduce((a, r) => a + (r.gapUsd ?? 0) * r.qty, 0) : null;
  const selectedIds = [...selected].filter(id => rows.some(r => r.p.id === id));

  return (
    <AppLayout>
      <TooltipProvider delayDuration={200}>
        <div className="fixed inset-x-0 top-12 bottom-14 md:bottom-0 flex flex-col gap-3 bg-background px-4 pt-3 pb-3">
          {/* Title row */}
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8 -ml-1 mt-0.5 shrink-0" onClick={() => navigate(`/inquiry/${inquiryId}`)} aria-label="Back to inquiry">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <PageBreadcrumbs canonical={[{ label: 'Inquiries', to: '/inquiries' }, { label: title, to: `/inquiry/${inquiryId}` }]} current="Costing" />
              <div className="flex items-baseline gap-2 min-w-0">
                <h1 className="text-xl font-semibold truncate">{title}</h1>
                <span className="text-sm text-muted-foreground truncate">{bundle.inq.rfq_number}{bundle.customer ? ` · ${customerPrimary(bundle.customer)}` : ''}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-[72px]">
                {saving > 0 ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : savedAt ? <><Check className="h-3.5 w-3.5 text-primary" /> Saved</> : null}
              </span>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setIntakeOpen(true)}><FileSpreadsheet className="h-4 w-4" /> Import sheet</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={exportXlsx}><Download className="h-4 w-4" /> Export</Button>
              <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => { setLoading(true); void load(); }} aria-label="Reload"><RefreshCw className="h-4 w-4" /></Button>
              <ShortcutsButton />
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 lg:grid-cols-7 gap-2">
            <Stat label="SKUs" value={t.skus} sub={`${t.units.toLocaleString()} units`} />
            <Stat label="Order FOB" value={usd(t.fobUsd, 0)} sub={`cost ${usd(t.costUsd, 0)}`} />
            <Stat label="Blended NPM" value={pct(t.margin)} tone={t.margin < 0.1 ? 'bad' : 'good'} sub={`${usd(t.fobUsd - t.costUsd, 0)} profit`}
              hint="Order profit ÷ order FOB, weighted by each line's dollars. Cost is the full costing-sheet cost, including direct labor, indirect overhead, shipping and cost of capital." />
            <Stat label="Contribution" value={pct(t.contribution)} sub={`${usd(t.fobUsd - t.costUsd + t.indirectUsd, 0)} · ${usd(t.indirectUsd, 0)} overhead`}
              hint="Net profit plus the indirect (factory) overhead this order absorbs, ÷ order FOB. Bought-in items carry no man-hours, so for trading work this equals NPM; manufacturing work shows how much it also pays toward fixed overhead." />
            <Stat label="Packed CBM" value={t.cbm.toFixed(2)} sub={`≈ ${(t.cbm / 68).toFixed(2)} × 40HC`} />
            <Stat label="Over target" value={t.withTarget ? `${t.overTarget} / ${t.withTarget}` : '—'}
              tone={t.overTarget ? 'bad' : t.withTarget ? 'good' : undefined}
              sub={targetDelta == null ? 'no targets set' : `${targetDelta > 0 ? '+' : ''}${usd(targetDelta, 0)} order vs targets`}
              onClick={() => setFilter(f => (f === 'over' ? 'all' : 'over'))} active={filter === 'over'} />
            <Stat label="Needs a look" value={t.flagged} tone={t.flagged ? 'warn' : undefined} sub="blank or odd-one-out costs"
              onClick={() => setFilter(f => (f === 'flagged' ? 'all' : 'flagged'))} active={filter === 'flagged'} />
          </div>

          {/* View switcher + filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border bg-muted/60 p-0.5">
              {VIEWS.map(v => (
                <button key={v.id} onClick={() => setParam('view', v.id === 'price' ? null : v.id)} title={v.hint}
                  className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    v.id === view.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {v.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU, name, vendor" className="h-9 w-56 pl-8"
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusRow(); } else if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); } }} />
                {search && <button className="absolute right-2 top-2.5 text-muted-foreground" onClick={() => setSearch('')}><X className="h-4 w-4" /></button>}
              </div>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={filter} onChange={e => setFilter(e.target.value as Filter)}>
                <option value="all">All SKUs</option>
                <option value="over">Over target</option>
                <option value="flagged">Needs a look</option>
                <option value="notarget">No target</option>
              </select>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={sort} onChange={e => setSort(e.target.value as Sort)}>
                <option value="sheet">Sheet order</option>
                <option value="gap">Furthest over target</option>
                <option value="price">Highest price</option>
                <option value="name">Name A–Z</option>
                <option value="name_desc">Name Z–A</option>
                <option value="sku">SKU code A–Z</option>
                <option value="sku_desc">SKU code Z–A</option>
              </select>
            </div>
          </div>

          {view.id === 'quotes' && (
            <QuotesToolbar bundle={bundle} rows={visibleRows} slots={quoteSlots} targetIds={selectedIds} apply={apply} onImported={() => void load()} />
          )}

          {/* Grid + panel */}
          <div className={cn('flex min-h-0 flex-1 gap-3', selectedIds.length > 0 && 'mb-[68px]')}>
            <div className={cn('min-h-0 overflow-auto rounded-xl border bg-card', openRow ? 'w-[470px] shrink-0' : 'flex-1')}>
              {visibleRows.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? 'This inquiry has no products yet.' : 'No SKUs match.'}
                </div>
              ) : (
                <WorkspaceTable
                  view={view} rows={visibleRows} bundle={bundle} apply={apply}
                  selected={selected} onToggle={toggleRow} onToggleAll={toggleAll}
                  nameSort={sort === 'name' ? 'asc' : sort === 'name_desc' ? 'desc' : null}
                  onSortName={() => setSort(s => (s === 'name' ? 'name_desc' : s === 'name_desc' ? 'sheet' : 'name'))}
                  openId={openId} onOpen={id => setParam('sku', id === openId ? null : id)}
                  compact={!!openRow} quoteSlots={quoteSlots} onAddQuoteSlot={() => setExtraSlots(s => s + 1)}
                />
              )}
            </div>
            {openRow && (
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border">
                <ProductPanel
                  key={openRow.p.id}
                  row={openRow} bundle={bundle} apply={apply}
                  onClose={() => setParam('sku', null)}
                  onPrev={openIdx > 0 ? () => go(-1) : undefined}
                  onNext={openIdx >= 0 && openIdx < visibleRows.length - 1 ? () => go(1) : undefined}
                  position={openIdx >= 0 ? `${openIdx + 1} of ${visibleRows.length}` : ''}
                />
              </div>
            )}
          </div>

          {selectedIds.length > 0 && (
            <div className="pointer-events-none absolute inset-x-4 bottom-5 z-30">
              <BulkBar ids={selectedIds} rows={rows} bundle={bundle} apply={apply} onClear={() => setSelected(new Set())} />
            </div>
          )}
        </div>
        <CostingIntakeDialog open={intakeOpen} onOpenChange={setIntakeOpen} inquiryId={inquiryId!} mode="update" onApplied={() => void load()} />
      </TooltipProvider>
    </AppLayout>
  );
}


const SHORTCUTS: [string, string][] = [
  ['← → ↑ ↓', 'Move between cells'],
  ['Tab / Shift+Tab', 'Next / previous cell (wraps to the next row)'],
  ['Enter / Shift+Enter', 'Save and move down / up'],
  ['Type, F2 or click again', 'Edit the cell (arrows then move the cursor)'],
  ['Esc', 'Undo the edit in progress, or close the product panel'],
  ['Ctrl+↑ ↓  ·  Home / End', 'First / last row  ·  first / last cell in the row'],
  ['Page Up / Down', 'Jump 10 rows'],
  ['Ctrl+V', 'Paste a block from Excel or Sheets (fills down and across)'],
  ['Space (on SKU)', 'Select the row (Shift+Space selects a range)'],
  ['Enter (on SKU)', 'Open the product panel; ↑ ↓ then step through SKUs'],
  ['Enter / Space (on a menu)', 'Open the dropdown; typing a letter picks an option'],
  ['/', 'Search'],
  ['g', 'Jump into the grid'],
  ['1 – 6', 'Switch view'],
];

function ShortcutsButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="outline" className="h-9 w-9" aria-label="Keyboard shortcuts"><Keyboard className="h-4 w-4" /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] p-3">
        <div className="mb-2 text-sm font-semibold">Keyboard</div>
        <table className="w-full text-xs">
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k} className="align-top">
                <td className="whitespace-nowrap py-1 pr-3"><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd></td>
                <td className="py-1 text-muted-foreground">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}
