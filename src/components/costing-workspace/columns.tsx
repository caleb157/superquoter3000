// Column definitions for the Costing Workspace views. Every editable column carries its
// own write() so cell edits, Excel-style paste-down and the bulk bar share one code path.
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { npmToMarkup } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import {
  EDITABLE_BUCKETS, patchCbm, patchProductsSame, setBucketTotal, setLaborHours,
  type Bundle, type Mutation, type WorkspaceRow,
} from '@/lib/costing-workspace';
import { CostMixBar, GapChip, inr, num, parseNum, pct, usd } from './cells';

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
  /** Read-only cell renderer. */
  render?: (row: WorkspaceRow, b: Bundle) => React.ReactNode;
  footer?: (rows: WorkspaceRow[]) => React.ReactNode;
  /** Shown in the bulk bar "Set" menu even though it isn't a column of the current view. */
  bulkOnly?: boolean;
};

export type View = { id: string; label: string; hint: string; cols: Col[] };

// ---------- helpers ----------

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

const bucketCol = (key: string, label: string, width = 96): Col => ({
  id: `bucket:${key}`, label: `${label} ₹`, width, align: 'right',
  hint: `Per-unit ${label.toLowerCase()} cost. Typing a total adjusts the main line so the bucket adds up to it.`,
  edit: {
    kind: 'number',
    get: r => Math.round(r.editBuckets[key] * 100) / 100,
    display: r => (r.editBuckets[key] ? inr(r.editBuckets[key]) : ''),
    write: (b, ids, raw) => { const n = parseNum(raw); return n == null || n < 0 ? null : setBucketTotal(b, ids, key, n); },
  },
});

const ro = (id: string, label: string, render: Col['render'], width = 96, extra: Partial<Col> = {}): Col =>
  ({ id, label, width, align: 'right', render, ...extra });

const sumBy = (rows: WorkspaceRow[], f: (r: WorkspaceRow) => number) => rows.reduce((a, r) => a + f(r), 0);

export const PACKAGING_OPTS = [
  { value: 'ic_mc', label: 'IC + MC' },
  { value: 'ic_only', label: 'IC only' },
  { value: 'bulk_pack', label: 'Bulk pack' },
  { value: 'corrugate_bubble', label: 'Corrugate + bubble' },
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
    const fob = sumBy(rows, r => r.priceUsd * r.qty);
    const cost = sumBy(rows, r => r.costUsd * r.qty);
    return fob > 0 ? pct((fob - cost) / fob) : '—';
  },
};

const contribCol: Col = {
  id: 'contrib', label: 'Contrib %', width: 84, align: 'right',
  hint: 'Contribution rate: net margin plus the indirect (factory) overhead this SKU absorbs. Equals NPM for bought-in items with no man-hours, so trading and manufacturing work compare fairly.',
  render: r => <span className="tabular-nums text-muted-foreground">{pct(r.contribution)}</span>,
  footer: rows => {
    const fob = sumBy(rows, r => r.priceUsd * r.qty);
    return fob > 0 ? pct(sumBy(rows, r => (r.priceUsd - r.costUsd + r.indirectUsd) * r.qty) / fob) : '—';
  },
};

const targetCol: Col = {
  id: 'target', label: 'Target $', width: 88, align: 'right',
  hint: "Customer's target price per unit (USD). Leave blank for none.",
  edit: {
    kind: 'number',
    get: r => (r.targetUsd == null ? '' : r.targetUsd),
    display: r => (r.targetUsd == null ? '' : usd(r.targetUsd)),
    write: (b, ids, raw) => {
      if (raw.trim() === '') return patchProductsSame(b, ids, { target_price_usd: null });
      const n = parseNum(raw);
      return n == null || n < 0 ? null : patchProductsSame(b, ids, { target_price_usd: n });
    },
  },
};

const costCol = ro('cost', 'Unit cost ₹', r => inr(r.costInr), 100);
const priceCol = ro('price', 'Price $', r => <span className="font-semibold">{usd(r.priceUsd)}</span>, 88);
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
    write: (b, ids, v) => patchProductsSame(b, ids, { finishing_difficulty: v }) },
};
const woodCol: Col = {
  id: 'wood', label: 'Wood %', width: 76, align: 'right',
  edit: { kind: 'number', get: r => Math.round((r.p.percent_wood ?? 1) * 100), display: r => `${Math.round((r.p.percent_wood ?? 1) * 100)}%`,
    write: (b, ids, raw) => { const n = parseNum(raw); return n == null || n < 0 || n > 100 ? null : patchProductsSame(b, ids, { percent_wood: n / 100 }); } },
};

// ---------- views ----------

export const VIEWS: View[] = [
  {
    id: 'price', label: 'Price & target', hint: 'Where every SKU lands against its target, and what it would take to get there',
    cols: [
      qtyCol,
      { id: 'mix', label: 'Cost mix', width: 150, render: r => <CostMixBar row={r} /> },
      costCol,
      npmCol,
      contribCol,
      priceCol,
      targetCol,
      gapCol,
      {
        id: 'solve', label: 'To hit target', width: 168, align: 'left',
        hint: 'Either margin you would need at today’s cost, or the cost you would need at today’s margin',
        render: r => {
          if (r.gapUsd == null) return <span className="text-muted-foreground/50">—</span>;
          if (r.gapUsd <= 0.005) return <span className="text-xs text-primary">On or under target</span>;
          const npmNeeded = r.requiredMarkup != null ? r.requiredMarkup / (1 + r.requiredMarkup) : null;
          return (
            <div className="text-xs leading-tight">
              <div>NPM <span className={cn('font-medium tabular-nums', npmNeeded != null && npmNeeded < 0.1 && 'text-destructive')}>{npmNeeded != null ? pct(npmNeeded) : 'n/a'}</span></div>
              <div className="text-muted-foreground">or cost ≤ <span className="tabular-nums">{inr(r.maxCostInr)}</span></div>
            </div>
          );
        },
      },
      ro('line', 'Line FOB $', r => usd(r.priceUsd * r.qty, 0), 100, { footer: rows => usd(sumBy(rows, r => r.priceUsd * r.qty), 0) }),
    ],
  },
  {
    id: 'buildup', label: 'Cost build-up', hint: 'Per-unit cost by bucket — type a bucket total to change it',
    cols: [
      bucketCol('raw_piece', 'Raw piece'),
      bucketCol('subcontract', 'Subcontract'),
      ro('hw', 'Hardware ₹', r => {
        const parts = EDITABLE_BUCKETS.filter(x => x.key.startsWith('hw_') || x.key === 'accessories').filter(x => r.editBuckets[x.key] > 0);
        const total = parts.reduce((a, x) => a + r.editBuckets[x.key], 0);
        if (!total) return <span className="text-muted-foreground/50">—</span>;
        return (
          <Tooltip>
            <TooltipTrigger asChild><span className="underline decoration-dotted underline-offset-4 cursor-default">{inr(total)}</span></TooltipTrigger>
            <TooltipContent className="text-xs">{parts.map(x => <div key={x.key}>{x.label}: {inr(r.editBuckets[x.key])}</div>)}<div className="mt-1 text-muted-foreground">Edit in the Hardware view</div></TooltipContent>
          </Tooltip>
        );
      }),
      bucketCol('finishing', 'Finishing'),
      bucketCol('packaging', 'Packaging'),
      ro('outs', 'Outsourced ₹', r => (r.buckets.outsourced ? inr(r.buckets.outsourced) : <span className="text-muted-foreground/50">—</span>)),
      ro('labor', 'Labor & OH ₹', r => inr(r.buckets.labor), 100),
      ro('ship', 'Shipping ₹', r => inr(r.buckets.shipping)),
      ro('cost_b', 'Unit cost ₹', r => <span className="font-semibold">{inr(r.costInr)}</span>, 104),
      priceCol,
    ],
  },
  {
    id: 'quotes', label: 'Vendor quotes', hint: 'Raw-piece quotes side by side — pick the winner per SKU',
    cols: [], // rendered by QuotesGrid
  },
  {
    id: 'hardware', label: 'Hardware', hint: 'Per-unit hardware and accessories',
    cols: [
      ...EDITABLE_BUCKETS.filter(x => x.key.startsWith('hw_') || x.key === 'accessories').map(x => bucketCol(x.key, x.label, 112)),
      ro('hw_total', 'Hardware total ₹', r => inr(EDITABLE_BUCKETS.filter(x => x.key.startsWith('hw_') || x.key === 'accessories').reduce((a, x) => a + r.editBuckets[x.key], 0)), 120),
    ],
  },
  {
    id: 'packaging', label: 'Packaging & CBM', hint: 'Piece and carton sizes → packed CBM',
    cols: [
      {
        id: 'pkg_type', label: 'Packaging', width: 132, align: 'left',
        edit: { kind: 'select', get: r => r.p.packaging_type || 'ic_mc', options: () => PACKAGING_OPTS,
          write: (b, ids, v) => patchProductsSame(b, ids, { packaging_type: v || 'ic_mc' }) },
      },
      ...dimCols('piece', 'Piece', {
        get: (r, axis) => r.p[`${axis}_inch`],
        write: (b, ids, axis, n) => patchProductsSame(b, ids, { [`${axis}_inch`]: n }),
      }),
      { id: 'weight', label: 'Wt kg', width: 64, align: 'right', edit: { kind: 'number', get: r => r.p.weight_kg ?? '', write: productField('weight_kg') } },
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
      ro('per_mc', 'Pcs/MC', r => (r.r.productsPerMc ? String(r.r.productsPerMc) : '—'), 64),
      ro('cbm', 'Unit CBM', r => (r.r.finalUnitCbm ? r.r.finalUnitCbm.toFixed(4) : '—'), 80),
      ro('line_cbm', 'Line CBM', r => num(r.r.finalUnitCbm * r.qty, 2), 80, { footer: rows => num(sumBy(rows, r => r.r.finalUnitCbm * r.qty), 2) }),
    ],
  },
  {
    id: 'labor', label: 'Labor', hint: 'Running inches → finishing budget and hours, packaging hours, all labor per unit',
    cols: [
      {
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
      },
      difficultyCol,
      ro('rpri', '₹ / run. in.', r => (r.r.autoLabor.finishingMethod === 'ri_budget'
        ? inr(r.r.autoLabor.rupeesPerRi)
        : <Tooltip><TooltipTrigger asChild><span className="text-muted-foreground/60 cursor-default">n/a</span></TooltipTrigger><TooltipContent>Not a wood type: finishing uses the product type's MH per 100 running inches</TooltipContent></Tooltip>), 88,
        { hint: 'Wood finishing labor rate for the difficulty (Settings → Finishing difficulty)' }),
      woodCol,
      ro('fin_budget', 'Finish budget ₹', r => inr(r.r.autoLabor.finishingBudgetInr), 108,
        { hint: 'Running inches × ₹/run. in. × wood %. Divided by the Finishing hourly rate to get the hours.' }),
      laborHoursCol('Finishing', 'fin_mh', 'Finish MH', 'Finishing man-hours per unit. Auto from the budget; type to set by hand (✎); type "auto" or clear to go back.'),
      laborHoursCol('Packaging', 'pkg_mh', 'Pack MH', 'Packaging man-hours per unit: 0.015 × running inches. Type to set by hand (✎); type "auto" or clear to go back.'),
      ro('other_mh', 'Other MH', (r, b) => {
        const rows = b.oh.filter((o: any) => o.product_id === r.p.id && o.include !== 'No' && o.labor_type !== 'Finishing' && o.labor_type !== 'Packaging' && Number(o.man_hours_per_unit) > 0);
        const total = rows.reduce((a: number, o: any) => a + Number(o.man_hours_per_unit), 0);
        if (!total) return <span className="text-muted-foreground/50">—</span>;
        return (
          <Tooltip>
            <TooltipTrigger asChild><span className="underline decoration-dotted underline-offset-4 cursor-default">{num(total, 2)}</span></TooltipTrigger>
            <TooltipContent className="text-xs">{rows.map((o: any) => <div key={o.id}>{o.labor_type}: {num(Number(o.man_hours_per_unit), 3)} h</div>)}<div className="mt-1 text-muted-foreground">Edit in the product panel</div></TooltipContent>
          </Tooltip>
        );
      }, 84),
      ro('mh_total', 'Total MH', r => <span className="font-medium">{num(r.r.manHoursPerUnit, 2)}</span>, 84,
        { footer: rows => num(sumBy(rows, r => r.r.manHoursPerUnit * r.qty), 1) + ' h' }),
      ro('labor_inr', 'Labor & OH ₹', r => <span className="font-semibold">{inr(r.buckets.labor)}</span>, 108,
        { hint: 'Direct labor at each role\'s hourly rate plus indirect overhead per man-hour', footer: rows => inr(sumBy(rows, r => r.buckets.labor * r.qty)) }),
    ],
  },
  {
    id: 'setup', label: 'Product setup', hint: 'Type, finish, wood content, source and outsourcing',
    cols: [
      qtyCol,
      {
        id: 'ptype', label: 'Product type', width: 170, align: 'left',
        edit: { kind: 'select', get: r => r.p.product_type_id || '', options: b => [{ value: '', label: '—' }, ...b.productTypes.map((t: any) => ({ value: t.id, label: t.name }))],
          write: (b, ids, v) => patchProductsSame(b, ids, { product_type_id: v || null }) },
      },
      difficultyCol,
      woodCol,
      {
        id: 'source', label: 'Source', width: 140, align: 'left',
        edit: { kind: 'select', get: r => r.p.source_location_id || '', options: b => [{ value: '', label: 'In-house (Jodhpur)' }, ...b.locations.map((l: any) => ({ value: l.id, label: l.name }))],
          write: (b, ids, v) => patchProductsSame(b, ids, { source_location_id: v || null }) },
      },
      {
        id: 'outsourced', label: 'Outsourced', width: 92, align: 'center',
        edit: { kind: 'bool', get: r => !!r.p.is_outsourced, write: (b, ids, v) => patchProductsSame(b, ids, { is_outsourced: v === 'true' }) },
      },
      ro('mh', 'Man-hrs/unit', r => (r.r.manHoursPerUnit ? r.r.manHoursPerUnit.toFixed(2) : '—'), 96, { footer: rows => num(sumBy(rows, r => r.r.manHoursPerUnit * r.qty), 1) + ' h' }),
      ro('ship_m', 'Shipping', r => <span className="text-xs">{r.shippingName}</span>, 150, { align: 'left' }),
    ],
  },
];

/** Every editable field, for the bulk bar's "Set" menu (deduplicated by id). */
export function bulkFields(): Col[] {
  const seen = new Set<string>();
  const out: Col[] = [];
  for (const v of VIEWS) for (const c of v.cols) {
    if (!c.edit || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** Per-row writes (different value per product) chained into one mutation — used by paste. */
export function writeEach(b: Bundle, col: Col, pairs: { id: string; raw: string }[]): Mutation | null {
  let cur = b;
  const commits: (() => Promise<void>)[] = [];
  const touched: string[] = [];
  for (const { id, raw } of pairs) {
    const m = col.edit!.write(cur, [id], raw);
    if (!m) continue;
    cur = m.next; commits.push(m.commit); touched.push(...m.touched);
  }
  if (!commits.length) return null;
  return { next: cur, touched, commit: async () => { for (const c of commits) await c(); } };
}


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
