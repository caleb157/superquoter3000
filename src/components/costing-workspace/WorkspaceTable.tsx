// The bulk grid: one row per SKU, columns in costing order (COGS, labour, shipping, margin),
// each step a band that opens to its detail or folds to its subtotal. Sticky header, sticky
// name column and a totals footer; the name cell opens the product panel. Like a
// spreadsheet, Shift+arrows (or Shift+click) select a block of cells to copy, fill down
// (Ctrl+D), clear (Delete) or paste into.
import { useRef } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isPhotoEstimated } from '@/lib/photo-intake';
import { chain, chooseQuote, setQuote, type Apply, type Bundle, type Mutation, type WorkspaceRow } from '@/lib/costing-workspace';
import { EditCell, GapChip, NavCell, SelectCell, Thumb, focusCell, inr, moveForKey, navigate, navKeyDown, parseClipboard, parseNum, money } from './cells';
import { BANDS, writeGrid, type Col, type LaidCol, type OpenState } from './columns';

type Props = {
  /** Visible columns, from layout(). */
  cols: LaidCol[];
  /** Vendor quotes side by side instead of the steps. */
  quotes: boolean;
  open: OpenState;
  /** Open or fold a step or sub-group by id. */
  onToggleOpen: (id: string) => void;
  rows: WorkspaceRow[];
  bundle: Bundle;
  selected: Set<string>;
  onToggle: (idx: number, shift: boolean) => void;
  onToggleAll: () => void;
  openId: string | null;
  onOpen: (id: string) => void;
  /** Header click on SKU cycles name A–Z → Z–A → sheet order. */
  nameSort: 'asc' | 'desc' | null;
  onSortName: () => void;
  apply: Apply;
  /** Panel open: show a narrow list instead of the full view. */
  compact: boolean;
  quoteSlots: number;
  onAddQuoteSlot: () => void;
};

const COMPACT_COLS: Col[] = [
  { id: 'c_price', label: 'Price', width: 76, align: 'right', render: r => <span className="font-semibold">{money(r.price, r.cur)}</span> },
  { id: 'c_gap', label: 'vs target', width: 132, align: 'left', render: r => <GapChip row={r} /> },
];

export function WorkspaceTable(p: Props) {
  const { rows, bundle, selected, openId, compact } = p;
  const cols: LaidCol[] = compact ? COMPACT_COLS : p.cols;
  const isQuotes = p.quotes && !compact;
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.p.id));
  const someSelected = rows.some(r => selected.has(r.p.id));
  const hasFooter = !isQuotes && cols.some(c => c.footer);
  // Runs of adjacent columns sharing a group get one header cell above them.
  const groups = !isQuotes && cols.some(c => c.group)
    ? cols.reduce<{ label?: string; span: number }[]>((acc, c) => {
        const last = acc[acc.length - 1];
        if (last && c.group && last.label === c.group) last.span++;
        else acc.push({ label: c.group, span: 1 });
        return acc;
      }, [])
    : null;
  const grid = isQuotes ? 'quotes' : compact ? 'compact' : 'sheet';
  // One header cell per step over its columns (lead columns get a blank one).
  const bands = !isQuotes && !compact
    ? cols.reduce<{ id?: string; span: number }[]>((acc, c) => {
        const last = acc[acc.length - 1];
        if (last && last.id === c.band) last.span++;
        else acc.push({ id: c.band, span: 1 });
        return acc;
      }, [])
    : null;
  const bandStart = new Set(cols.filter((c, i) => c.band && cols[i - 1]?.band !== c.band).map(c => c.id));
  const headTop = (bands ? 32 : 0) + (groups ? 28 : 0);

  const nameWidth = compact ? 220 : 280;
  const dataWidth = isQuotes ? 72 + p.quoteSlots * QUOTE_W + 44 + 104 + 120 : cols.reduce((a, c) => a + c.width, 0);

  const block = useBlockSelection({ enabled: grid === 'sheet', cols, rows, bundle, apply: p.apply });

  return (
    <table ref={block.ref} {...block.handlers} className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{
      minWidth: nameWidth + dataWidth + 16,
      // Keep keyboard-focused cells clear of the sticky header, footer and name column.
      ['--cw-scroll-top' as any]: `${headTop + 44}px`,
      ['--cw-scroll-bottom' as any]: `${hasFooter ? 44 : 4}px`,
      ['--cw-scroll-left' as any]: `${nameWidth + 4}px`,
    }}>
      <colgroup>
        {/* The name column takes whatever width the data columns leave. */}
        <col />
        {isQuotes ? <QuoteColGroup slots={p.quoteSlots} /> : cols.map(c => <col key={c.id} style={{ width: c.width }} />)}
        <col style={{ width: 16 }} />
      </colgroup>
      <thead>
        {bands && (
          <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:h-8 [&>th]:bg-muted/95 [&>th]:backdrop-blur [&>th]:px-1 [&>th]:pt-1">
            <th className="left-0 z-20" />
            {bands.map((g, i) => {
              const band = BANDS.find(b => b.id === g.id);
              if (!band) return <th key={i} colSpan={g.span} />;
              const isOpen = !!p.open[band.id];
              return (
                <th key={band.id} colSpan={g.span} className="border-l border-border/70 text-left">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={() => p.onToggleOpen(band.id)} aria-expanded={isOpen}
                        className="flex h-6 w-full items-center gap-1.5 rounded-md border-t-[3px] px-1.5 text-xs font-semibold text-foreground hover:bg-background/70"
                        style={{ borderTopColor: band.color }}>
                        <span className="text-muted-foreground tabular-nums">{band.n}</span>
                        <span className="truncate">{band.label}</span>
                        {isOpen ? <ChevronLeft className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs">
                      {band.hint}. {isOpen ? 'Click to fold to the subtotal' : 'Click to open the detail'} (key {band.n}).
                    </TooltipContent>
                  </Tooltip>
                </th>
              );
            })}
            <th />
          </tr>
        )}
        {groups && (
          <tr className={cn('[&>th]:sticky [&>th]:z-10', bands ? '[&>th]:top-8' : '[&>th]:top-0', '[&>th]:bg-muted/95 [&>th]:backdrop-blur [&>th]:h-7 [&>th]:px-2 [&>th]:pt-1.5 [&>th]:text-[11px] [&>th]:font-medium [&>th]:text-muted-foreground')}>
            <th className="left-0 z-20" />
            {groups.map((g, i) => (
              <th key={i} colSpan={g.span} className="text-center">
                {g.label && <div className="mx-1 border-b border-muted-foreground/25 pb-0.5">{g.label}</div>}
              </th>
            ))}
            <th />
          </tr>
        )}
        <tr className={cn('[&>th]:sticky [&>th]:z-10 [&>th]:bg-muted/95 [&>th]:backdrop-blur [&>th]:border-b [&>th]:h-10 [&>th]:px-2 [&>th]:text-xs [&>th]:font-medium [&>th]:text-muted-foreground',
          headTop === 60 ? '[&>th]:top-[60px]' : headTop === 32 ? '[&>th]:top-8' : headTop === 28 ? '[&>th]:top-7' : '[&>th]:top-0')}>
          <th className="left-0 z-20 text-left">
            <div className="flex items-center gap-3 pl-1">
              <Checkbox checked={allSelected ? true : someSelected ? 'indeterminate' : false} onCheckedChange={p.onToggleAll} aria-label="Select all" />
              <button onClick={p.onSortName} title="Sort by name (click again to reverse, third click for sheet order)"
                className={cn('flex items-center gap-1 rounded hover:text-foreground', p.nameSort && 'text-foreground')}>
                SKU
                {p.nameSort === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : p.nameSort === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />}
              </button>
              <span className="ml-auto font-normal tabular-nums">{rows.length}</span>
            </div>
          </th>
          {isQuotes ? (
            <QuoteHeaders slots={p.quoteSlots} onAdd={p.onAddQuoteSlot} />
          ) : cols.map(c => (
            <th key={c.id} className={cn(c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
              bandStart.has(c.id) && 'border-l border-l-border/70', c.sub?.open && 'bg-muted')}>
              <span className="inline-flex max-w-full items-center gap-1">
                {c.sub?.first && <SubToggle sub={c.sub} onToggle={() => p.onToggleOpen(c.sub!.id)} />}
                {c.hint ? (
                  <Tooltip>
                    <TooltipTrigger asChild><span className="cursor-help truncate underline decoration-dotted decoration-muted-foreground/40 underline-offset-4">{c.label}</span></TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs">{c.hint}</TooltipContent>
                  </Tooltip>
                ) : <span className="truncate">{c.label}</span>}
              </span>
            </th>
          ))}
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const isOpen = row.p.id === openId;
          const isSel = selected.has(row.p.id);
          const issues = row.flags.filter(f => f.kind !== 'target');
          return (
            <tr key={row.p.id}
              className={cn('group [&>td]:border-b [&>td]:h-12 [&>td]:px-1.5',
                isOpen ? '[&>td]:bg-primary/[0.07]' : isSel ? '[&>td]:bg-primary/[0.04]' : '[&>td]:bg-card hover:[&>td]:bg-muted/40')}>
              <td className="sticky left-0 z-[5] border-r">
                <div className="flex items-center gap-2.5 pl-1 min-w-0">
                  <Checkbox tabIndex={-1} checked={isSel} onClick={e => { e.preventDefault(); p.onToggle(idx, e.shiftKey); }} aria-label={`Select ${row.p.name}`} />
                  <button
                    data-grid={grid} data-row={idx} data-col="name" data-pid={row.p.id}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    onClick={() => p.onOpen(row.p.id)}
                    onKeyDown={e => {
                      // Space selects (Shift+Space extends), Enter opens the panel; with the panel open,
                      // moving up/down the list follows along.
                      if (e.key === ' ') { e.preventDefault(); p.onToggle(idx, e.shiftKey); return; }
                      const move = moveForKey(e);
                      if (!move) return;
                      const to = navigate(e, move);
                      const pid = to?.dataset.col === 'name' ? to.dataset.pid : undefined;
                      if (openId && pid && pid !== openId) p.onOpen(pid);
                    }}>
                    <Thumb p={row.p} />
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate font-medium leading-tight', isOpen && 'text-primary')}>{row.p.name || 'Untitled'}</div>
                      <div className="truncate text-xs text-muted-foreground leading-tight mt-0.5">
                        {row.p.sku || 'No SKU'}{row.qty ? ` · ${row.qty.toLocaleString()} pcs` : ''}
                      </div>
                    </div>
                  </button>
                  {isPhotoEstimated(row.p) && (
                    <Tooltip>
                      <TooltipTrigger asChild><Sparkles className="h-4 w-4 shrink-0 text-highlight" aria-label="Estimated from a photo" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">Estimated from a photo. Open it to check the numbers and mark it checked.</TooltipContent>
                    </Tooltip>
                  )}
                  {issues.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild><AlertTriangle className="h-4 w-4 shrink-0 text-warning" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs space-y-0.5">{issues.map((f, i) => <div key={i}>• {f.msg}</div>)}</TooltipContent>
                    </Tooltip>
                  )}
                  <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground/40 transition-opacity', isOpen ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100')} />
                </div>
              </td>
              {isQuotes ? (
                <QuoteCells row={row} idx={idx} rows={rows} bundle={bundle} slots={p.quoteSlots} apply={p.apply} />
              ) : cols.map((c, ci) => (
                <td key={c.id} className={cn(c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', 'tabular-nums',
                  bandStart.has(c.id) && 'border-l border-l-border/70')}>
                  <Cell col={c} ci={ci} cols={cols} row={row} idx={idx} rows={rows} bundle={bundle} grid={grid} apply={p.apply} />
                </td>
              ))}
              <td />
            </tr>
          );
        })}
      </tbody>
      {hasFooter && (
        <tfoot>
          <tr className="[&>td]:sticky [&>td]:bottom-0 [&>td]:z-10 [&>td]:bg-muted/95 [&>td]:backdrop-blur [&>td]:border-t [&>td]:h-10 [&>td]:px-3 [&>td]:text-sm [&>td]:font-semibold [&>td]:tabular-nums">
            <td className="left-0 z-20 text-muted-foreground font-medium">Totals</td>
            {cols.map(c => <td key={c.id} className={cn(c.align === 'right' ? 'text-right' : 'text-left', bandStart.has(c.id) && 'border-l border-l-border/70')}>{c.footer?.(rows) ?? ''}</td>)}
            <td />
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Opens or folds a sub-group (hardware by type, cartons) from its first column's header. */
function SubToggle({ sub, onToggle }: { sub: NonNullable<LaidCol['sub']>; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onToggle} aria-expanded={sub.open} aria-label={`${sub.open ? 'Fold' : 'Open'} ${sub.label}`}
          className="grid h-5 w-5 shrink-0 place-items-center rounded border bg-background text-muted-foreground hover:text-foreground">
          {sub.open ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">{sub.open ? `Fold ${sub.label.toLowerCase()} back to its total` : `Open ${sub.label.toLowerCase()}: ${sub.hint ?? ''}`}</TooltipContent>
    </Tooltip>
  );
}

function Cell({ col, ci, cols, row, idx, rows, bundle, grid, apply }: {
  col: Col; ci: number; cols: Col[]; row: WorkspaceRow; idx: number; rows: WorkspaceRow[]; bundle: Bundle; grid: string; apply: Apply;
}) {
  const e = col.edit;
  const nav = { grid, row: idx, col: col.id };
  if (!e) return <NavCell nav={nav} align={col.align}>{col.render?.(row, bundle)}</NavCell>;
  const disabled = e.disabled?.(row, bundle) ?? null;
  const v = e.get(row);
  if (e.kind === 'bool') {
    return (
      <div className="flex justify-center">
        <Checkbox data-grid={grid} data-row={idx} data-col={col.id} onKeyDown={navKeyDown}
          checked={!!v} disabled={!!disabled} onCheckedChange={c => apply(b => e.write(b, [row.p.id], String(!!c)))} />
      </div>
    );
  }
  if (e.kind === 'select') {
    return <SelectCell nav={nav} value={String(v ?? '')} options={e.options?.(bundle) ?? []} disabled={!!disabled} onChange={val => apply(b => e.write(b, [row.p.id], val))} />;
  }
  const cell = (
    <EditCell
      nav={nav}
      kind={e.kind === 'number' ? 'number' : 'text'}
      align={col.align === 'right' ? 'right' : 'left'}
      value={v as any}
      display={e.display?.(row)}
      placeholder="—"
      disabled={disabled}
      onCommit={raw => apply(b => e.write(b, [row.p.id], raw))}
      onPasteGrid={cells => apply(b => writeGrid(b, cols, ci, rows, idx, cells))}
    />
  );
  const detail = col.detail?.(row, bundle);
  return detail ? <div>{cell}{detail}</div> : cell;
}

// ---------- vendor quotes ----------

const QUOTE_W = 248;

function QuoteColGroup({ slots }: { slots: number }) {
  return (
    <>
      <col style={{ width: 72 }} />
      {Array.from({ length: slots }, (_, i) => <col key={i} style={{ width: QUOTE_W }} />)}
      <col style={{ width: 44 }} />
      <col style={{ width: 104 }} />
      <col style={{ width: 120 }} />
    </>
  );
}

function QuoteHeaders({ slots, onAdd }: { slots: number; onAdd: () => void }) {
  return (
    <>
      <th className="text-right">Qty</th>
      {Array.from({ length: slots }, (_, i) => (
        <th key={i} className="text-left">
          <div className="flex items-center gap-2 pl-7"><span>Quote {i + 1}</span><span className="ml-auto pr-2 font-normal opacity-70">vendor · ₹/pc</span></div>
        </th>
      ))}
      <th className="text-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={onAdd} className="h-6 w-6 grid place-items-center rounded-md hover:bg-background border border-transparent hover:border-border"><Plus className="h-3.5 w-3.5" /></button>
          </TooltipTrigger>
          <TooltipContent>Add a quote column</TooltipContent>
        </Tooltip>
      </th>
      <th className="text-right">Chosen ₹</th>
      <th className="text-left">vs cheapest</th>
    </>
  );
}

function QuoteCells({ row, idx, rows, bundle, slots, apply }: {
  row: WorkspaceRow; idx: number; rows: WorkspaceRow[]; bundle: Bundle; slots: number; apply: Apply;
}) {
  const priced = row.quotes.filter(q => q.price > 0);
  const cheapest = priced.length ? Math.min(...priced.map(q => q.price)) : null;
  const winner = row.quotes.find(q => q.winner);
  const pasteDown = (slot: number, field: 'vendor_name' | 'unit_cost_inr') => (lines: string[]) => apply(b => {
    let cur = b; const commits: (() => Promise<void>)[] = []; const touched: string[] = [];
    lines.forEach((raw, i) => {
      const r = rows[idx + i]; if (!r || !raw.trim()) return;
      const val = field === 'unit_cost_inr' ? parseNum(raw) : raw.trim();
      if (val == null) return;
      const m = setQuote(cur, r.p.id, slot, { [field]: val } as any);
      cur = m.next; commits.push(m.commit); touched.push(...m.touched);
    });
    return commits.length ? { next: cur, touched, commit: async () => { for (const c of commits) await c(); } } : null;
  });
  return (
    <>
      <td className="text-right tabular-nums px-1.5"><NavCell nav={{ grid: 'quotes', row: idx, col: 'qty' }}>{row.qty || '—'}</NavCell></td>
      {Array.from({ length: slots }, (_, slot) => {
        const q = row.quotes[slot];
        const isWin = !!q?.winner;
        const isCheapest = q && cheapest != null && q.price === cheapest && priced.length > 1;
        return (
          <td key={slot}>
            <div className={cn('flex items-center gap-1 rounded-lg border px-1 py-0.5 mx-0.5', isWin ? 'border-primary/60 bg-primary/[0.06]' : 'border-transparent')}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    data-grid="quotes" data-row={idx} data-col={`w${slot}`}
                    disabled={!q?.line}
                    onKeyDown={navKeyDown}
                    onClick={() => apply(b => chooseQuote(b, row.p.id, slot))}
                    className={cn('h-5 w-5 shrink-0 rounded-full border-2 grid place-items-center disabled:opacity-25',
                      isWin ? 'border-primary' : 'border-muted-foreground/40 hover:border-primary')}
                    aria-label={`Use quote ${slot + 1}`}
                  >
                    {isWin && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{isWin ? 'This quote is in the costing' : 'Use this quote in the costing'}</TooltipContent>
              </Tooltip>
              <EditCell kind="text" align="left" placeholder="Vendor" value={q?.vendor ?? ''} className="flex-1 min-w-0"
                nav={{ grid: 'quotes', row: idx, col: `v${slot}` }}
                onCommit={raw => apply(b => setQuote(b, row.p.id, slot, { vendor_name: raw.trim() || null }))}
                onPasteColumn={pasteDown(slot, 'vendor_name')} />
              <EditCell placeholder="₹" value={q?.line ? q.price : ''} display={q?.line && q.price ? inr(q.price) : ''} className={cn('w-[84px] shrink-0', isCheapest && 'text-primary font-medium')}
                nav={{ grid: 'quotes', row: idx, col: `p${slot}` }}
                onCommit={raw => { const n = parseNum(raw); if (n != null && n >= 0) apply(b => setQuote(b, row.p.id, slot, { unit_cost_inr: n })); }}
                onPasteColumn={pasteDown(slot, 'unit_cost_inr')} />
            </div>
          </td>
        );
      })}
      <td />
      <td className="text-right tabular-nums px-1.5 font-medium">
        <NavCell nav={{ grid: 'quotes', row: idx, col: 'chosen' }}>{winner?.price ? inr(winner.price) : <span className="text-muted-foreground/50">—</span>}</NavCell>
      </td>
      <td className="px-1.5 text-xs">
        <NavCell nav={{ grid: 'quotes', row: idx, col: 'vs' }} align="left">
        {winner && cheapest != null && winner.price > cheapest
          ? <span className="text-warning">+{inr(winner.price - cheapest)} over cheapest</span>
          : winner && priced.length > 1 ? <span className="text-primary">Cheapest</span> : <span className="text-muted-foreground/50">—</span>}
        </NavCell>
      </td>
    </>
  );
}

// ---------- block selection ----------

type Pos = { r: number; c: number };
type Block = { r0: number; r1: number; c0: number; c1: number };

const toBlock = (a: Pos, b: Pos): Block => ({ r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) });
const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** The text a cell copies as: the raw number for an editable cell, a select's label, what's shown otherwise. */
function cellText(col: Col, row: WorkspaceRow, b: Bundle, td: HTMLElement | undefined): string {
  const e = col.edit;
  if (!e) return (td?.innerText ?? '').replace(/\s+/g, ' ').trim().replace(/^—$/, '');
  const v = e.get(row);
  if (e.kind === 'bool') return v ? 'Yes' : '';
  if (e.kind === 'select') return e.options?.(b).find(o => o.value === String(v ?? ''))?.label ?? '';
  return v == null ? '' : String(v);
}

/** A pasted value as the column takes it (a select matches value or label); null skips the cell. Tick boxes are never pasted. */
function coerce(col: Col, raw: string, b: Bundle): string | null {
  const e = col.edit;
  const v = raw.trim();
  if (!e || e.kind === 'bool' || v === '') return null;
  if (e.kind !== 'select') return raw;
  return e.options?.(b).find(o => o.value === v || o.label.toLowerCase() === v.toLowerCase())?.value ?? null;
}

/**
 * Spreadsheet-style block selection over the sheet grid. Focus sets the anchor; Shift+arrow or
 * Shift+click stretches the block. The block is painted straight onto the cells (no re-render),
 * the same DOM-lookup approach as keyboard navigation.
 */
function useBlockSelection({ enabled, cols, rows, bundle, apply }: {
  enabled: boolean; cols: Col[]; rows: WorkspaceRow[]; bundle: Bundle; apply: Apply;
}) {
  const ref = useRef<HTMLTableElement>(null);
  const anchor = useRef<Pos | null>(null);
  const head = useRef<Pos | null>(null);
  const stretching = useRef(false);

  const td = (r: number, c: number) => ref.current?.tBodies[0]?.rows[r]?.cells[c + 1] as HTMLElement | undefined;
  const current = (): Block | null => (anchor.current && head.current ? toBlock(anchor.current, head.current) : null);
  const isMulti = (bl: Block | null) => !!bl && (bl.r0 !== bl.r1 || bl.c0 !== bl.c1);

  const paint = () => {
    ref.current?.querySelectorAll('td.cw-in-range').forEach(el => el.classList.remove('cw-in-range'));
    const bl = current();
    if (!isMulti(bl)) return;
    for (let r = bl!.r0; r <= bl!.r1; r++) for (let c = bl!.c0; c <= bl!.c1; c++) td(r, c)?.classList.add('cw-in-range');
  };

  const posOf = (el: EventTarget | null): Pos | null => {
    const cell = (el as HTMLElement | null)?.closest?.<HTMLElement>('[data-grid="sheet"]');
    if (!cell || cell.dataset.col === 'name') return null;
    const c = cols.findIndex(x => x.id === cell.dataset.col);
    const r = Number(cell.dataset.row);
    return c < 0 || !Number.isFinite(r) ? null : { r, c };
  };
  const editing = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.('[data-editing]');

  /** One mutation writing `raw(row, col)` to every editable, enabled cell of the block. */
  const writeBlock = (bl: Block, raw: (r: number, c: number) => string | null) => (b: Bundle): Mutation | null => {
    const steps: ((cur: Bundle) => Mutation | null)[] = [];
    for (let c = bl.c0; c <= bl.c1; c++) {
      const e = cols[c]?.edit;
      if (!e) continue;
      for (let r = bl.r0; r <= bl.r1; r++) {
        const row = rows[r];
        const v = row ? raw(r, c) : null;
        if (v == null) continue;
        steps.push(cur => (e.disabled?.(row, cur) ? null : e.write(cur, [row.p.id], v)));
      }
    }
    const m = chain(b, steps);
    return m.touched.length ? m : null;
  };

  const fillDown = (bl: Block) => {
    // One row selected: copy from the row above, like Excel.
    const src = bl.r0 === bl.r1 ? bl.r0 - 1 : bl.r0;
    const from = rows[src];
    if (!from) return;
    const targets = { ...bl, r0: bl.r0 === bl.r1 ? bl.r0 : bl.r0 + 1 };
    apply(writeBlock(targets, (_r, c) => {
      const e = cols[c].edit!;
      if (e.auto?.(from)) return '';
      const v = e.get(from);
      return v == null ? '' : String(v);
    }));
  };

  const handlers = !enabled ? {} : {
    onMouseDownCapture: (e: React.MouseEvent) => { stretching.current = e.shiftKey && !!anchor.current; },
    onFocusCapture: (e: React.FocusEvent) => {
      const pos = posOf(e.target);
      if (!pos) { anchor.current = head.current = null; paint(); return; }
      if (stretching.current && anchor.current) head.current = pos;
      else { anchor.current = pos; head.current = pos; }
      stretching.current = false;
      paint();
    },
    onKeyDownCapture: (e: React.KeyboardEvent) => {
      if (editing(e.target) || !posOf(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const arrow = ARROWS[e.key];
      if (arrow && e.shiftKey && !mod && !e.altKey && head.current) {
        e.preventDefault(); e.stopPropagation();
        const r = Math.max(0, Math.min(rows.length - 1, head.current.r + arrow[0]));
        const c = Math.max(0, Math.min(cols.length - 1, head.current.c + arrow[1]));
        stretching.current = true;
        if (!focusCell('sheet', r, cols[c].id)) { head.current = { r, c }; stretching.current = false; paint(); }
        return;
      }
      const bl = current();
      if (!bl) return;
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); fillDown(bl); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && isMulti(bl)) {
        e.preventDefault(); e.stopPropagation();
        // Numbers only: clearing a menu or tick box by accident is easy to miss.
        const clear = writeBlock(bl, (_r, c) => (cols[c].edit!.kind === 'number' || cols[c].edit!.kind === 'text' ? '' : null));
        if (clear(bundle)) apply(clear);
        else toast.info('Those cells can’t be blank. Overrides (✎) go back to the calculation when cleared.');
      }
    },
    onCopyCapture: (e: React.ClipboardEvent) => {
      if (editing(e.target)) return;
      const bl = current();
      if (!bl || !posOf(e.target)) return;
      const lines: string[] = [];
      for (let r = bl.r0; r <= bl.r1; r++) {
        const row = rows[r];
        if (!row) continue;
        const cells: string[] = [];
        for (let c = bl.c0; c <= bl.c1; c++) cells.push(cellText(cols[c], row, bundle, td(r, c)));
        lines.push(cells.join('\t'));
      }
      e.preventDefault();
      e.clipboardData.setData('text/plain', lines.join('\n'));
      if (isMulti(bl)) toast.success(`Copied ${bl.r1 - bl.r0 + 1} × ${bl.c1 - bl.c0 + 1} cells`);
    },
    onPasteCapture: (e: React.ClipboardEvent) => {
      const bl = current();
      if (editing(e.target) || !isMulti(bl) || !posOf(e.target)) return;
      // A block is selected: one copied value fills all of it; a copied block lands at its top-left.
      e.preventDefault(); e.stopPropagation();
      const clip = parseClipboard(e.clipboardData.getData('text/plain'));
      const single = clip.length === 1 && clip[0].length === 1;
      if (single) { apply(writeBlock(bl!, (_r, c) => coerce(cols[c], clip[0][0], bundle))); return; }
      const editable = cols.map((c, i) => (c.edit && c.edit.kind !== 'bool' ? i : -1)).filter(i => i >= bl!.c0);
      apply(writeBlock({ r0: bl!.r0, r1: bl!.r0 + clip.length - 1, c0: bl!.c0, c1: cols.length - 1 }, (r, c) => {
        const j = editable.indexOf(c);
        const v = j < 0 ? undefined : clip[r - bl!.r0]?.[j];
        return v == null ? null : coerce(cols[c], v, bundle);
      }));
    },
  };
  return { ref, handlers };
}
