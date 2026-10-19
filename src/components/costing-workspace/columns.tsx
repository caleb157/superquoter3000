// Column definitions for the Costing Workspace grid. Every editable column carries its
// own write() so cell edits, Excel-style paste-down and the bulk bar share one code path.
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { npmToMarkup } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import {
  EDITABLE_BUCKETS, bucketLines, patchCbm, patchProducts, patchProductsSame, setBucketTotal, setDifficulty, setLaborHours, setOutsourced,
  setPackagingType, setProductType, setShippingType, setSourceLocation, stepTotals,
  type Bundle, type Mutation, type WorkspaceRow,
} from '@/lib/costing-workspace';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';
import { fxOrFallback } from '@/lib/live-rates';
import { quoteCurrencyOf, readTarget, targetPatch, type QuoteCur } from '@/lib/quote-currency';
import { GapChip, inr, money, num, parseNum, pct } from './cells';
import { McPlanBreakdown, mcPlanShort } from './McPlan';

export type EditSpec = {
  kind: 'number' | 'text' | 'select' | 'bool';
  /** Raw value shown while editing. */
  get: (row: WorkspaceRow) => string | number | boolean | null;
  /** Formatted value when not focused. */
  display?: (row: WorkspaceRow) => string;
  options?: (b: Bundle) => { value: string; label: string }[];
  disabled?: (row: WorkspaceRow, b: Bundle) => string | null;
  /** Build the mutation that writes `raw` to every product in `ids`; null = invalid input. */
  write: (b: Bundle, ids: string[], raw: string) => Mutation | null;
};

export type Col = {
  id: string;
  label: string;
  /** Header shown above a run of adjacent columns sharing it (e.g. Piece → W D H). */
  group?: string;
  /** Header tooltip. */
  hint?: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  edit?: EditSpec;
  /** Shown under an editable cell (e.g. the parts behind a bucket total). */
  detail?: (row: WorkspaceRow, b: Bundle) => React.ReactNode;
  /** Read-only cell renderer. */
  render?: (row: WorkspaceRow, b: Bundle) => React.ReactNode;
  footer?: (rows: WorkspaceRow[]) => React.ReactNode;
  /** Shown in the bulk bar "Set" menu even though it isn't a column of the current view. */
  bulkOnly?: boolean;
  /** Name in the bulk bar "Set" menu when the header alone is ambiguous there. */
  bulkLabel?: string;
};

// ---------- helpers ----------

/** INR per USD exactly as the engine uses it (live rate, inquiry override first). */
const fxOf = (b: Bundle) => fxOrFallback(mergeSettingsWithInquiry(b.gs, b.inq)?.exchange_rate);

const numberWrite = (patchFor: (n: number) => Record<string, any>, opts: { min?: number; int?: boolean } = {}) =>
  (b: Bundle, ids: string[], raw: string): Mutation | null => {
    const n = parseNum(raw);
    if (n == null || n < (opts.min ?? 0)) return null;
    return patchProductsSame(b, ids, patchFor(opts.int ? Math.round(n) : n));
  };

const productField = (field: string, opts: { min?: number; int?: boolean; scale?: number } = {}): EditSpec['write'] =>
  numberWrite(n => ({ [field]: n / (opts.scale ?? 1) }), opts);

const cbmField = (field: string, int = false): EditSpec['write'] => (b, ids, raw) => {
  const n = parseNum(raw);
  if (n == null || n < 0) return null;
  return patchCbm(b, ids, { [field]: int ? Math.round(n) : n });
};

/** Width/depth/height as three separate number columns under one group header. */
const AXES = [['width', 'W'], ['depth', 'D'], ['height', 'H']] as const;
type Axis = typeof AXES[number][0];
function dimCols(idPrefix: string, group: string, opts: {
  get: (r: WorkspaceRow, axis: Axis) => number | null | undefined;
  write: (b: Bundle, ids: string[], axis: Axis, n: number) => Mutation | null;
  hint?: string;
}): Col[] {
  return AXES.map(([axis, short]) => ({
    id: `${idPrefix}_${short.toLowerCase()}`, group, label: `${short}"`, width: 66, align: 'right' as const, hint: opts.hint,
    edit: {
      kind: 'number' as const,
      get: r => { const v = Number(opts.get(r, axis)); return Number.isFinite(v) && v ? +v.toFixed(2) : ''; },
      write: (b, ids, raw) => { const n = parseNum(raw); return n == null || n < 0 ? null : opts.write(b, ids, axis, n); },
    },
  }));
}

/** "Piece W" for menus, where the group header isn't visible. */
export const fullLabel = (c: Col) => (c.group ? `${c.group} ${c.label}` : c.label);

/** The parts behind a bucket total, one per line: "2 × Brass knob". */
function BucketParts({ row, b, bucketKey }: { row: WorkspaceRow; b: Bundle; bucketKey: string }) {
  const lines = bucketLines(b, row.p.id, bucketKey);
  if (!lines.length) return null;
  return (
    <div className="space-y-px pb-1 pl-2 pr-2 text-left text-[11px] leading-tight text-muted-foreground">
      {lines.map(l => {
        const qty = +(Number(l.components_per_product) || 0).toFixed(3);
        const unnamed = !l.component_name || l.component_name === l.cogs_type;
        return (
          <div key={l.id} className="flex gap-1" title={`${l.component_name || l.cogs_type}: ${qty} × ${inr(Number(l.unit_cost_inr) || 0, 2)}`}>
            <span className="shrink-0 tabular-nums">{qty} ×</span>
            <span className={cn('truncate', unnamed && 'italic opacity-70')}>{unnamed ? 'no name' : l.component_name}</span>
          </div>
        );
      })}
    </div>
  );
}

const bucketCol = (key: string, label: string, width = 96, parts = false): Col => ({
  id: `bucket:${key}`, label: `${label} ₹`, width, align: 'right',
  hint: `Per-unit ${label.toLowerCase()} price as quoted, before waste (costing adds waste on top). Typing a total adjusts the main line so the bucket adds up to it.`,
  edit: {
    kind: 'number',
    get: r => Math.round(r.editBuckets[key] * 100) / 100,
    display: r => (r.editBuckets[key] ? inr(r.editBuckets[key]) : ''),
    write: (b, ids, raw) => { const n = parseNum(raw); return n == null || n < 0 ? null : setBucketTotal(b, ids, key, n); },
  },
  ...(parts ? { detail: (r: WorkspaceRow, b: Bundle) => <BucketParts row={r} b={b} bucketKey={key} /> } : {}),
});

const ro = (id: string, label: string, render: Col['render'], width = 96, extra: Partial<Col> = {}): Col =>
  ({ id, label, width, align: 'right', render, ...extra });

const sumBy = (rows: WorkspaceRow[], f: (r: WorkspaceRow) => number) => rows.reduce((a, r) => a + f(r), 0);

export const PACKAGING_OPTS = [
  { value: 'ic_mc', label: 'IC + MC' },
  { value: 'ic_only', label: 'IC only' },
  { value: 'bulk_pack', label: 'Bulk pack' },
  { value: 'no_packaging', label: 'No packaging' },
];
const boxOpts = (b: Bundle) => Array.from(new Set(b.boxData.map((x: any) => x.box_type).filter(Boolean))).map(v => ({ value: v as string, label: v as string }));

// ---------- shared columns ----------

const qtyCol: Col = {
  id: 'qty', label: 'Qty', width: 72, align: 'right',
  edit: { kind: 'number', get: r => r.p.quantity ?? 0, write: productField('quantity', { int: true }) },
  footer: rows => sumBy(rows, r => r.qty).toLocaleString(),
};

const npmCol: Col = {
  id: 'npm', label: 'NPM %', width: 80, align: 'right',
  hint: 'Net profit margin on price. Stored as markup (25% markup = 20% NPM), exactly like the costing sheet.',
  edit: {
    kind: 'number',
    get: r => Math.round(r.margin * 1000) / 10,
    display: r => pct(r.margin),
    disabled: (_r, b) => (b.inq?.markup_percent_override != null ? 'This inquiry has a markup override in its Settings tab' : null),
    write: (b, ids, raw) => {
      const n = parseNum(raw);
      if (n == null || n < 0 || n >= 100) return null;
      return patchProductsSame(b, ids, { markup_percent: Math.round(npmToMarkup(n / 100) * 10000) / 10000 });
    },
  },
  footer: rows => {
    const fob = sumBy(rows, r => r.price * r.qty);
    const cost = sumBy(rows, r => r.cost * r.qty);
    return fob > 0 ? pct((fob - cost) / fob) : '—';
  },
};

const contribCol: Col = {
  id: 'contrib', label: 'Contrib %', width: 84, align: 'right',
  hint: 'Contribution rate: net margin plus the indirect (factory) overhead this SKU absorbs. Equals NPM for bought-in items with no man-hours, so trading and manufacturing work compare fairly.',
  render: r => <span className="tabular-nums text-muted-foreground">{pct(r.contribution)}</span>,
  footer: rows => {
    const fob = sumBy(rows, r => r.price * r.qty);
    return fob > 0 ? pct(sumBy(rows, r => (r.price - r.cost + r.indirect) * r.qty) / fob) : '—';
  },
};

const targetCol: Col = {
  id: 'target', label: 'Target $', width: 88, align: 'right',
  hint: "Customer's target price per unit (USD). Leave blank for none.",
  edit: {
    kind: 'number',
    get: r => (r.target == null ? '' : Math.round(r.target * 100) / 100),
    display: r => (r.target == null ? '' : money(r.target, r.cur)),
    write: (b, ids, raw) => {
      const n = raw.trim() === '' ? null : parseNum(raw);
      if (raw.trim() !== '' && (n == null || n < 0)) return null;
      const cur = quoteCurrencyOf(b.inq);
      const fx = fxOf(b);
      // Per product, so a rupee target is never rewritten through a USD round trip.
      const patches: Record<string, Record<string, any>> = {};
      for (const id of ids) {
        const p = b.products.find(x => x.id === id);
        if (!p) continue;
        if (n != null && readTarget(p, cur, fx) === n) continue;
        patches[id] = targetPatch(p, cur, n, fx);
      }
      return patchProducts(b, patches);
    },
  },
};

const priceCol = ro('price', 'Price $', r => <span className="font-semibold">{money(r.price, r.cur)}</span>, 88);
const gapCol: Col = { id: 'gap', label: 'vs target', width: 128, align: 'left', render: r => <GapChip row={r} /> };

// ---------- labor ----------

const laborHoursCol = (type: 'Finishing' | 'Packaging', id: string, label: string, hint: string): Col => ({
  id, label, width: 96, align: 'right', hint,
  edit: {
    kind: 'number',
    get: r => { const h = r.labor[type]; return h ? Math.round(h.hours * 1000) / 1000 : ''; },
    display: r => { const h = r.labor[type]; return h ? `${num(h.hours, 2)}${h.auto ? '' : ' ✎'}` : ''; },
    disabled: r => (r.labor[type] ? null : `No ${type} labor row on this product`),
    write: (b, ids, raw) => {
      const t = raw.trim().toLowerCase();
      if (t === '' || t === 'auto') return setLaborHours(b, ids, type, 'auto');
      const n = parseNum(raw);
      return n == null || n < 0 ? null : setLaborHours(b, ids, type, n);
    },
  },
  footer: rows => num(sumBy(rows, r => (r.labor[type]?.hours ?? 0) * r.qty), 1) + ' h',
});

const difficultyCol: Col = {
  id: 'difficulty', label: 'Finish', width: 112, align: 'left',
  edit: { kind: 'select', get: r => r.p.finishing_difficulty || 'Medium', options: b => b.difficulties.map((d: any) => ({ value: d.name, label: d.name })),
    write: (b, ids, v) => setDifficulty(b, ids, v) },
};
const woodCol: Col = {
  id: 'wood', label: 'Wood %', width: 76, align: 'right',
  edit: { kind: 'number', get: r => Math.round((r.p.percent_wood ?? 1) * 100), display: r => `${Math.round((r.p.percent_wood ?? 1) * 100)}%`,
    write: (b, ids, raw) => { const n = parseNum(raw); return n == null || n < 0 || n > 100 ? null : patchProductsSame(b, ids, { percent_wood: n / 100 }); } },
};

// ---------- the four costing steps ----------
//
// The grid follows the costing sheet left to right: COGS, then labour, then shipping, then
// margin. Each step is a band of columns that collapses to its subtotal. Every editable field
// has exactly one home, so there is never a question of which tab to change it in.

const HW_KEYS = EDITABLE_BUCKETS.filter(x => x.key.startsWith('hw_') || x.key === 'accessories');
const hwTotal = (r: WorkspaceRow) => HW_KEYS.reduce((a, x) => a + r.editBuckets[x.key], 0);
const dash = <span className="text-muted-foreground/50">—</span>;

// COGS

const sourceCol: Col = {
  id: 'source', label: 'Source', width: 168, align: 'left',
  hint: 'Where the piece is made or bought. Outside Jodhpur adds domestic freight under Shipping.',
  edit: { kind: 'select', get: r => r.p.source_location_id || '', options: b => [{ value: '', label: 'In-house (Jodhpur)' }, ...b.locations.map((l: any) => ({ value: l.id, label: l.name }))],
    write: (b, ids, v) => setSourceLocation(b, ids, v || null) },
};
const outsourcedCol: Col = {
  id: 'outsourced', label: 'Outsourced', width: 92, align: 'center',
  hint: 'Bought finished from a supplier: its purchase cost replaces the build-up and it carries no man-hours.',
  edit: { kind: 'bool', get: r => !!r.p.is_outsourced, write: (b, ids, v) => setOutsourced(b, ids, v === 'true') },
};
const hwTotalCol = ro('hw', 'Hardware ₹', r => {
  const parts = HW_KEYS.filter(x => r.editBuckets[x.key] > 0);
  const total = hwTotal(r);
  if (!total) return dash;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="underline decoration-dotted underline-offset-4 cursor-default">{inr(total)}</span></TooltipTrigger>
      <TooltipContent className="text-xs">{parts.map(x => <div key={x.key}>{x.label}: {inr(r.editBuckets[x.key])}</div>)}<div className="mt-1 text-muted-foreground">Open Hardware (▸ in the header) to edit by type</div></TooltipContent>
    </Tooltip>
  );
}, 124, { hint: 'Hardware and accessories per unit. Open it to edit each type and see the parts.', footer: rows => inr(sumBy(rows, r => hwTotal(r) * r.qty)) });
const cogsTotalCol = ro('cogs_total', 'COGS ₹', r => <span className="font-semibold">{inr(stepTotals(r).cogs)}</span>, 100,
  { hint: 'Materials and components per unit, with waste: raw piece, subcontract, hardware, finishing and packaging materials, other.', footer: rows => inr(sumBy(rows, r => stepTotals(r).cogs * r.qty)) });

// Labour

const productTypeCol: Col = {
  id: 'ptype', label: 'Product type', width: 170, align: 'left',
  hint: 'Sets how running inches and finishing hours are worked out (e.g. Wood Table uses the long side).',
  edit: { kind: 'select', get: r => r.p.product_type_id || '', options: b => [{ value: '', label: '—' }, ...b.productTypes.map((t: any) => ({ value: t.id, label: t.name }))],
    write: (b, ids, v) => setProductType(b, ids, v || null) },
};
const riCol: Col = {
  id: 'ri', label: 'Run. in.', width: 84, align: 'right',
  hint: 'Running inches: longest + shortest side (long side only for Wood Table). Type a number to override for odd shapes; clear it to go back.',
  edit: {
    kind: 'number',
    get: r => (Number(r.p.running_inches_override) > 0 ? r.p.running_inches_override : Math.round(r.r.ri * 100) / 100),
    display: r => `${num(r.r.ri, 1)}${Number(r.p.running_inches_override) > 0 ? ' ✎' : ''}`,
    write: (b, ids, raw) => {
      if (raw.trim() === '') return patchProductsSame(b, ids, { running_inches_override: null });
      const n = parseNum(raw);
      return n == null || n < 0 ? null : patchProductsSame(b, ids, { running_inches_override: n || null });
    },
  },
};
const otherMhCol = ro('other_mh', 'Other MH', (r, b) => {
  const rows = b.oh.filter((o: any) => o.product_id === r.p.id && o.include !== 'No' && o.labor_type !== 'Finishing' && o.labor_type !== 'Packaging' && Number(o.man_hours_per_unit) > 0);
  const total = rows.reduce((a: number, o: any) => a + Number(o.man_hours_per_unit), 0);
  if (!total) return dash;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="underline decoration-dotted underline-offset-4 cursor-default">{num(total, 2)}</span></TooltipTrigger>
      <TooltipContent className="text-xs">{rows.map((o: any) => <div key={o.id}>{o.labor_type}: {num(Number(o.man_hours_per_unit), 3)} h</div>)}<div className="mt-1 text-muted-foreground">Edit in the product panel</div></TooltipContent>
    </Tooltip>
  );
}, 84);
const mhTotalCol = ro('mh_total', 'Total MH', r => <span className="font-medium">{num(r.r.manHoursPerUnit, 2)}</span>, 84,
  { hint: 'Man-hours per unit, all labour types', footer: rows => num(sumBy(rows, r => r.r.manHoursPerUnit * r.qty), 1) + ' h' });
const laborTotalCol = ro('labor_inr', 'Labour ₹', r => <span className="font-semibold">{inr(r.buckets.labor)}</span>, 100,
  { hint: 'Direct labour at each role\'s live LaborTrax rate plus indirect overhead per man-hour', footer: rows => inr(sumBy(rows, r => r.buckets.labor * r.qty)) });

// Shipping

const pkgTypeCol: Col = {
  id: 'pkg_type', label: 'Packaging', bulkLabel: 'Packaging type', width: 132, align: 'left',
  hint: 'How it is packed. Packaging materials are costed under COGS; carton sizes here set the CBM.',
  edit: { kind: 'select', get: r => r.p.packaging_type || 'ic_mc', options: () => PACKAGING_OPTS,
    write: (b, ids, v) => setPackagingType(b, ids, v || 'ic_mc') },
};
const perMcCol: Col = {
  id: 'per_mc', label: 'Pcs/MC', width: 72, align: 'right',
  hint: 'Pieces per master carton, calculated from the fit. Type a number to override (marked ✎); clear it to go back to the calculation.',
  edit: {
    kind: 'number',
    disabled: r => (r.p.packaging_type || 'ic_mc') === 'ic_mc' ? null : 'Only for IC + MC packaging',
    get: r => r.cbmRow?.products_per_mc_override || r.r.productsPerMc || '',
    display: r => (r.r.productsPerMc ? `${r.r.productsPerMc}${r.r.mcPlan?.override != null ? ' ✎' : ''}` : '—'),
    write: (b, ids, raw) => {
      if (raw.trim() === '') return patchCbm(b, ids, { products_per_mc_override: null });
      const n = parseNum(raw);
      return n == null || n < 0 ? null : patchCbm(b, ids, { products_per_mc_override: Math.round(n) || null });
    },
  },
};
const cartonCols: Col[] = [
  ...dimCols('ic', 'Inner carton', {
    hint: 'Inner carton inside size (auto from piece size unless typed)',
    get: (r, axis) => r.cbmRow?.[`ic_${axis}`] ?? r.r.icDims[`ic_${axis}`],
    write: (b, ids, axis, n) => patchCbm(b, ids, { [`ic_${axis}`]: n }),
  }),
  { id: 'ic_type', label: 'IC ply', width: 84, align: 'left', edit: { kind: 'select', get: r => r.cbmRow?.ic_type || '7 ply', options: boxOpts, write: (b, ids, v) => patchCbm(b, ids, { ic_type: v }) } },
  { id: 'per_ic', label: 'Pcs/IC', width: 64, align: 'right', edit: { kind: 'number', get: r => r.cbmRow?.products_per_ic || 1, write: cbmField('products_per_ic', true) } },
  { id: 'mc_type', label: 'MC ply', width: 84, align: 'left', edit: { kind: 'select', get: r => r.cbmRow?.mc_type || '7 ply', options: boxOpts, write: (b, ids, v) => patchCbm(b, ids, { mc_type: v }) } },
  ...dimCols('mc', 'Master carton max', {
    hint: 'Largest master carton allowed; inner cartons are packed into it',
    get: (r, axis) => r.cbmRow?.[`mc_max_${axis}`] || 25,
    write: (b, ids, axis, n) => patchCbm(b, ids, { [`mc_max_${axis}`]: n }),
  }),
  ro('mc_fit', 'MC fit', r => {
    const plan = r.r.mcPlan;
    if (!plan) return dash;
    return (
      <Tooltip>
        <TooltipTrigger asChild><span className="underline decoration-dotted underline-offset-4 cursor-default whitespace-nowrap">{mcPlanShort(plan)}</span></TooltipTrigger>
        <TooltipContent className="max-w-sm"><McPlanBreakdown plan={plan} /></TooltipContent>
      </Tooltip>
    );
  }, 104, { hint: 'Inner cartons across W × along D × high in the master carton. Hover for the full calculation.' }),
  perMcCol,
];
const cbmCol = ro('cbm', 'Unit CBM', r => (r.r.finalUnitCbm ? r.r.finalUnitCbm.toFixed(4) : '—'), 96,
  { footer: rows => num(sumBy(rows, r => r.r.finalUnitCbm * r.qty), 2) + ' m³' });
const shipTypeCol: Col = {
  id: 'shipping', label: 'Ship via', bulkLabel: 'Shipping type', width: 150, align: 'left',
  edit: { kind: 'select', get: r => r.shippingId || '', options: b => b.shipTypes.map((t: any) => ({ value: t.id, label: t.name })),
    disabled: (_r, b) => (b.inq?.shipping_type_id_override ? 'This inquiry sets one shipping type for every SKU in its Settings tab' : null),
    write: (b, ids, v) => (v ? setShippingType(b, ids, v) : null) },
};
const shipTotalCol = ro('ship', 'Shipping ₹', r => <span className="font-semibold">{inr(r.buckets.shipping)}</span>, 100,
  { hint: 'Freight per unit from the packed CBM, plus domestic freight for pieces sourced outside Jodhpur', footer: rows => inr(sumBy(rows, r => r.buckets.shipping * r.qty)) });

// Margin

const capitalCol = ro('capital', 'Capital ₹', r => (r.r.capitalPerUnitInr ? inr(r.r.capitalPerUnitInr) : dash), 88,
  { hint: 'Cost of capital: working-capital carry on COGS, labour and shipping (set per product in the panel)' });
const unitCostCol = ro('cost', 'Unit cost ₹', r => <span className="font-semibold">{inr(r.costInr)}</span>, 104,
  { hint: 'COGS + labour + shipping + cost of capital' });
const solveCol: Col = {
  id: 'solve', label: 'To hit target', width: 168, align: 'left',
  hint: 'Either margin you would need at today’s cost, or the cost you would need at today’s margin',
  render: r => {
    if (r.gap == null) return dash;
    if (r.gap <= 0.005) return <span className="text-xs text-primary">On or under target</span>;
    const npmNeeded = r.requiredMarkup != null ? r.requiredMarkup / (1 + r.requiredMarkup) : null;
    return (
      <div className="text-xs leading-tight">
        <div>NPM <span className={cn('font-medium tabular-nums', npmNeeded != null && npmNeeded < 0.1 && 'text-destructive')}>{npmNeeded != null ? pct(npmNeeded) : 'n/a'}</span></div>
        <div className="text-muted-foreground">or cost ≤ <span className="tabular-nums">{inr(r.maxCostInr)}</span></div>
      </div>
    );
  },
};
const lineFobCol = ro('line', 'Line FOB $', r => money(r.price * r.qty, r.cur, 0), 100, { footer: rows => money(sumBy(rows, r => r.price * r.qty), rows[0]?.cur ?? 'USD', 0) });

/** A collapsible run of columns inside a step (hardware by type, carton sizes). */
export type Sub = { id: string; label: string; hint?: string; summary: Col[]; items: Col[] };
/** One costing step. Collapsed it shows `summary`; open it shows `items`, then any summary column not among them. */
export type Band = { id: StepId; n: number; label: string; hint: string; color: string; summary: Col[]; items: (Col | Sub)[] };
export type StepId = 'cogs' | 'labour' | 'shipping' | 'margin';

const isSub = (x: Col | Sub): x is Sub => 'items' in x;

/** Always visible, left of the steps. */
export const LEAD_COLS: Col[] = [qtyCol];

export const BANDS: Band[] = [
  {
    id: 'cogs', n: 1, label: 'COGS', color: 'hsl(var(--cw-raw))',
    hint: 'Materials and components: where the piece comes from, the raw piece, subcontract, hardware, finishing and packaging materials',
    summary: [cogsTotalCol],
    items: [
      sourceCol, outsourcedCol,
      bucketCol('raw_piece', 'Raw piece'),
      bucketCol('subcontract', 'Subcontract'),
      ro('outs', 'Outsourced ₹', r => (r.buckets.outsourced ? inr(r.buckets.outsourced) : dash)),
      { id: 'hardware', label: 'Hardware', hint: 'Per-unit hardware and accessories by type, with the parts behind each total',
        summary: [hwTotalCol], items: [...HW_KEYS.map(x => bucketCol(x.key, x.label, 150, true)), hwTotalCol] },
      bucketCol('finishing', 'Finishing'),
      bucketCol('packaging', 'Packaging'),
      ro('other', 'Other ₹', r => (r.buckets.other ? inr(r.buckets.other) : dash), 88, { hint: 'Other components and one-off (non-unit) costs spread over the quantity' }),
    ],
  },
  {
    id: 'labour', n: 2, label: 'Labour', color: 'hsl(var(--cw-labor))',
    hint: 'Running inches and finish set the hours; hours × live LaborTrax rates + indirect overhead give labour per unit',
    summary: [mhTotalCol, laborTotalCol],
    items: [
      productTypeCol, difficultyCol, woodCol, riCol,
      ro('rpri', '₹ / run. in.', r => (r.r.autoLabor.finishingMethod === 'ri_budget'
        ? inr(r.r.autoLabor.rupeesPerRi)
        : <Tooltip><TooltipTrigger asChild><span className="text-muted-foreground/60 cursor-default">n/a</span></TooltipTrigger><TooltipContent>Not a wood type: finishing hours are entered by hand</TooltipContent></Tooltip>), 88,
        { hint: 'Wood finishing labour rate for the difficulty (Settings → Finishing difficulty)' }),
      ro('fin_budget', 'Finish budget ₹', r => inr(r.r.autoLabor.finishingBudgetInr), 108,
        { hint: 'Running inches × ₹/run. in. × wood %. Divided by the Finishing hourly rate to get the hours.' }),
      laborHoursCol('Finishing', 'fin_mh', 'Finish MH', 'Finishing man-hours per unit. Auto from the budget; type to set by hand (✎); type "auto" or clear to go back.'),
      laborHoursCol('Packaging', 'pkg_mh', 'Pack MH', 'Packaging man-hours per unit: 0.015 × running inches. Type to set by hand (✎); type "auto" or clear to go back.'),
      otherMhCol, mhTotalCol,
    ],
  },
  {
    id: 'shipping', n: 3, label: 'Shipping', color: 'hsl(var(--cw-ship))',
    hint: 'Piece and carton sizes give the packed CBM; the shipping type turns CBM into freight per unit',
    summary: [cbmCol, shipTotalCol],
    items: [
      pkgTypeCol,
      ...dimCols('piece', 'Piece', {
        get: (r, axis) => r.p[`${axis}_inch`],
        write: (b, ids, axis, n) => patchProductsSame(b, ids, { [`${axis}_inch`]: n }),
      }),
      { id: 'weight', label: 'Wt kg', width: 64, align: 'right', edit: { kind: 'number', get: r => r.p.weight_kg ?? '', write: productField('weight_kg') } },
      { id: 'cartons', label: 'Cartons', hint: 'Inner and master carton sizes, ply and how they pack', summary: [perMcCol], items: cartonCols },
      cbmCol,
      ro('line_cbm', 'Line CBM', r => num(r.r.finalUnitCbm * r.qty, 2), 80, { footer: rows => num(sumBy(rows, r => r.r.finalUnitCbm * r.qty), 2) }),
      shipTypeCol,
    ],
  },
  {
    id: 'margin', n: 4, label: 'Margin', color: 'hsl(var(--primary))',
    hint: 'Unit cost, margin and price against the customer’s target',
    summary: [unitCostCol, npmCol, priceCol, gapCol],
    items: [capitalCol, unitCostCol, npmCol, contribCol, priceCol, targetCol, gapCol, solveCol, lineFobCol],
  },
];

/** Which steps and sub-groups are open, by id. */
export type OpenState = Record<string, boolean>;
export const DEFAULT_OPEN: OpenState = { margin: true };

/** A visible column with where it sits: its step, and the sub-group it belongs to (open or the collapsed summary). */
export type LaidCol = Col & { band?: StepId; sub?: { id: string; label: string; hint?: string; open: boolean; first: boolean } };

/** The columns the grid shows for the given open state, left to right. */
export function layout(open: OpenState, cur: QuoteCur = 'USD'): LaidCol[] {
  const out: LaidCol[] = LEAD_COLS.map(c => ({ ...c }));
  for (const band of BANDS) {
    if (!open[band.id]) { out.push(...band.summary.map(c => ({ ...c, band: band.id }))); continue; }
    const ids = new Set<string>();
    for (const it of band.items) {
      if (!isSub(it)) { out.push({ ...it, band: band.id }); ids.add(it.id); continue; }
      const subOpen = !!open[it.id];
      const shown = subOpen ? it.items : it.summary;
      shown.forEach((c, i) => { out.push({ ...c, band: band.id, sub: { id: it.id, label: it.label, hint: it.hint, open: subOpen, first: i === 0 } }); ids.add(c.id); });
    }
    out.push(...band.summary.filter(c => !ids.has(c.id)).map(c => ({ ...c, band: band.id })));
  }
  return cur === 'USD' ? out : out.map(c => inCurrency(c, cur));
}

/** Money headers in the quote currency: "Price ₹", "Target ₹" for a rupee customer. Cells already format by row. */
function inCurrency<C extends Col>(c: C, cur: QuoteCur): C {
  if (cur === 'USD' || !/ \$$/.test(c.label)) return c;
  return { ...c, label: c.label.replace(/ \$$/, ' ₹'), hint: c.hint?.replace('(USD)', '(INR)') };
}

/** Every column of a step, open or not (sub-groups included). */
const allColsOf = (band: Band): Col[] => {
  const out: Col[] = [];
  const add = (c: Col) => { if (!out.some(x => x.id === c.id)) out.push(c); };
  for (const it of band.items) (isSub(it) ? it.items : [it]).forEach(add);
  band.summary.forEach(add);
  return out;
};

/** Every column in any step, for lookups by id (the product panel's fields). */
export const ALL_COLS: Col[] = [...LEAD_COLS, ...BANDS.flatMap(allColsOf)];

/** Every editable field, for the bulk bar's "Set" menu (deduplicated by id). */
export function bulkFields(cur: QuoteCur = 'USD'): Col[] {
  return bulkFieldGroups(cur).flatMap(g => g.cols);
}

/** The bulk bar's editable fields in the costing order: quantity, then one section per step. */
export function bulkFieldGroups(cur: QuoteCur = 'USD'): { label: string; cols: Col[] }[] {
  const editable = (cols: Col[]) => cols.filter(c => c.edit).map(c => inCurrency(c, cur));
  return [
    { label: 'Order', cols: editable(LEAD_COLS) },
    ...BANDS.map(b => ({ label: `${b.n}. ${b.label}`, cols: editable(allColsOf(b)) })),
  ].filter(g => g.cols.length);
}

/** A field's name in the bulk bar menu (Piece W", Packaging type), without the ₹ the section already says. */
export const bulkLabel = (c: Col) => c.bulkLabel ?? fullLabel(c).replace(/ ₹$/, '');

/**
 * Spreadsheet paste: cells[i][j] goes to row startRow+i and the j-th editable column from
 * startCol onwards (read-only columns are skipped). Chained into one mutation.
 */
export function writeGrid(b: Bundle, cols: Col[], startCol: number, rows: WorkspaceRow[], startRow: number, cells: string[][]): Mutation | null {
  const targets = cols.slice(startCol).filter(c => c.edit && c.edit.kind !== 'bool');
  let cur = b;
  const commits: (() => Promise<void>)[] = [];
  const touched: string[] = [];
  cells.forEach((line, i) => {
    const row = rows[startRow + i];
    if (!row) return;
    line.forEach((raw, j) => {
      const col = targets[j];
      if (!col || (raw.trim() === '' && col.edit!.kind !== 'text')) return;
      if (col.edit!.disabled?.(row, cur)) return;
      if (col.edit!.kind === 'select') {
        const opts = col.edit!.options?.(cur) ?? [];
        const hit = opts.find(o => o.value === raw.trim() || o.label.toLowerCase() === raw.trim().toLowerCase());
        if (!hit) return;
        raw = hit.value;
      }
      const m = col.edit!.write(cur, [row.p.id], raw);
      if (!m) return;
      cur = m.next; commits.push(m.commit); touched.push(...m.touched);
    });
  });
  if (!commits.length) return null;
  return { next: cur, touched, commit: async () => { for (const c of commits) await c(); } };
}
