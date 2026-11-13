// The costing sheet — one place to cost an inquiry. It is the inquiry page's Costing tab:
// the inquiry header and tab bar come in as `lead`, the assumptions that drive every SKU sit
// above the sheet, and the quotes and projection sit beside it.
//
// Start from the whole inquiry (the bulk grid, laid out like the costing sheet: COGS, then
// labour, then shipping, then margin, each step folding to its subtotal) and drill into any
// SKU (the product panel, same four steps) without leaving the page. Replaces the separate Pricing Grid, Target Grid and Bulk Costing Editor.
// All numbers come from the shared costing engine via src/lib/costing-workspace.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronsLeftRight, ChevronsRightLeft, Download, FileSpreadsheet, FileText, Keyboard, Loader2, PanelRightOpen, Redo2, RefreshCw, Scale, Search, Target, Undo2, X } from 'lucide-react';
import { loadXlsx } from '@/lib/xlsx-lazy';
import { toast } from 'sonner';

import { CostingIntakeDialog } from '@/components/CostingIntakeDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { customerPrimary } from '@/lib/customer-name';
import { cn } from '@/lib/utils';
import { loadBundle, priceToQuoted, targetFromQuoted, targetIsQuoted, type WorkspaceRow } from '@/lib/costing-workspace';
import { cloneProductToInquiry } from '@/lib/product-clone';
import { supabase } from '@/integrations/supabase/client';
import { useCostingBundle } from '@/hooks/use-costing-bundle';
import { useGenerateQuote } from '@/hooks/use-generate-quote';
import { BulkBar } from '@/components/costing-workspace/BulkBar';
import { ProductPanel } from '@/components/costing-workspace/ProductPanel';
import { WorkspaceTable } from '@/components/costing-workspace/WorkspaceTable';
import { QuotesToolbar } from '@/components/costing-workspace/QuotesToolbar';
import { BANDS, DEFAULT_OPEN, fitLayout, type OpenState } from '@/components/costing-workspace/columns';
import { NAME_WIDTH } from '@/components/costing-workspace/WorkspaceTable';
import { InquiryQuotesTab } from '@/components/InquiryQuotesTab';
import { InquiryProjectionTab } from '@/components/InquiryProjectionTab';
import { AssumptionsStrip } from '@/components/costing-workspace/AssumptionsStrip';
import { InquirySide, useInquirySide } from '@/components/costing-workspace/InquirySide';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Stat, focusCell, focusNavEl, pct } from '@/components/costing-workspace/cells';
import { formatMoney, quoteCurrencyOf } from '@/lib/quote-currency';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const OPEN_KEY = 'costing-workspace-open';
const SIDE_KEY = 'costing-side-open';
/** Side cards (300) plus the gap; and the sheet's width while the product panel is open. */
const SIDE_WIDTH = 312;
const PANEL_GRID = 470;
/** Old ?view= links (from before the four steps) open the step that now holds those columns. */
const VIEW_TO_OPEN: Record<string, string[]> = {
  price: ['margin'], buildup: ['cogs'], hardware: ['cogs', 'hardware'], packaging: ['shipping', 'cartons'], labor: ['labour'], setup: ['cogs', 'labour'],
};
function readOpen(): OpenState {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null'); if (v && typeof v === 'object') return v; } catch { /* private mode */ }
  return DEFAULT_OPEN;
}

type Filter = 'all' | 'over' | 'flagged' | 'notarget';
type Sort = 'sheet' | 'gap' | 'price' | 'name' | 'name_desc' | 'sku' | 'sku_desc';
const natural = (a: unknown, b: unknown) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });

export function CostingSheet({ inquiryId, lead, onInquiryPatched }: {
  inquiryId: string;
  /** The inquiry header and tab bar; it is handed the sheet's own buttons (saved, undo, import…) to place in the header. */
  lead: (actions: React.ReactNode) => React.ReactNode;
  /** An assumption changed here: the inquiry page keeps its own copy of the inquiry in step. */
  onInquiryPatched?: (inq: any) => void;
}) {
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('sheet');
  // ?select=id,id (from the inquiry's Bulk edit menu) starts with those products selected.
  const [selected, setSelected] = useState<Set<string>>(() => new Set((params.get('select') || '').split(',').filter(Boolean)));
  const lastClicked = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [extraSlots, setExtraSlots] = useState(0);
  const [intakeOpen, setIntakeOpen] = useState(false);

  const quotesMode = params.get('view') === 'quotes';
  const [open, setOpen] = useState<OpenState>(() => {
    const legacy = VIEW_TO_OPEN[params.get('view') || ''];
    return legacy ? { ...readOpen(), ...Object.fromEntries(legacy.map(k => [k, true])) } : readOpen();
  });
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* private mode */ } }, [open]);
  // One step open at a time, so the sheet stays on the screen: opening a step folds the others
  // (their subtotals stay in view). "Open all steps" still lays the whole sheet out. Sub-groups
  // (raw piece, hardware, cartons) keep their own state.
  const toggleOpen = (k: string) => setOpen(o => {
    if (!BANDS.some(b => b.id === k)) return { ...o, [k]: !o[k] };
    return { ...o, ...Object.fromEntries(BANDS.map(b => [b.id, b.id === k ? !o[k] : false])) };
  });
  const setAllOpen = (on: boolean) => setOpen(o => ({ ...o, ...Object.fromEntries(BANDS.map(b => [b.id, on])) }));
  const allOpen = BANDS.every(b => open[b.id]);
  const openId = params.get('sku');
  const setParam = (k: string, v: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (v == null) next.delete(k); else next.set(k, v);
    return next;
  }, { replace: true });

  const loader = useCallback(() => loadBundle(inquiryId), [inquiryId]);
  const { bundle, loading, loadError, saving, savedAt, load, reload, apply, rows, t, undo, redo, canUndo, canRedo } = useCostingBundle(inquiryId ? loader : null);
  const doUndo = () => { if (undo()) toast('Undone', { action: { label: 'Redo', onClick: () => { redo(); } } }); else toast.info('Nothing to undo'); };
  const doRedo = () => { if (redo()) toast('Redone'); else toast.info('Nothing to redo'); };
  // Rupee customers get the whole workspace in ₹ (the inquiry's Quoting currency).
  const cur = quoteCurrencyOf(bundle?.inq);
  // The width the sheet and its side cards share, so the columns can be laid out to fit
  // without scrolling sideways. The side cards give way when a step needs the whole width.
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const rowObserver = useRef<ResizeObserver | null>(null);
  const rowRef = useCallback((el: HTMLDivElement | null) => {
    rowObserver.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    rowObserver.current = new ResizeObserver(() => setRowWidth(el.clientWidth));
    rowObserver.current.observe(el);
    setRowWidth(el.clientWidth);
  }, []);
  const [sideOpen, setSideOpen] = useState(() => { try { return localStorage.getItem(SIDE_KEY) !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem(SIDE_KEY, sideOpen ? '1' : '0'); } catch { /* private mode */ } }, [sideOpen]);
  const panelOpen = !!openId;
  const { fit, showSide, sideSqueezed } = useMemo(() => {
    const budget = (w: number) => ({ full: w - 2 - NAME_WIDTH.sheet - 16, tight: w - 2 - NAME_WIDTH.tight - 16 });
    if (rowWidth == null) return { fit: fitLayout(open, cur, null), showSide: false, sideSqueezed: false };
    if (panelOpen) return { fit: fitLayout(open, cur, budget(PANEL_GRID)), showSide: false, sideSqueezed: false };
    const sideCan = sideOpen && !quotesMode && rowWidth >= 1000;
    const withSide = sideCan ? fitLayout(open, cur, budget(rowWidth - SIDE_WIDTH)) : null;
    if (withSide?.fits) return { fit: withSide, showSide: true, sideSqueezed: false };
    return { fit: fitLayout(open, cur, budget(rowWidth)), showSide: false, sideSqueezed: sideCan };
  }, [open, cur, rowWidth, sideOpen, quotesMode, panelOpen]);
  const cols = fit.cols;
  const [quotesOpen, setQuotesOpen] = useState(false);
  const [projectionOpen, setProjectionOpen] = useState(false);
  const side = useInquirySide(inquiryId);
  // Tell the inquiry page when an assumption changed (not on the first load).
  const seenInq = useRef<any>(null);
  useEffect(() => {
    if (!bundle?.inq) return;
    if (seenInq.current && seenInq.current !== bundle.inq) onInquiryPatched?.(bundle.inq);
    seenInq.current = bundle.inq;
  }, [bundle?.inq]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = (n: number, d = 0) => formatMoney(n, cur, d);
  const quote = useGenerateQuote(inquiryId);
  /** Draft quote from the ticked SKUs at the prices the grid shows (same engine numbers). */
  const generateQuote = async (ids: string[]) => {
    await quote.generate(rows.filter(r => ids.includes(r.p.id)).map(r => ({
      id: r.p.id, name: r.p.name, quantity: r.qty,
      reference_price_usd: r.r.summary.unit_price_usd,
      reference_price_inr: r.r.summary.unit_price_inr,
      target_price_usd: r.p.target_price_usd, markup_percent: r.p.markup_percent,
    })));
    void side.reload();
  };
  /** New SKUs with the same costing (the shared product clone), named "(copy)" with the SKU code left for the user. */
  const [duplicating, setDuplicating] = useState(false);
  const duplicate = async (ids: string[]) => {
    if (!bundle?.inq?.id) return;
    if (saving > 0) { toast.info('Still saving the last change. Try again in a moment.'); return; }
    setDuplicating(true);
    try {
      const made: string[] = [];
      for (const id of ids) {
        const src = bundle.products.find(p => p.id === id);
        if (!src) continue;
        const newId = await cloneProductToInquiry(id, bundle.inq.id, `${src.name || 'Untitled'} (copy)`);
        if (!newId) continue;
        // Fields the generic clone leaves out but costing uses.
        await (supabase as any).from('products').update({
          sku: null, running_inches_override: src.running_inches_override ?? null, hard_moq: src.hard_moq ?? null,
          target_price_inr: src.target_price_inr ?? null, cost_of_capital_enabled: src.cost_of_capital_enabled ?? null,
          cost_of_capital_monthly_rate: src.cost_of_capital_monthly_rate ?? null, cost_of_capital_months: src.cost_of_capital_months ?? null,
        }).eq('id', newId);
        made.push(newId);
      }
      await load();
      if (made.length) { setSelected(new Set(made)); toast.success(`Duplicated ${made.length} SKU${made.length === 1 ? '' : 's'}. Give ${made.length === 1 ? 'it' : 'them'} a SKU code.`); }
      if (made.length < ids.length) toast.error(`Couldn’t duplicate ${ids.length - made.length} SKU${ids.length - made.length === 1 ? '' : 's'}`);
    } finally {
      setDuplicating(false);
    }
  };

  useEffect(() => {
    if (params.has('select')) setParam('select', null);
    if (VIEW_TO_OPEN[params.get('view') || '']) setParam('view', null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // ---------- filtering & sorting ----------

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter(r => !q || `${r.p.name} ${r.p.sku || ''} ${r.rawVendor}`.toLowerCase().includes(q));
    if (filter === 'over') out = out.filter(r => (r.gap ?? 0) > 0.005);
    if (filter === 'flagged') out = out.filter(r => r.flags.some(f => f.kind !== 'target'));
    if (filter === 'notarget') out = out.filter(r => r.target == null);
    if (sort === 'gap') out = [...out].sort((a, b) => (b.gapPct ?? -Infinity) - (a.gapPct ?? -Infinity));
    if (sort === 'price') out = [...out].sort((a, b) => b.price - a.price);
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
  const gridId = quotesMode && !openId ? 'quotes' : openId ? 'compact' : 'sheet';
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
      // Ctrl+Z / Ctrl+Y undo saved edits, except while typing in a field (the field's own undo).
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
        const inGridCell = !!el?.closest?.('[data-grid]') && !el.closest('[data-editing]');
        if (typing && !inGridCell) return;
        e.preventDefault();
        if (k === 'y' || e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if (e.key === 'Escape' && openId && !e.defaultPrevented && (!typing || el.closest('[data-grid]'))) {
        setParam('sku', null); focusRow(openId); return;
      }
      if (typing || e.defaultPrevented || el?.closest?.('[data-grid]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'g') { e.preventDefault(); focusRow(openId); return; }
      const n = Number(e.key);
      const band = BANDS.find(b => b.n === n);
      if (band) {
        if (quotesMode) { setParam('view', null); if (!open[band.id]) toggleOpen(band.id); } else toggleOpen(band.id);
        return;
      }
      if (e.key === 'q') { setParam('view', quotesMode ? null : 'quotes'); return; }
      if (openId && (e.key === 'j' || e.key === 'ArrowDown')) { e.preventDefault(); go(1); }
      if (openId && (e.key === 'k' || e.key === 'ArrowUp')) { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- export ----------

  const exportXlsx = async () => {
    if (!bundle) return;
    const XLSX = await loadXlsx();
    const header = ['SKU', 'Name', 'Qty', 'Raw vendor', 'Raw piece ₹', 'Subcontract ₹', 'Outsourced ₹', 'Hardware ₹', 'Finishing ₹', 'Packaging ₹',
      'Other COGS ₹', 'Labor & OH ₹', 'Shipping ₹', 'Unit cost ₹', 'NPM %', 'Contribution %', 'Indirect OH ₹', 'Price ₹', ...(cur === 'INR' ? ['Quoted ₹', 'Target ₹', 'Gap ₹'] : ['Price $', 'Quoted $', 'Target $', 'Gap $']), 'Unit CBM', 'Issues'];
    const data = rows.map(r => [
      r.p.sku || '', r.p.name || '', r.qty, r.rawVendor, r.buckets.raw_piece, r.buckets.subcontract, r.buckets.outsourced, r.buckets.hardware,
      r.buckets.finishing, r.buckets.packaging, r.buckets.other, r.buckets.labor, r.buckets.shipping, r.costInr,
      +(r.margin * 100).toFixed(2), +(r.contribution * 100).toFixed(2), r.indirectInr, r.priceInr, ...(cur === 'INR' ? [] : [r.price]), r.quoted?.price ?? '', r.target ?? '', r.gap ?? '',
      +r.r.finalUnitCbm.toFixed(4), r.flags.map(f => f.msg).join('; '),
    ].map(v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
    const ws = XLSX.utils.aoa_to_sheet([
      ['Inquiry', bundle.inq.rfq_number], ['Title', bundle.inq.title || ''], ['Customer', customerPrimary(bundle.customer)],
      ['Currency', cur], ['Generated', new Date().toISOString()], [], header, ...data,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Costing');
    XLSX.writeFile(wb, `${bundle.inq.rfq_number}_costing.xlsx`);
  };

  // ---------- render ----------

  const shell = (body: React.ReactNode) => (
    <div className="fixed inset-x-0 top-12 bottom-14 md:bottom-0 flex flex-col gap-2.5 bg-background px-4 pt-3 pb-3">{lead(null)}{body}</div>
  );
  if (loading) return shell(<div className="py-24 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>);
  if (!bundle && loadError) return shell(
    <div className="py-24 text-center text-muted-foreground space-y-3">
      <p>Couldn’t load this inquiry’s costing. Nothing was changed.</p>
      <Button variant="outline" size="sm" onClick={() => void reload()}>Retry</Button>
    </div>,
  );
  if (!bundle) return shell(<div className="py-24 text-center text-muted-foreground">Inquiry not found.</div>);

  const title = bundle.inq.title || bundle.inq.rfq_number;
  const targetDelta = t.withTarget ? rows.filter(r => r.target != null).reduce((a, r) => a + (r.gap ?? 0) * r.qty, 0) : null;
  const selectedIds = [...selected].filter(id => rows.some(r => r.p.id === id));
  // SKUs that have been quoted but whose target isn't that quoted price (yet).
  const offQuoted = visibleRows.filter(r => r.quoted && !targetIsQuoted(r));
  const quotedCount = rows.filter(r => r.quoted).length;
  const quotedToTargets = () => {
    const n = offQuoted.length;
    apply(b => targetFromQuoted(b, rows, offQuoted.map(r => r.p.id)));
    toast.success(`Target set to the last quoted price on ${n} SKU${n === 1 ? '' : 's'}`, { action: { label: 'Undo', onClick: () => { undo(); } } });
  };

  const holdQuoted = (ids: string[]) => {
    apply(b => priceToQuoted(b, rows, ids));
    toast.success(`${ids.length} SKU${ids.length === 1 ? '' : 's'} back on the quoted price`, { action: { label: 'Undo', onClick: () => { undo(); } } });
  };
  const actions = (
    <>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-[72px]">
                {saving > 0 ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : savedAt ? <><Check className="h-3.5 w-3.5 text-primary" /> Saved</> : null}
              </span>
              <div className="flex">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" disabled={!canUndo} onClick={doUndo} aria-label="Undo"><Undo2 className="h-4 w-4" /></Button>
                  </TooltipTrigger>
                  <TooltipContent>Undo the last change (Ctrl+Z)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" disabled={!canRedo} onClick={doRedo} aria-label="Redo"><Redo2 className="h-4 w-4" /></Button>
                  </TooltipTrigger>
                  <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
                </Tooltip>
              </div>
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setIntakeOpen(true)}><FileSpreadsheet className="h-4 w-4" /> Import sheet</Button>
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={exportXlsx}><Download className="h-4 w-4" /> Export</Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" onClick={() => void reload()} aria-label="Reload"><RefreshCw className="h-4 w-4" /></Button>
              <ShortcutsButton />
    </>
  );

  return (
      <TooltipProvider delayDuration={200}>
        <div className="fixed inset-x-0 top-12 bottom-14 md:bottom-0 flex flex-col gap-2.5 bg-background px-4 pt-3 pb-3">
          {lead(actions)}

          {/* KPIs */}
          <div className="grid shrink-0 grid-cols-3 divide-x divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-card lg:grid-cols-7">
            <Stat flat label="SKUs" value={t.skus} sub={`${t.units.toLocaleString()} units`} />
            <Stat flat label="Order FOB" value={m(t.fob)} sub={`cost ${m(t.cost)}`} />
            <Stat flat label="Blended NPM" value={pct(t.margin)} tone={t.margin < 0.1 ? 'bad' : 'good'} sub={`${m(t.fob - t.cost)} profit`}
              hint="Order profit ÷ order FOB, weighted by each line's value. Cost is the full costing-sheet cost, including direct labor, indirect overhead, shipping and cost of capital." />
            <Stat flat label="Contribution" value={pct(t.contribution)} sub={`${m(t.fob - t.cost + t.indirect)} · ${m(t.indirect)} overhead`}
              hint="Net profit plus the indirect (factory) overhead this order absorbs, ÷ order FOB. Bought-in items carry no man-hours, so for trading work this equals NPM; manufacturing work shows how much it also pays toward fixed overhead." />
            <Stat flat label="Packed CBM" value={t.cbm.toFixed(2)} sub={`≈ ${(t.cbm / 68).toFixed(2)} × 40HC`} />
            <Stat flat label="Over target" value={t.withTarget ? `${t.overTarget} / ${t.withTarget}` : '—'}
              tone={t.overTarget ? 'bad' : t.withTarget ? 'good' : undefined}
              sub={targetDelta == null ? 'no targets set' : `${targetDelta > 0 ? '+' : ''}${m(targetDelta)} order vs targets`}
              onClick={() => setFilter(f => (f === 'over' ? 'all' : 'over'))} active={filter === 'over'} />
            <Stat flat label="Needs a look" value={t.flagged} tone={t.flagged ? 'warn' : undefined} sub="blank or odd-one-out costs"
              onClick={() => setFilter(f => (f === 'flagged' ? 'all' : 'flagged'))} active={filter === 'flagged'} />
          </div>

          <AssumptionsStrip bundle={bundle} apply={apply} />

          {/* Step controls + filters */}
          <div className="-my-1 flex flex-wrap items-center gap-1">
            {quotesMode ? (
              <>
                <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground" onClick={() => setParam('view', null)}><ArrowLeft className="h-4 w-4" /> Back to costing</Button>
                <span className="text-sm text-muted-foreground">COGS · raw piece quotes side by side. Tick the costs to use per SKU; ticked costs add up.</span>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground" onClick={() => setAllOpen(!allOpen)}>
                      {allOpen ? <><ChevronsRightLeft className="h-4 w-4" /> Fold all steps</> : <><ChevronsLeftRight className="h-4 w-4" /> Open all steps</>}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">Folded, each step shows only its subtotal: COGS + labour + shipping = unit cost, then price. Keys 1 to 4 open one step and fold the others, so the sheet stays on the screen; this button lays every step out at once.</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground" onClick={() => setParam('view', 'quotes')}><Scale className="h-4 w-4" /> Vendor quotes</Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">Compare raw piece quotes from each vendor side by side and pick the one that goes into COGS (key Q)</TooltipContent>
                </Tooltip>
                {quotedCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground" disabled={!offQuoted.length} onClick={quotedToTargets}>
                        <Target className="h-4 w-4" /> {offQuoted.length ? `Quoted price → target (${offQuoted.length})` : 'Targets match quoted'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      {offQuoted.length
                        ? `Makes the price on the customer’s latest quote the target for the ${offQuoted.length} SKU${offQuoted.length === 1 ? '' : 's'} shown that have been quoted, so “vs target” shows how today’s price has moved since. Undo with Ctrl+Z.`
                        : 'Every quoted SKU shown already has its quoted price as the target.'}
                    </TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" className={cn('h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground', showSide && 'hidden')} onClick={() => setQuotesOpen(true)}>
                  <FileText className="h-4 w-4" /> Customer quotes{quotedCount > 0 ? ` (${quotedCount} SKU${quotedCount === 1 ? '' : 's'} quoted)` : ''}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">This inquiry’s quotes, without leaving costing: open or edit one, mark it sent, compare with the latest sent</TooltipContent>
            </Tooltip>
            <div className="ml-auto flex items-center gap-2">
              {!sideOpen && !openRow && !quotesMode && (
                <Button size="sm" variant="ghost" className="hidden h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground lg:inline-flex" onClick={() => setSideOpen(true)}><PanelRightOpen className="h-4 w-4" /> Quotes and projection</Button>
              )}
              {sideSqueezed && <span className="hidden text-xs text-muted-foreground lg:inline">Quotes and projection come back when this step folds</span>}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU, name, vendor" className="h-8 w-52 pl-8"
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusRow(); } else if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); } }} />
                {search && <button className="absolute right-2 top-2.5 text-muted-foreground" onClick={() => setSearch('')}><X className="h-4 w-4" /></button>}
              </div>
              <Select value={filter} onValueChange={v => setFilter(v as Filter)}>
                <SelectTrigger className="h-8 w-[120px] border-transparent bg-transparent shadow-none hover:bg-muted"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All SKUs</SelectItem>
                  <SelectItem value="over">Over target</SelectItem>
                  <SelectItem value="flagged">Needs a look</SelectItem>
                  <SelectItem value="notarget">No target</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={v => setSort(v as Sort)}>
                <SelectTrigger className="h-8 w-[170px] border-transparent bg-transparent shadow-none hover:bg-muted"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sheet">Sheet order</SelectItem>
                  <SelectItem value="gap">Furthest over target</SelectItem>
                  <SelectItem value="price">Highest price</SelectItem>
                  <SelectItem value="name">Name A–Z</SelectItem>
                  <SelectItem value="name_desc">Name Z–A</SelectItem>
                  <SelectItem value="sku">SKU code A–Z</SelectItem>
                  <SelectItem value="sku_desc">SKU code Z–A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {quotesMode && (
            <QuotesToolbar bundle={bundle} rows={visibleRows} slots={quoteSlots} targetIds={selectedIds} apply={apply} onImported={() => void load()} />
          )}

          {/* Grid + panel */}
          <div ref={rowRef} className={cn('flex min-h-0 flex-1 gap-3', selectedIds.length > 0 && 'mb-[68px]')}>
            <div className={cn('max-h-full min-h-0 self-start overflow-auto rounded-lg border border-border/70 bg-card shadow-sm', openRow ? 'h-full w-[470px] shrink-0' : 'min-w-0 flex-1')}>
              {visibleRows.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? 'This inquiry has no products yet.' : 'No SKUs match.'}
                </div>
              ) : (
                <WorkspaceTable
                  cols={cols} quotes={quotesMode} open={open} onToggleOpen={toggleOpen} rows={visibleRows} bundle={bundle} apply={apply}
                  selected={selected} onToggle={toggleRow} onToggleAll={toggleAll}
                  nameSort={sort === 'name' ? 'asc' : sort === 'name_desc' ? 'desc' : null}
                  onSortName={() => setSort(s => (s === 'name' ? 'name_desc' : s === 'name_desc' ? 'sheet' : 'name'))}
                  openId={openId} onOpen={id => setParam('sku', id === openId ? null : id)}
                  compact={!!openRow} quoteSlots={quoteSlots} onAddQuoteSlot={() => setExtraSlots(s => s + 1)} scale={fit.scale}
                />
              )}
            </div>
            {showSide && (
              <InquirySide inquiryId={inquiryId} rows={rows} cur={cur} fob={t.fob} margin={t.margin} manHours={t.indirect} data={side.data}
                selectedCount={selectedIds.length} quoting={quote.busy}
                onGenerate={() => void generateQuote(selectedIds.length ? selectedIds : rows.map(r => r.p.id))}
                onRequote={ids => void generateQuote(ids)} onHold={holdQuoted}
                onAllQuotes={() => setQuotesOpen(true)} onEditProjection={() => setProjectionOpen(true)} onCollapse={() => setSideOpen(false)} />
            )}
            {openRow && (
              <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/70 shadow-sm">
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
              <BulkBar ids={selectedIds} rows={rows} bundle={bundle} apply={apply} onClear={() => setSelected(new Set())}
                onQuote={() => void generateQuote(selectedIds)} quoting={quote.busy}
                onDuplicate={() => void duplicate(selectedIds)} duplicating={duplicating} />
            </div>
          )}
        </div>
        {quote.dialog}
        <Sheet open={projectionOpen} onOpenChange={o => { setProjectionOpen(o); if (!o) void side.reload(); }}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
            <SheetHeader className="mb-4">
              <SheetTitle>Projection · {title}</SheetTitle>
              <SheetDescription>When this order lands, how sure it is and how the money moves. FOB and margin follow the costing sheet until the PO.</SheetDescription>
            </SheetHeader>
            {projectionOpen && <InquiryProjectionTab inquiryId={inquiryId} />}
          </SheetContent>
        </Sheet>
        <Sheet open={quotesOpen} onOpenChange={o => { setQuotesOpen(o); if (!o) { void load(); void side.reload(); } }}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl">
            <SheetHeader className="mb-4">
              <SheetTitle>Customer quotes · {title}</SheetTitle>
              <SheetDescription>
                The quotes made for this inquiry. To make a new one, tick SKUs in the costing sheet and press Generate quote. Closing this refreshes the Quoted column.
              </SheetDescription>
            </SheetHeader>
            {quotesOpen && <InquiryQuotesTab inquiryId={inquiryId} refreshKey={0} />}
          </SheetContent>
        </Sheet>
        <CostingIntakeDialog open={intakeOpen} onOpenChange={setIntakeOpen} inquiryId={inquiryId} mode="update" onApplied={() => void load()} />
      </TooltipProvider>
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
  ['Ctrl+Z  ·  Ctrl+Y', 'Undo / redo any saved change, pastes and bulk sets included'],
  ['Shift+arrows  ·  Shift+click', 'Select a block of cells'],
  ['Ctrl+C', 'Copy the cell or block (pastes straight into Excel or Sheets)'],
  ['Ctrl+V', 'Paste a block from Excel or Sheets (fills down and across); one value pasted on a block fills all of it'],
  ['Ctrl+D', 'Fill down from the top of the block (or from the row above)'],
  ['Delete', 'Clear the numbers in a block (overrides ✎ go back to the calculation)'],
  ['Space (on SKU)', 'Select the row (Shift+Space selects a range)'],
  ['Enter (on SKU)', 'Open the product panel; ↑ ↓ then step through SKUs'],
  ['Enter / Space (on a menu)', 'Open the dropdown; typing a letter picks an option'],
  ['/', 'Search'],
  ['g', 'Jump into the grid'],
  ['1 – 4', 'Open COGS, Labour, Shipping or Margin (the others fold); again to fold it'],
  ['q', 'Vendor quotes side by side (again to go back)'],
];

function ShortcutsButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" aria-label="Keyboard shortcuts"><Keyboard className="h-4 w-4" /></Button>
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
