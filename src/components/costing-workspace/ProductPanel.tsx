// Drill-in for one SKU: price vs target with a solver, the cost waterfall, and every
// costing row (COGS lines, labor, packaging, product setup) editable in place.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { avgRateByDesignation, npmToMarkup } from '@/lib/calculations';
import { COGS_CATEGORY_FALLBACK, useCogsCategories } from '@/lib/cogs-categories';
import { cn } from '@/lib/utils';
import { isPhotoEstimated, type PhotoEstimateRecord } from '@/lib/photo-intake';
import {
  BUCKETS, addCogsLine, chooseQuote, deleteCogsLine, lineValue, patchCogsLine, patchNonUnit, patchOverhead,
  patchProductsSame, type Apply, type Bundle, type WorkspaceRow,
} from '@/lib/costing-workspace';
import { CostMixBar, EditCell, GapChip, SelectCell, Thumb, inr, num, parseNum, pct, usd } from './cells';
import { VIEWS, type Col } from './columns';

const colById = (id: string): Col => VIEWS.flatMap(v => v.cols).find(c => c.id === id)!;

export function ProductPanel({ row, bundle, apply, onClose, onPrev, onNext, position }: {
  row: WorkspaceRow; bundle: Bundle; apply: Apply; onClose: () => void; onPrev?: () => void; onNext?: () => void; position: string;
}) {
  const { p, r } = row;
  const id = p.id;
  const npmNeeded = row.requiredMarkup != null ? row.requiredMarkup / (1 + row.requiredMarkup) : null;
  const over = (row.gapUsd ?? 0) > 0.005;

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Thumb p={p} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold leading-tight">{p.name}</div>
          <div className="truncate text-xs text-muted-foreground mt-0.5">
            {p.sku || 'No SKU'} · {row.qty.toLocaleString()} pcs · {num(p.width_inch, 1)}×{num(p.depth_inch, 1)}×{num(p.height_inch, 1)}"
            {bundle.productTypes.find(t => t.id === p.product_type_id)?.name ? ` · ${bundle.productTypes.find(t => t.id === p.product_type_id).name}` : ''}
          </div>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{position}</span>
        <div className="flex items-center">
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!onPrev} onClick={onPrev} aria-label="Previous SKU"><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!onNext} onClick={onNext} aria-label="Next SKU"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild size="icon" variant="ghost" className="h-8 w-8"><Link to={`/product/${id}?tab=costing`}><ExternalLink className="h-4 w-4" /></Link></Button>
          </TooltipTrigger>
          <TooltipContent>Open the full costing sheet</TooltipContent>
        </Tooltip>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isPhotoEstimated(p) && <PhotoEstimateNote est={p.photo_estimate} onChecked={() =>
          apply(b => patchProductsSame(b, [id], { photo_estimate: { ...p.photo_estimate, checked_at: new Date().toISOString() } }))} />}

        {/* Price vs target */}
        <div className="grid grid-cols-4 gap-px border-b bg-border">
          <Figure label="Unit cost" value={inr(row.costInr)} sub={usd(row.costUsd)} />
          <Figure label="NPM" sub={`markup ${pct(row.markup)}`}>
            <PanelInput col={colById('npm')} row={row} bundle={bundle} apply={apply} big />
          </Figure>
          <Figure label="Price" value={<span className="text-primary">{usd(row.priceUsd)}</span>} sub={inr(row.priceInr)} />
          <Figure label="Target" sub={<GapChip row={row} />}>
            <PanelInput col={colById('target')} row={row} bundle={bundle} apply={apply} big placeholder="none" />
          </Figure>
        </div>
        {over && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-destructive/[0.04] px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">To hit {usd(row.targetUsd)}:</span>
            <span>NPM <b className="tabular-nums">{npmNeeded != null ? pct(npmNeeded) : 'n/a'}</b></span>
            {npmNeeded != null && npmNeeded > 0 && (
              <Button size="sm" variant="outline" className="h-7"
                disabled={bundle.inq?.markup_percent_override != null}
                onClick={() => apply(b => patchProductsSame(b, [id], { markup_percent: Math.round(npmToMarkup(npmNeeded) * 10000) / 10000 }))}>
                Apply
              </Button>
            )}
            <span className="text-muted-foreground">or cut cost by</span>
            <b className="tabular-nums">{inr(row.costInr - (row.maxCostInr ?? 0))}</b>
            <span className="text-muted-foreground">({pct((row.costInr - (row.maxCostInr ?? 0)) / (row.costInr || 1))}) to {inr(row.maxCostInr)}</span>
          </div>
        )}

        {/* Waterfall */}
        <Section title="Where the price comes from" defaultOpen>
          <CostMixBar row={row} showLegend />
          <table className="mt-3 w-full text-sm tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:pb-1 [&>th]:font-medium">
                <th className="text-left">Per unit</th><th className="text-right">₹</th><th className="text-right">of price</th>
              </tr>
            </thead>
            <tbody className="[&>tr>td]:py-1">
              {BUCKETS.filter(b => row.buckets[b.key] > 0.005).map(b => (
                <tr key={b.key}>
                  <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: b.color }} />{b.label}</td>
                  <td className="text-right">{inr(row.buckets[b.key], 2)}</td>
                  <td className="w-20 text-right text-muted-foreground">{pct(row.buckets[b.key] / (row.priceInr || 1))}</td>
                </tr>
              ))}
              {r.capitalPerUnitInr > 0 && (
                <tr><td className="pl-[18px]">Cost of capital</td><td className="text-right">{inr(r.capitalPerUnitInr, 2)}</td><td className="text-right text-muted-foreground">{pct(r.capitalPerUnitInr / (row.priceInr || 1))}</td></tr>
              )}
              <tr className="border-t font-medium"><td className="pt-2">Unit cost</td><td className="pt-2 text-right">{inr(row.costInr, 2)}</td><td className="pt-2 text-right text-muted-foreground">{pct(row.costInr / (row.priceInr || 1))}</td></tr>
              <tr className="text-primary"><td>Margin ({pct(row.margin)} NPM)</td><td className="text-right">{inr(row.priceInr - row.costInr, 2)}</td><td className="text-right">{pct(row.margin)}</td></tr>
              <tr className="border-t font-semibold"><td className="pt-2">Price</td><td className="pt-2 text-right">{inr(row.priceInr, 2)}</td><td className="pt-2 text-right">{usd(row.priceUsd)}</td></tr>
            </tbody>
          </table>
          <div className="mt-2 text-xs text-muted-foreground">₹{num(r.exchangeRate, 2)} / $ · {r.finalUnitCbm.toFixed(4)} CBM/unit · {num(r.manHoursPerUnit, 2)} man-hrs/unit</div>
        </Section>

        <Section title="Materials & components" count={bundle.cogs.filter(c => c.product_id === id && c.include !== 'No').length} defaultOpen>
          <CogsLines row={row} bundle={bundle} apply={apply} />
        </Section>

        <Section title="Labor & overhead" sub={inr(row.buckets.labor) + '/unit'}>
          <LaborLines row={row} bundle={bundle} apply={apply} />
        </Section>

        <Section title="Packaging & CBM" sub={`${r.finalUnitCbm.toFixed(4)} CBM · ${r.productsPerMc || 1}/MC`}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {['pkg_type', 'weight'].map(cid => <Field key={cid} col={colById(cid)} row={row} bundle={bundle} apply={apply} />)}
          </div>
          {[['piece', 'Piece size'], ['ic', 'Inner carton size'], ['mc', 'Master carton max']].map(([prefix, label]) => (
            <div key={prefix} className="mt-2.5">
              <div className="text-xs text-muted-foreground">{label} (inches)</div>
              <div className="mt-0.5 grid grid-cols-3 gap-2">
                {['w', 'd', 'h'].map(a => <Field key={a} col={colById(`${prefix}_${a}`)} row={row} bundle={bundle} apply={apply} inline />)}
              </div>
            </div>
          ))}
          <div className="mt-2.5 grid grid-cols-3 gap-x-4 gap-y-2.5">
            {['ic_type', 'per_ic', 'mc_type'].map(cid => <Field key={cid} col={colById(cid)} row={row} bundle={bundle} apply={apply} />)}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-muted/50 p-3 text-xs">
            <Mini label="MC size" value={r.mcDims.mc_width ? `${num(r.mcDims.mc_width, 1)}×${num(r.mcDims.mc_depth, 1)}×${num(r.mcDims.mc_height, 1)}"` : '—'} />
            <Mini label="IC cost" value={inr(r.icCost, 1)} />
            <Mini label="MC cost" value={inr(r.mcCost, 1)} />
            <Mini label="Line CBM" value={num(r.finalUnitCbm * row.qty, 2)} />
          </div>
          {r.bulkPack?.warning && <div className="mt-2 text-xs text-amber-600">{r.bulkPack.warning}</div>}
        </Section>

        <Section title="Product setup">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {['qty', 'ptype', 'difficulty', 'wood', 'source', 'outsourced'].map(cid => (
              <Field key={cid} col={colById(cid)} row={row} bundle={bundle} apply={apply} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={!!p.cost_of_capital_enabled} onCheckedChange={c => apply(b => patchProductsSame(b, [id], { cost_of_capital_enabled: !!c }))} />
              Cost of capital
            </label>
            <div className={cn('flex items-center gap-1.5', !p.cost_of_capital_enabled && 'opacity-40 pointer-events-none')}>
              <div className="w-20"><EditCell className="border-border" value={p.cost_of_capital_monthly_rate ?? ''} onCommit={raw => { const n = parseNum(raw); if (n != null && n >= 0) apply(b => patchProductsSame(b, [id], { cost_of_capital_monthly_rate: n })); }} /></div>
              <span className="text-muted-foreground">% / month ×</span>
              <div className="w-16"><EditCell className="border-border" value={p.cost_of_capital_months ?? ''} onCommit={raw => { const n = parseNum(raw); if (n != null && n >= 0) apply(b => patchProductsSame(b, [id], { cost_of_capital_months: n })); }} /></div>
              <span className="text-muted-foreground">months</span>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ---------- pieces ----------

function Figure({ label, value, sub, children }: { label: string; value?: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-3 min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children ?? <div className="text-xl font-semibold tabular-nums leading-tight mt-0.5 h-8 flex items-center">{value}</div>}
      <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">{sub}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="font-medium tabular-nums">{value}</div></div>;
}

/** What the photo estimate assumed, until someone has checked the draft numbers. */
function PhotoEstimateNote({ est, onChecked }: { est: PhotoEstimateRecord; onChecked: () => void }) {
  const [more, setMore] = useState(false);
  const assumptions = est.assumptions ?? [];
  return (
    <div className="border-b bg-violet-500/[0.05] px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium">Estimated from a photo <span className="font-normal text-muted-foreground">· {est.confidence} confidence</span></div>
          {est.summary && <p className="text-muted-foreground">{est.summary}</p>}
          {est.raw_piece_basis && <p className="text-xs text-muted-foreground">Raw piece: {est.raw_piece_basis}</p>}
          {assumptions.length > 0 && (
            <>
              <button className="text-xs text-primary hover:underline" onClick={() => setMore(m => !m)}>
                {more ? 'Hide' : 'Show'} {assumptions.length} assumption{assumptions.length === 1 ? '' : 's'} to check
              </button>
              {more && <ul className="space-y-0.5 text-xs text-muted-foreground">{assumptions.map((a, i) => <li key={i}>• {a}</li>)}</ul>}
            </>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1" onClick={onChecked}><Check className="h-3.5 w-3.5" /> Mark checked</Button>
      </div>
    </div>
  );
}

function Section({ title, sub, count, defaultOpen, children }: { title: string; sub?: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b">
      <button className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40" onClick={() => setOpen(o => !o)}>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        <span className="text-sm font-semibold">{title}</span>
        {count != null && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{count}</span>}
        {sub && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{sub}</span>}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function PanelInput({ col, row, bundle, apply, big, placeholder }: { col: Col; row: WorkspaceRow; bundle: Bundle; apply: Apply; big?: boolean; placeholder?: string }) {
  const e = col.edit!;
  return (
    <EditCell
      value={e.get(row) as any}
      display={e.display?.(row)}
      disabled={e.disabled?.(row, bundle) ?? null}
      align="left"
      placeholder={placeholder}
      className={cn('-ml-2 border-border/60', big && 'h-9 mt-0.5 text-xl font-semibold')}
      onCommit={raw => apply(b => e.write(b, [row.p.id], raw))}
    />
  );
}

function Field({ col, row, bundle, apply, inline }: { col: Col; row: WorkspaceRow; bundle: Bundle; apply: Apply; inline?: boolean }) {
  const e = col.edit!;
  const v = e.get(row);
  return (
    <label className={cn('min-w-0', inline ? 'flex items-center gap-1.5' : 'block')}>
      <span className={cn('text-xs text-muted-foreground', inline && 'w-3 shrink-0')}>{inline ? col.label.replace('"', '') : col.label}</span>
      <div className={cn(inline ? 'flex-1 min-w-0' : 'mt-0.5')}>
        {e.kind === 'bool' ? (
          <div className="h-8 flex items-center"><Checkbox checked={!!v} onCheckedChange={c => apply(b => e.write(b, [row.p.id], String(!!c)))} /></div>
        ) : e.kind === 'select' ? (
          <SelectCell className="border-border" value={String(v ?? '')} options={e.options?.(bundle) ?? []} onChange={val => apply(b => e.write(b, [row.p.id], val))} />
        ) : (
          <EditCell className="border-border" kind={e.kind === 'number' ? 'number' : 'text'} align="left" value={v as any} display={e.display?.(row)}
            disabled={e.disabled?.(row, bundle) ?? null}
            onCommit={raw => apply(b => e.write(b, [row.p.id], raw))} />
        )}
      </div>
    </label>
  );
}

function CogsLines({ row, bundle, apply }: { row: WorkspaceRow; bundle: Bundle; apply: Apply }) {
  const categories = useCogsCategories();
  const [addType, setAddType] = useState('Raw Piece');
  const [showExcluded, setShowExcluded] = useState(false);
  const id = row.p.id;
  const resolved = new Map((row.r.resolvedCogsRows as any[]).map(c => [c.id, c]));
  const order = [...categories, ...COGS_CATEGORY_FALLBACK];
  const lines = bundle.cogs.filter(c => c.product_id === id)
    .map(c => resolved.get(c.id) ?? c)
    .sort((a, b) => (order.indexOf(a.cogs_type) + 1 || 99) - (order.indexOf(b.cogs_type) + 1 || 99) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const excluded = lines.filter(l => l.include === 'No');
  const visible = showExcluded ? lines : lines.filter(l => l.include !== 'No' || l.cogs_type === 'Raw Piece');
  const types = [...new Set(visible.map(l => l.cogs_type))];
  const rawSlots = lines.filter(l => l.cogs_type === 'Raw Piece');

  const save = (lineId: string, patch: Record<string, any>) => apply(b => patchCogsLine(b, lineId, patch));
  const numSave = (lineId: string, field: string, scale = 1) => (raw: string) => {
    const n = parseNum(raw); if (n == null || n < 0) return; save(lineId, { [field]: n / scale });
  };

  return (
    <div className="space-y-3">
      <table className="w-full table-fixed text-sm">
        <colgroup><col style={{ width: 28 }} /><col /><col style={{ width: 110 }} /><col style={{ width: 64 }} /><col style={{ width: 84 }} /><col style={{ width: 56 }} /><col style={{ width: 76 }} /><col style={{ width: 28 }} /></colgroup>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:pb-1 [&>th]:font-medium">
            <th /><th className="text-left">Item</th><th className="text-left">Vendor</th><th className="text-right">Qty</th><th className="text-right">₹ each</th><th className="text-right">Waste</th><th className="text-right">₹ / unit</th><th />
          </tr>
        </thead>
        {types.map(t => (
          <tbody key={t}>
            <tr><td colSpan={8} className="pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">{t}{t === 'Raw Piece' && rawSlots.length > 1 ? ' — pick one quote' : ''}</td></tr>
            {visible.filter(l => l.cogs_type === t).map(l => {
              const auto = !!l.is_auto_calculated;
              const off = l.include === 'No';
              return (
                <tr key={l.id} className={cn('[&>td]:py-0.5', off && 'opacity-50')}>
                  <td>
                    {t === 'Raw Piece' ? (
                      <button onClick={() => apply(b => chooseQuote(b, id, rawSlots.indexOf(l)))}
                        className={cn('h-4 w-4 rounded-full border-2 grid place-items-center', !off ? 'border-primary' : 'border-muted-foreground/40 hover:border-primary')}
                        aria-label="Use this quote">
                        {!off && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </button>
                    ) : (
                      <Checkbox checked={!off} onCheckedChange={c => save(l.id, { include: c ? 'Yes' : 'No' })} aria-label="Include" />
                    )}
                  </td>
                  <td className="min-w-0">
                    <div className="flex items-center gap-1 min-w-0">
                      <EditCell kind="text" align="left" value={l.component_name ?? ''} className="min-w-0" onCommit={raw => save(l.id, { component_name: raw.trim() || t })} />
                      {auto && <Tooltip><TooltipTrigger asChild><span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">AUTO</span></TooltipTrigger><TooltipContent className="max-w-xs">Quantity and price are calculated by the costing engine from size, packaging and product type</TooltipContent></Tooltip>}
                    </div>
                  </td>
                  <td><EditCell kind="text" align="left" placeholder="—" value={l.vendor_name ?? ''} onCommit={raw => save(l.id, { vendor_name: raw.trim() || null })} /></td>
                  <td><EditCell value={+(+l.components_per_product || 0).toFixed(4)} disabled={auto ? 'Calculated by the engine' : null} onCommit={numSave(l.id, 'components_per_product')} /></td>
                  <td><EditCell value={+(+l.unit_cost_inr || 0).toFixed(2)} display={inr(+l.unit_cost_inr || 0, 2)} disabled={auto ? 'Calculated by the engine' : null} onCommit={numSave(l.id, 'unit_cost_inr')} /></td>
                  <td><EditCell value={Math.round((+l.waste_factor || 0) * 1000) / 10} display={l.waste_factor ? `${Math.round(+l.waste_factor * 1000) / 10}%` : ''} onCommit={numSave(l.id, 'waste_factor', 100)} /></td>
                  <td className="text-right tabular-nums pr-1 font-medium">{off ? '—' : inr(lineValue(l), 2)}</td>
                  <td>
                    {!auto && (
                      <button className="text-muted-foreground/50 hover:text-destructive" onClick={() => apply(b => deleteCogsLine(b, l.id))} aria-label="Delete line"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <div className="flex items-center gap-2">
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={addType} onChange={e => setAddType(e.target.value)}>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => apply(b => addCogsLine(b, id, addType, addType === 'Raw Piece' ? { include: rawSlots.some(l => l.include === 'Yes') ? 'No' : 'Yes', sort_order: rawSlots.length, component_name: `Raw Piece ${rawSlots.length + 1}` } : {}))}>
          <Plus className="h-3.5 w-3.5" /> Add line
        </Button>
        {excluded.length > 0 && (
          <button className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowExcluded(s => !s)}>
            {showExcluded ? 'Hide' : 'Show'} {excluded.length} excluded line{excluded.length === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </div>
  );
}

function LaborLines({ row, bundle, apply }: { row: WorkspaceRow; bundle: Bundle; apply: Apply }) {
  const id = row.p.id;
  const oh = bundle.oh.filter(o => o.product_id === id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const nu = bundle.nu.filter(n => n.product_id === id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return (
    <div className="space-y-4">
      <table className="w-full table-fixed text-sm">
        <colgroup><col style={{ width: 28 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 84 }} /><col style={{ width: 84 }} /></colgroup>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:pb-1 [&>th]:font-medium">
            <th /><th className="text-left">Labor</th><th className="text-right">Hrs / unit</th><th className="text-right">₹ / hr</th><th className="text-right">₹ / unit</th>
          </tr>
        </thead>
        <tbody>
          {oh.map(o => {
            const rate = avgRateByDesignation(bundle.employees as any, o.labor_type);
            const off = o.include === 'No';
            return (
              <tr key={o.id} className={cn('[&>td]:py-0.5', off && 'opacity-50')}>
                <td><Checkbox checked={!off} onCheckedChange={c => apply(b => patchOverhead(b, o.id, { include: c ? 'Yes' : 'No' }))} /></td>
                <td>
                  <span className="pl-2">{o.labor_type}</span>
                  {o.is_auto_estimated && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">AUTO</span>}
                </td>
                <td>
                  <EditCell value={+(+o.man_hours_per_unit || 0).toFixed(3)} disabled={o.is_auto_estimated ? 'Estimated from size and finish difficulty' : null}
                    onCommit={raw => { const n = parseNum(raw); if (n != null && n >= 0) apply(b => patchOverhead(b, o.id, { man_hours_per_unit: n })); }} />
                </td>
                <td className="text-right tabular-nums text-muted-foreground pr-2">{inr(rate)}</td>
                <td className="text-right tabular-nums pr-1">{off ? '—' : inr((+o.man_hours_per_unit || 0) * rate, 2)}</td>
              </tr>
            );
          })}
          <tr className="border-t text-sm">
            <td /><td className="pl-2 pt-1.5 text-muted-foreground">Direct labor</td><td className="text-right pt-1.5 tabular-nums">{num(row.r.manHoursPerUnit, 3)}</td><td />
            <td className="text-right pt-1.5 tabular-nums font-medium pr-1">{inr(row.r.directOhPerUnit, 2)}</td>
          </tr>
          <tr className="text-sm">
            <td /><td className="pl-2 text-muted-foreground" colSpan={3}>Indirect overhead (factory rate × hours)</td>
            <td className="text-right tabular-nums font-medium pr-1">{inr(row.r.indirectOhPerUnit, 2)}</td>
          </tr>
        </tbody>
      </table>
      {nu.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">Order-level costs (spread over {row.qty.toLocaleString()} pcs)</div>
          <table className="w-full table-fixed text-sm">
            <colgroup><col style={{ width: 28 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 84 }} /><col style={{ width: 84 }} /></colgroup>
            <tbody>
              {nu.map(n => {
                const off = n.include === 'No';
                const autoT = n.name === 'Auto Transport' && !n.manual_override;
                return (
                  <tr key={n.id} className={cn('[&>td]:py-0.5', off && 'opacity-50')}>
                    <td><Checkbox checked={!off} onCheckedChange={c => apply(b => patchNonUnit(b, n.id, { include: c ? 'Yes' : 'No' }))} /></td>
                    <td className="pl-2 truncate">{n.name}{autoT && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">AUTO</span>}</td>
                    <td><EditCell value={+(+n.total_quantity || 0).toFixed(3)} disabled={autoT ? 'Packed CBM × quantity' : null}
                      onCommit={raw => { const v = parseNum(raw); if (v != null && v >= 0) apply(b => patchNonUnit(b, n.id, { total_quantity: v })); }} /></td>
                    <td><EditCell value={+n.cost_each_inr || 0} display={inr(+n.cost_each_inr || 0)} disabled={autoT ? 'Auto transport rate from Settings' : null}
                      onCommit={raw => { const v = parseNum(raw); if (v != null && v >= 0) apply(b => patchNonUnit(b, n.id, { cost_each_inr: v })); }} /></td>
                    <td className="text-right tabular-nums pr-1">{off || !row.qty ? '—' : inr(((+n.total_quantity || 0) * (+n.cost_each_inr || 0)) / row.qty, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
