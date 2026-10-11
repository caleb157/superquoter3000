// Building blocks for the Costing Workspace grid and product panel.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { BUCKETS, type WorkspaceRow } from '@/lib/costing-workspace';

// ---------- formatting ----------

export const inr = (n: number | null | undefined, d = 0) =>
  n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const usd = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const pct = (n: number | null | undefined, d = 1) =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(d)}%`;
export const num = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `${+n.toFixed(d)}`;

export function parseNum(raw: string): number | null {
  const cleaned = String(raw).replace(/[₹$,%\s]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---------- keyboard grid navigation ----------
//
// Every cell in a grid carries data-grid / data-row / data-col, so moving around is a DOM
// lookup: ←/→ walk the row in column order, ↑/↓ find the same column one row over (rows
// without that cell are skipped). Inputs have two modes, like a spreadsheet: focusing a
// cell selects it ("nav" mode, arrows move); typing, F2 or a second click starts editing
// (arrows move the caret, Enter/Tab commit and move on, Escape reverts).

export type CellNav = { grid: string; row: number; col: string };
export type NavMove = 'up' | 'down' | 'left' | 'right' | 'next' | 'prev' | 'home' | 'end' | 'top' | 'bottom' | 'pageup' | 'pagedown';

const PAGE = 10;
const sel = (grid: string, row?: number, col?: string) =>
  `[data-grid="${CSS.escape(grid)}"]` + (row != null ? `[data-row="${row}"]` : '') + (col != null ? `[data-col="${CSS.escape(col)}"]` : '');

// Disabled controls can't take focus, so navigation steps over them.
const focusable = (el: HTMLElement | null) => (el && !(el as HTMLButtonElement).disabled ? el : null);
function rowCells(grid: string, row: number) {
  return Array.from(document.querySelectorAll<HTMLElement>(sel(grid, row))).filter(el => focusable(el));
}
function lastRow(grid: string) {
  let max = -1;
  document.querySelectorAll<HTMLElement>(sel(grid)).forEach(el => { max = Math.max(max, Number(el.dataset.row)); });
  return max;
}

export function focusNavEl(el: HTMLElement | null | undefined) {
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (el instanceof HTMLInputElement) el.select();
  return true;
}

/** Focus the cell at (row, col) in the given grid, if any. */
export function focusCell(grid: string, row: number, col: string) {
  return focusNavEl(document.querySelector<HTMLElement>(sel(grid, row, col)));
}

/** The cell a move from `from` lands on, or null at the edge of the grid. */
export function navTarget(from: HTMLElement, move: NavMove): HTMLElement | null {
  const { grid, col } = from.dataset;
  const row = Number(from.dataset.row);
  if (!grid || col == null || !Number.isFinite(row)) return null;
  const cells = rowCells(grid, row);
  const i = cells.indexOf(from);
  if (i < 0) return null;
  const vertical = (start: number, step: number, stopAt: number) => {
    for (let r = start; step > 0 ? r <= stopAt : r >= stopAt; r += step) {
      const el = focusable(document.querySelector<HTMLElement>(sel(grid, r, col)));
      if (el) return el;
    }
    return null;
  };
  const last = () => lastRow(grid);
  switch (move) {
    case 'left': return cells[i - 1] ?? null;
    case 'right': return cells[i + 1] ?? null;
    case 'home': return cells[0] ?? null;
    case 'end': return cells[cells.length - 1] ?? null;
    case 'up': return vertical(row - 1, -1, 0);
    case 'down': return vertical(row + 1, 1, last());
    case 'top': return vertical(0, 1, row - 1);
    case 'bottom': return vertical(last(), -1, row + 1);
    case 'pageup': return vertical(Math.max(0, row - PAGE), 1, row - 1) ?? null;
    case 'pagedown': return vertical(Math.min(last(), row + PAGE), -1, row + 1) ?? null;
    case 'next': return cells[i + 1] ?? rowCells(grid, row + 1)[0] ?? null;
    case 'prev': { if (cells[i - 1]) return cells[i - 1]; const up = rowCells(grid, row - 1); return up[up.length - 1] ?? null; }
  }
}

/** Keys that move between cells when a cell isn't being edited. */
export function moveForKey(e: React.KeyboardEvent): NavMove | null {
  const mod = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case 'ArrowUp': return mod ? 'top' : 'up';
    case 'ArrowDown': return e.altKey ? null : mod ? 'bottom' : 'down';
    case 'ArrowLeft': return mod ? 'home' : 'left';
    case 'ArrowRight': return mod ? 'end' : 'right';
    case 'Home': return mod ? 'top' : 'home';
    case 'End': return mod ? 'bottom' : 'end';
    case 'PageUp': return 'pageup';
    case 'PageDown': return 'pagedown';
    case 'Tab': return e.shiftKey ? 'prev' : 'next';
    default: return null;
  }
}

/** Move focus from the event's cell; returns the cell it landed on. Tab off either end of the grid falls through to the browser. */
export function navigate(e: React.KeyboardEvent<HTMLElement>, move: NavMove): HTMLElement | null {
  const target = navTarget(e.currentTarget, move);
  if (!target && (move === 'next' || move === 'prev')) return null;
  e.preventDefault();
  focusNavEl(target);
  return target;
}

const navAttrs = (nav?: CellNav) =>
  nav ? { 'data-grid': nav.grid, 'data-row': nav.row, 'data-col': nav.col } : {};

/** Keyboard handler for cells that aren't text inputs (read-only text, checkboxes, buttons). */
export function navKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  const move = moveForKey(e);
  if (move) navigate(e, move);
}

/** A read-only grid cell that can still be focused and moved through. */
export function NavCell({ nav, children, className, align = 'right' }: {
  nav: CellNav; children: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center';
}) {
  return (
    <div {...navAttrs(nav)} tabIndex={-1} onKeyDown={navKeyDown}
      className={cn('flex min-h-8 items-center rounded-md px-1.5 outline-none focus:ring-2 focus:ring-primary/30 focus:bg-primary/[0.04]',
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start', className)}>
      {children}
    </div>
  );
}

// ---------- EditCell ----------

/** Split clipboard text into rows × columns (tab-separated, like Excel/Sheets copy). */
function parseClipboard(text: string) {
  return text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
}

/**
 * Text/number input that looks like plain text until focused. Commits on blur, Enter or
 * Tab; Escape reverts. Inside a grid (nav set) it behaves like a spreadsheet cell — see
 * the navigation notes above. Pasting several cells fills down/across via onPasteGrid
 * (or down only via onPasteColumn).
 */
export function EditCell({
  value, display, onCommit, onPasteColumn, onPasteGrid, nav, align = 'right', placeholder, disabled, title, className, kind = 'number',
}: {
  value: string | number | null | undefined;
  display?: string;
  onCommit: (raw: string) => void;
  onPasteColumn?: (lines: string[]) => void;
  onPasteGrid?: (cells: string[][]) => void;
  nav?: CellNav;
  align?: 'left' | 'right';
  placeholder?: string;
  disabled?: string | null;
  title?: string;
  className?: string;
  kind?: 'number' | 'text';
}) {
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const original = value == null ? '' : String(value);
  const ref = useRef<HTMLInputElement>(null);
  // Selection changes are applied right after React renders the new value (a rAF would race fast typing).
  const pendingSelect = useRef<'all' | 'end' | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pendingSelect.current || document.activeElement !== el) return;
    if (pendingSelect.current === 'all') el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    pendingSelect.current = null;
  });

  // Only text the user typed is ever written back — a cell that was merely visited (or
  // refilled by a paste) never commits a stale value.
  const commit = () => {
    if (!editing || draft.trim() === original.trim()) return;
    if (kind === 'number' && draft.trim() !== '' && parseNum(draft) == null) return;
    onCommit(draft);
  };
  /** Commit in place (focus stays), used when there is nowhere to move to. */
  const commitHere = () => { commit(); setEditing(false); pendingSelect.current = 'all'; };
  const startEditing = () => { setDraft(original); setEditing(true); pendingSelect.current = 'end'; };

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div {...navAttrs(nav)} tabIndex={nav ? -1 : undefined} onKeyDown={nav ? navKeyDown : undefined}
            className={cn('h-8 px-2 flex items-center rounded-md text-muted-foreground/60 tabular-nums cursor-not-allowed outline-none focus:ring-2 focus:ring-primary/30',
              align === 'right' ? 'justify-end' : 'justify-start', className)}>
            {display ?? (original || '—')}
          </div>
        </TooltipTrigger>
        <TooltipContent>{disabled}</TooltipContent>
      </Tooltip>
    );
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (e.key === 'Escape') {
      if (!editing) { if (!nav) input.blur(); return; }
      e.preventDefault(); e.stopPropagation();
      setEditing(false); pendingSelect.current = 'all';
      return;
    }
    if (!nav) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!navigate(e, e.shiftKey ? 'up' : 'down')) commitHere();
      return;
    }
    if (e.key === 'F2') { e.preventDefault(); startEditing(); return; }
    const move = moveForKey(e);
    if (!move) return;
    // While editing, ←/→/Home/End move the caret; ↑/↓, Tab and page keys still leave the cell.
    if (editing && ['left', 'right', 'home', 'end'].includes(move) && !(e.ctrlKey || e.metaKey)) return;
    if (!navigate(e, move) && move !== 'next' && move !== 'prev') commitHere();
  };

  return (
    <input
      ref={ref}
      {...navAttrs(nav)}
      title={title}
      className={cn(
        'h-8 w-full rounded-md bg-transparent px-2 tabular-nums outline-none transition-colors',
        'border border-transparent hover:border-border hover:bg-background focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20',
        nav && focused && !editing && 'caret-transparent selection:bg-primary/15',
        align === 'right' ? 'text-right' : 'text-left',
        !focused && !original && 'text-muted-foreground/50',
        className,
      )}
      value={focused ? (editing ? draft : original) : (display ?? original)}
      placeholder={placeholder}
      onFocus={() => { setFocused(true); setEditing(false); pendingSelect.current = 'all'; }}
      onBlur={() => { setFocused(false); setEditing(false); commit(); }}
      onChange={e => { setDraft(e.target.value); setEditing(true); }}
      onMouseDown={() => { if (focused && !editing) { setDraft(original); setEditing(true); } }}
      onDoubleClick={() => { if (!editing) { setDraft(original); setEditing(true); } }}
      onKeyDown={onKeyDown}
      onPaste={e => {
        const text = e.clipboardData.getData('text/plain');
        const cells = parseClipboard(text);
        const multi = cells.length > 1 || cells[0].length > 1;
        if (!multi || (!onPasteGrid && !onPasteColumn) || (!onPasteGrid && cells.length < 2)) return;
        e.preventDefault();
        if (onPasteGrid) onPasteGrid(cells);
        else onPasteColumn!(cells.map(r => r[0]));
        setEditing(false); pendingSelect.current = 'all';
      }}
    />
  );
}

// ---------- SelectCell ----------

export function SelectCell({
  value, options, onChange, nav, className, disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  nav?: CellNav;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      {...navAttrs(nav)}
      disabled={disabled}
      className={cn(
        'h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm outline-none cursor-pointer',
        'hover:border-border hover:bg-background focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={nav ? e => {
        // Arrows move between cells instead of cycling options; Enter, Space, F2 or Alt+↓ open the list.
        // Typing a letter still jumps to the matching option.
        if (e.key === 'Enter' || e.key === 'F2' || e.key === ' ' || (e.key === 'ArrowDown' && e.altKey)) {
          e.preventDefault();
          try { (e.currentTarget as any).showPicker?.(); } catch { /* not supported */ }
          return;
        }
        const move = moveForKey(e);
        if (move) { navigate(e, move); if (!['next', 'prev'].includes(move)) e.preventDefault(); }
      } : undefined}
    >
      {!options.some(o => o.value === value) && <option value={value}>{value || '—'}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ---------- Cost mix bar ----------

/** Horizontal stacked bar of a product's per-unit cost by bucket, with a breakdown tooltip. */
export function CostMixBar({ row, className, showLegend }: { row: WorkspaceRow; className?: string; showLegend?: boolean }) {
  const total = BUCKETS.reduce((a, b) => a + row.buckets[b.key], 0);
  const parts = BUCKETS.filter(b => row.buckets[b.key] > 0.005);
  const bar = (
    <div className={cn('flex h-2.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      {parts.map(b => (
        <div key={b.key} style={{ width: `${(row.buckets[b.key] / (total || 1)) * 100}%`, background: b.color }} />
      ))}
    </div>
  );
  if (showLegend) {
    return (
      <div className="space-y-2">
        {bar}
        <div className="text-[11px] text-muted-foreground">Share of unit cost</div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
          {parts.map(b => (
            <div key={b.key} className="flex items-center gap-1.5 min-w-0">
              <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: b.color }} />
              <span className="text-muted-foreground truncate">{b.label}</span>
              <span className="ml-auto tabular-nums">{Math.round((row.buckets[b.key] / (total || 1)) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild><div className="w-full py-2 cursor-default">{bar}</div></TooltipTrigger>
      <TooltipContent side="bottom" className="p-3">
        <div className="text-xs font-medium mb-1.5">Unit cost {inr(row.costInr)}</div>
        <table className="text-xs tabular-nums">
          <tbody>
            {parts.map(b => (
              <tr key={b.key}>
                <td className="pr-2"><span className="inline-block h-2 w-2 rounded-sm mr-1.5" style={{ background: b.color }} />{b.label}</td>
                <td className="text-right pr-2">{inr(row.buckets[b.key])}</td>
                <td className="text-right text-muted-foreground">{Math.round((row.buckets[b.key] / (total || 1)) * 100)}%</td>
              </tr>
            ))}
            {row.r.capitalPerUnitInr > 0 && (
              <tr><td className="pr-2 pl-3.5">Cost of capital</td><td className="text-right pr-2">{inr(row.r.capitalPerUnitInr)}</td><td /></tr>
            )}
          </tbody>
        </table>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------- Gap chip ----------

export function GapChip({ row, size = 'sm' }: { row: WorkspaceRow; size?: 'sm' | 'lg' }) {
  if (row.gapUsd == null || row.gapPct == null) return <span className="text-muted-foreground/50">—</span>;
  const over = row.gapUsd > 0.005;
  const under = row.gapUsd < -0.005;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full font-medium tabular-nums whitespace-nowrap',
      size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs',
      over ? 'bg-destructive/10 text-destructive' : under ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
    )}>
      {over ? '▲' : under ? '▼' : '='} {usd(Math.abs(row.gapUsd))}
      <span className="opacity-70">{(Math.abs(row.gapPct) * 100).toFixed(1)}%</span>
    </span>
  );
}

// ---------- Thumbnail ----------

export function Thumb({ p, size = 32 }: { p: any; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [p.photo_url]);
  const initials = String(p.name || p.sku || '?').split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
  if (p.photo_url && !broken) {
    return <img src={p.photo_url} alt="" onError={() => setBroken(true)} className="rounded-md object-cover bg-muted shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-md bg-muted text-muted-foreground grid place-items-center shrink-0 font-medium" style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {initials}
    </div>
  );
}

// ---------- Stat ----------

export function Stat({ label, value, sub, tone, onClick, active, hint }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'bad' | 'warn'; onClick?: () => void; active?: boolean; hint?: string;
}) {
  const Comp = onClick ? 'button' : 'div';
  if (hint) {
    return (
      <Tooltip>
        <TooltipTrigger asChild><div className="min-w-0 cursor-help"><Stat {...{ label, value, sub, tone, onClick, active }} /></div></TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'min-w-0 rounded-lg border bg-card px-3.5 py-2 text-left',
        onClick && 'hover:border-primary/50 transition-colors',
        active && 'border-primary ring-2 ring-primary/15',
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums leading-tight',
        tone === 'good' && 'text-primary', tone === 'bad' && 'text-destructive', tone === 'warn' && 'text-amber-600 dark:text-amber-400')}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
    </Comp>
  );
}
