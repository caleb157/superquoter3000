// One SKU's full costing: price vs target with a solver, the cost waterfall, and every
// costing row (COGS lines, labor, order-level costs, packaging, shipping, product setup)
// editable in place. Used as the drill-in panel of the Costing Workspace and, in page
// mode, as the product page's Costing tab (with product details, chemicals and vendors).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Plus, RotateCcw, Sparkles, Target, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FobEstimatePanel } from '@/components/FobEstimatePanel';
import { ProductChemicalsPicker } from '@/components/ProductChemicalsPicker';
import { VendorCombobox } from '@/components/VendorCombobox';
import { supabase } from '@/integrations/supabase/client';
import { avgRateByDesignation, npmToMarkup } from '@/lib/calculations';
import { COGS_CATEGORY_FALLBACK, isHardwareCogsType, useCogsCategories } from '@/lib/cogs-categories';
import { cn } from '@/lib/utils';
import { isPhotoEstimated, type PhotoEstimateRecord } from '@/lib/photo-intake';
import {
  BUCKETS, addCogsLine, addNonUnit, chooseQuote, deleteCogsLine, deleteNonUnit, lineValue, patchCbm, patchCogsLine, patchNonUnit,
  patchOverhead, patchProductsSame, setLaborHours, targetLineEach, type Apply, type Bundle, type WorkspaceRow,
} from '@/lib/costing-workspace';
import { CostMixBar, EditCell, GapChip, SelectCell, Thumb, inr, num, parseNum, pct, usd } from './cells';
import { VIEWS, type Col } from './columns';

const colById = (id: string): Col => VIEWS.flatMap(v => v.cols).find(c => c.id === id)!;

export function ProductPanel({ row, bundle, apply, onClose, onPrev, onNext, position, page, onReload }: {
  row: WorkspaceRow; bundle: Bundle; apply: Apply; onClose?: () => void; onPrev?: () => void; onNext?: () => void; position?: string;
  /** Page mode: the product page's Costing tab. No SKU header or navigation; adds product details, chemicals and stacks for phones. */
  page?: boolean;
  /** Reload the bundle after a change made outside it (the chemicals picker). */
  onReload?: () => void;
}) {
  const { p, r } = row;
  const id = p.id;
  const npmNeeded = row.requiredMarkup != null ? row.requiredMarkup / (1 + row.requiredMarkup) : null;
  const over = (row.gapUsd ?? 0) > 0.005;
  const done = (field: string) => ({ checked: !!p[field], onChange: (v: boolean) => apply(b => patchProductsSame(b, [id], { [field]: v })) });
  const cogsReview = bundle.cogs.some(c => c.product_id === id && c.include === 'Review');
  const ohReview = bundle.oh.some(o => o.product_id === id && o.include === 'Review');
  // Highest raw piece price that still meets the target at the current NPM.
  const maxRawInr = row.maxCostInr != null ? row.maxCostInr - (row.costInr - row.buckets.raw_piece) : null;
  const pkg = p.packaging_type || 'ic_mc';
  const cbmRow = row.cbmRow || {};

  return (
    <div className={cn('flex flex-col bg-card', page ? 'rounded-xl border' : 'h-full')}>
      {/* Header */}
      {!page && <div className="flex items-center gap-3 border-b px-4 py-3">
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
      </div>}

      <div className={cn(!page && 'flex-1 overflow-y-auto')}>
        {isPhotoEstimated(p) && <PhotoEstimateNote est={p.photo_estimate} onChecked={() =>
          apply(b => patchProductsSame(b, [id], { photo_estimate: { ...p.photo_estimate, checked_at: new Date().toISOString() } }))} />}

        {/* Price vs target */}
        <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-px border-b bg-border', page && 'rounded-t-xl overflow-hidden')}>
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
        {maxRawInr != null && row.buckets.raw_piece > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm">
            <span className="text-muted-foreground">Max raw piece at target:</span>
            <b className={cn('tabular-nums', maxRawInr >= row.buckets.raw_piece ? 'text-emerald-600' : 'text-destructive')}>{inr(maxRawInr, 2)}</b>
            <span className="text-muted-foreground tabular-nums">({usd(maxRawInr / (r.exchangeRate || 1))}) · headroom {inr(maxRawInr - row.buckets.raw_piece, 2)}</span>
          </div>
        )}

        {page && (
          <Section title="Product details" defaultOpen>
            <ProductDetails row={row} apply={apply} />
          </Section>
        )}

        {/* Waterfall */}
        <Section title="Where the price comes from" defaultOpen done={done('revenue_done')}>
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

        <Section title="Materials & components" count={bundle.cogs.filter(c => c.product_id === id && c.include !== 'No').length} defaultOpen done={done('cogs_done')} review={cogsReview}>
          {page && onReload && (
            <div className="mb-3">
              <ProductChemicalsPicker productId={id} chemicals={bundle.chemicalPrices} cogsItems={bundle.cogs.filter(c => c.product_id === id)} onChanged={onReload} />
            </div>
          )}
          <CogsLines row={row} bundle={bundle} apply={apply} />
        </Section>

        <Section title="Labor & overhead" sub={inr(row.buckets.labor) + '/unit'} defaultOpen={page} done={done('overhead_done')} review={ohReview}>
          <LaborLines row={row} bundle={bundle} apply={apply} />
        </Section>

        <Section title="Packaging & CBM" sub={`${r.finalUnitCbm.toFixed(4)} CBM · ${r.productsPerMc || 1}/MC`} defaultOpen={page} done={done('cbm_done')}>
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
          <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
            {pkg === 'bulk_pack' && <>
              <NumField label="Pieces per box" value={p.bulk_pieces_per_box ?? 1} min={1} int
                onCommit={n => apply(b => patchProductsSame(b, [id], { bulk_pieces_per_box: Math.max(1, n) }))} />
              <NumField label="Height per extra piece %" hint="How much height each additional piece adds, as a % of one piece's height. 100 = no nesting." value={Math.round((p.bulk_shrink_factor ?? 1) * 100)}
                onCommit={n => apply(b => patchProductsSame(b, [id], { bulk_shrink_factor: Math.min(1, Math.max(0, n / 100)) }))} />
            </>}
            <NumField label="MC W/D buffer (in)" value={cbmRow.mc_buffer_inch ?? 1} onCommit={n => apply(b => patchCbm(b, [id], { mc_buffer_inch: n }))} />
            <NumField label="MC H buffer (in)" value={cbmRow.mc_height_buffer_inch ?? bundle.gs?.mc_height_buffer_inch ?? 2.5} onCommit={n => apply(b => patchCbm(b, [id], { mc_height_buffer_inch: n }))} />
            {pkg !== 'bulk_pack' && <NumField label="MC weight limit (kg)" value={cbmRow.mc_weight_limit_kg || 20} onCommit={n => apply(b => patchCbm(b, [id], { mc_weight_limit_kg: n }))} />}
          </div>
          {(pkg === 'ic_mc' || pkg === 'ic_only') && (
            <div className="mt-2.5 flex flex-wrap items-end gap-3">
              <label className="flex h-8 items-center gap-2 text-sm">
                <Checkbox checked={!!cbmRow.mc_manual_layout} onCheckedChange={c => apply(b => patchCbm(b, [id], { mc_manual_layout: !!c }))} />
                Set ICs per MC by hand
              </label>
              {cbmRow.mc_manual_layout && ['w', 'd', 'h'].map(a => (
                <div key={a} className="w-20">
                  <NumField label={`ICs along ${a.toUpperCase()}`} value={cbmRow[`mc_ics_along_${a}`] ?? 1} min={1} int
                    onCommit={n => apply(b => patchCbm(b, [id], { [`mc_ics_along_${a}`]: Math.max(1, n) }))} />
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg bg-muted/50 p-3 text-xs">
            <Mini label="MC size" value={r.mcDims.mc_width ? `${num(r.mcDims.mc_width, 1)}×${num(r.mcDims.mc_depth, 1)}×${num(r.mcDims.mc_height, 1)}"` : '—'} />
            <Mini label="IC cost" value={inr(r.icCost, 1)} />
            <Mini label="MC cost" value={inr(r.mcCost, 1)} />
            <Mini label="Line CBM" value={num(r.finalUnitCbm * row.qty, 2)} />
          </div>
          {r.bulkPack?.warning && <div className="mt-2 text-xs text-amber-600">{r.bulkPack.warning}</div>}
        </Section>

        <Section title="Shipping" sub={inr(r.shippingPerUnit) + '/unit'} defaultOpen={page} done={done('shipping_done')}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Field col={colById('shipping')} row={row} bundle={bundle} apply={apply} />
            <div className="text-sm"><div className="text-xs text-muted-foreground">Per unit</div><div className="h-8 flex items-center tabular-nums font-medium">{inr(r.shippingPerUnit, 2)} · {r.finalUnitCbm.toFixed(4)} CBM</div></div>
          </div>
          {r.fobEstimate && <div className="mt-3"><FobEstimatePanel estimate={r.fobEstimate} shippingPerUnit={r.shippingPerUnit} /></div>}
        </Section>

        <Section title="Product setup" defaultOpen={page}>
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

type Done = { checked: boolean; onChange: (v: boolean) => void };

function Section({ title, sub, count, defaultOpen, done, review, children }: {
  title: string; sub?: string; count?: number; defaultOpen?: boolean; done?: Done; review?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b">
      <div className="flex w-full items-center gap-2 px-4 py-3 hover:bg-muted/40">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(o => !o)}>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          <span className="text-sm font-semibold">{title}</span>
          {count != null && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{count}</span>}
          {review && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Review</span>}
          {sub && <span className="ml-auto truncate text-xs text-muted-foreground tabular-nums">{sub}</span>}
        </button>
        {done && (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={done.checked} onCheckedChange={c => done.onChange(!!c)} aria-label={`${title} done`} />
            Done
          </label>
        )}
      </div>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function NumField({ label, value, onCommit, min = 0, int, hint }: {
  label: string; value: number | null | undefined; onCommit: (n: number) => void; min?: number; int?: boolean; hint?: string;
}) {
  return (
    <label className="block min-w-0" title={hint}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-0.5">
        <EditCell className="border-border" align="left" value={value ?? ''}
          onCommit={raw => { const n = parseNum(raw); if (n != null && n >= min) onCommit(int ? Math.round(n) : n); }} />
      </div>
    </label>
  );
}

/** Page mode only: photo, MOQs and the note printed under the product on quotes. */
function ProductDetails({ row, apply }: { row: WorkspaceRow; apply: Apply }) {
  const { p } = row;
  const id = p.id;
  const set = (patch: Record<string, any>) => apply(b => patchProductsSame(b, [id], patch));
  const [notes, setNotes] = useState<string | null>(null);
  const upload = async (file: File) => {
    const path = `${id}.${file.name.split('.').pop() || 'jpg'}`;
    const { error } = await supabase.storage.from('product-photos').upload(path, file, { contentType: file.type, upsert: true });
    if (error) { toast.error('Upload failed: ' + error.message); return; }
    const { data } = supabase.storage.from('product-photos').getPublicUrl(path);
    // A new query string makes the browser fetch the replaced image.
    set({ photo_url: `${data.publicUrl}?v=${Date.now()}` });
    toast.success('Photo uploaded');
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="group relative h-20 w-20 shrink-0">
        {p.photo_url ? (
          <>
            <img src={p.photo_url} alt={p.name} className="h-20 w-20 rounded-md border object-cover" />
            <button onClick={() => set({ photo_url: null })} aria-label="Remove photo"
              className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed hover:border-primary/50">
            <Camera className="h-5 w-5 text-muted-foreground" />
            <span className="mt-0.5 text-[10px] text-muted-foreground">Add photo</span>
            <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </label>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <NumField label="MOQ" value={p.moq ?? 50} int onCommit={n => set({ moq: n })} />
          <label className="block min-w-0" title="Absolute floor: the customer cannot order less. Between hard MOQ and MOQ the below-MOQ surcharge applies.">
            <span className="text-xs text-muted-foreground">Hard MOQ</span>
            <div className="mt-0.5">
              <EditCell className="border-border" align="left" value={p.hard_moq ?? ''} placeholder={String(p.moq ?? 50)}
                onCommit={raw => { if (raw.trim() === '') { set({ hard_moq: null }); return; } const n = parseNum(raw); if (n != null && n >= 0) set({ hard_moq: Math.round(n) }); }} />
            </div>
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-muted-foreground">Quote notes (shown to the customer)</span>
          <Textarea className="mt-0.5 min-h-[60px] text-sm" rows={2} placeholder="Notes that appear on the customer quote under the product name…"
            value={notes ?? p.quote_notes ?? ''} onChange={e => setNotes(e.target.value)}
            onBlur={() => { if (notes != null && notes !== (p.quote_notes ?? '')) set({ quote_notes: notes || null }); setNotes(null); }} />
        </label>
      </div>
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
          <SelectCell className="border-border" value={String(v ?? '')} options={e.options?.(bundle) ?? []} disabled={!!e.disabled?.(row, bundle)} onChange={val => apply(b => e.write(b, [row.p.id], val))} />
        ) : (
          <EditCell className="border-border" kind={e.kind === 'number' ? 'number' : 'text'} align="left" value={v as any} display={e.display?.(row)}
            disabled={e.disabled?.(row, bundle) ?? null}
            onCommit={raw => apply(b => e.write(b, [row.p.id], raw))} />
        )}
      </div>
    </label>
  );
}

/** Include toggle for a line: on / off, with "Review" (flagged for a second look) shown as its own chip. */
function IncludeToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  if (value === 'Review') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={() => onChange('Yes')} className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">?</button>
        </TooltipTrigger>
        <TooltipContent>Marked for review. Click to include it.</TooltipContent>
      </Tooltip>
    );
  }
  return <Checkbox checked={value !== 'No'} onCheckedChange={c => onChange(c ? 'Yes' : 'No')} aria-label="Include" />;
}

const AUTO_TIP = 'Calculated by the costing engine. Typing a value makes it a manual line; Recalculate auto costs hands it back.';

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
  const hardware = bundle.hardwarePrices || [];

  const save = (lineId: string, patch: Record<string, any>) => apply(b => patchCogsLine(b, lineId, patch));
  // Editing an engine-managed line takes it over: keep the engine's other value and stop recalculating it.
  const numSave = (l: any, field: string, scale = 1) => (raw: string) => {
    const n = parseNum(raw); if (n == null || n < 0) return;
    const takeover = l.is_auto_calculated && field !== 'waste_factor'
      ? { is_auto_calculated: false, components_per_product: +l.components_per_product || 0, unit_cost_inr: +l.unit_cost_inr || 0 } : {};
    save(l.id, { ...takeover, [field]: n / scale });
  };
  const pickHardware = (lineId: string, name: string) => {
    const hw = hardware.find((h: any) => h.name === name);
    save(lineId, hw ? { component_name: hw.name, unit_cost_inr: Number(hw.unit_cost_inr) || 0, units: hw.units || 'pc' } : { component_name: name });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <colgroup><col style={{ width: 28 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 64 }} /><col style={{ width: 40 }} /><col style={{ width: 84 }} /><col style={{ width: 56 }} /><col style={{ width: 76 }} /><col style={{ width: 48 }} /></colgroup>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:pb-1 [&>th]:font-medium">
              <th /><th className="text-left">Item</th><th className="text-left">Vendor</th><th className="text-right">Qty</th><th className="text-left pl-1">Unit</th><th className="text-right">₹ each</th><th className="text-right">Waste</th><th className="text-right">₹ / unit</th><th />
            </tr>
          </thead>
          {types.map(t => (
            <tbody key={t}>
              <tr><td colSpan={9} className="pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">{t}{t === 'Raw Piece' && rawSlots.length > 1 ? ' — pick one quote' : ''}</td></tr>
              {visible.filter(l => l.cogs_type === t).map(l => {
                const auto = !!l.is_auto_calculated;
                const off = l.include === 'No';
                const hw = isHardwareCogsType(t) && !auto && hardware.length > 0;
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
                        <IncludeToggle value={l.include} onChange={v => save(l.id, { include: v })} />
                      )}
                    </td>
                    <td className="min-w-0">
                      <div className="flex items-center gap-1 min-w-0">
                        <EditCell kind="text" align="left" value={l.component_name ?? ''} className="min-w-0" onCommit={raw => save(l.id, { component_name: raw.trim() || t })} />
                        {hw && (
                          <select className="h-7 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent text-xs text-muted-foreground hover:bg-muted" value=""
                            onChange={e => e.target.value && pickHardware(l.id, e.target.value)} aria-label="Pick from hardware price list" title="Pick from the hardware price list">
                            <option value="" />
                            {hardware.map((h: any) => <option key={h.id} value={h.name}>{h.name} — {inr(Number(h.unit_cost_inr) || 0)}/{h.units || 'pc'}</option>)}
                          </select>
                        )}
                        {auto && <Tooltip><TooltipTrigger asChild><span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">AUTO</span></TooltipTrigger><TooltipContent className="max-w-xs">{AUTO_TIP}</TooltipContent></Tooltip>}
                      </div>
                    </td>
                    <td><VendorCombobox className="h-8 w-full border-transparent text-sm hover:border-border" placeholder="—" value={l.vendor_name ?? ''} onChange={v => save(l.id, { vendor_name: v.trim() || null })} /></td>
                    <td><EditCell value={+(+l.components_per_product || 0).toFixed(4)} title={auto ? AUTO_TIP : undefined} onCommit={numSave(l, 'components_per_product')} /></td>
                    <td><EditCell kind="text" align="left" placeholder="pc" value={l.units ?? ''} onCommit={raw => save(l.id, { units: raw.trim() || null })} /></td>
                    <td><EditCell value={+(+l.unit_cost_inr || 0).toFixed(2)} display={inr(+l.unit_cost_inr || 0, 2)} title={auto ? AUTO_TIP : undefined} onCommit={numSave(l, 'unit_cost_inr')} /></td>
                    <td><EditCell value={Math.round((+l.waste_factor || 0) * 1000) / 10} display={l.waste_factor ? `${Math.round(+l.waste_factor * 1000) / 10}%` : ''} onCommit={numSave(l, 'waste_factor', 100)} /></td>
                    <td className="text-right tabular-nums pr-1 font-medium">{off ? '—' : inr(lineValue(l), 2)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        {!auto && row.targetUsd != null && (() => {
                          const each = targetLineEach(row, l);
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="text-muted-foreground/50 hover:text-primary disabled:opacity-30" disabled={each == null}
                                  onClick={() => each != null && save(l.id, { unit_cost_inr: Math.round(each * 100) / 100 })} aria-label="Target this line">
                                  <Target className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{each != null ? `Set ₹ each to ${inr(each, 2)} so the price lands on the ${usd(row.targetUsd)} target` : 'This line alone can’t reach the target'}</TooltipContent>
                            </Tooltip>
                          );
                        })()}
                        {!auto && (
                          <button className="text-muted-foreground/50 hover:text-destructive" onClick={() => apply(b => deleteCogsLine(b, l.id))} aria-label="Delete line"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
  const canAuto = (t: string) => t === 'Finishing' || t === 'Packaging';
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] table-fixed text-sm">
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
              const shown = o.is_auto_estimated && o.labor_type === 'Finishing' ? row.r.autoLabor?.finishingMh ?? o.man_hours_per_unit
                : o.is_auto_estimated && o.labor_type === 'Packaging' ? row.r.autoLabor?.packagingMh ?? o.man_hours_per_unit : o.man_hours_per_unit;
              return (
                <tr key={o.id} className={cn('[&>td]:py-0.5', off && 'opacity-50')}>
                  <td><IncludeToggle value={o.include} onChange={v => apply(b => patchOverhead(b, o.id, { include: v }))} /></td>
                  <td>
                    <span className="pl-2">{o.labor_type}</span>
                    {o.is_auto_estimated && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">AUTO</span>}
                    {!o.is_auto_estimated && canAuto(o.labor_type) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="ml-1 align-middle text-muted-foreground/60 hover:text-foreground" aria-label="Estimate automatically"
                            onClick={() => apply(b => setLaborHours(b, [id], o.labor_type, 'auto'))}><RotateCcw className="h-3 w-3" /></button>
                        </TooltipTrigger>
                        <TooltipContent>Go back to the automatic estimate</TooltipContent>
                      </Tooltip>
                    )}
                  </td>
                  <td>
                    <EditCell value={+(+shown || 0).toFixed(3)} title={o.is_auto_estimated ? 'Estimated from size and finish difficulty. Typing a value overrides it.' : undefined}
                      onCommit={raw => { const n = parseNum(raw); if (n != null && n >= 0) apply(b => patchOverhead(b, o.id, { man_hours_per_unit: n, is_auto_estimated: false })); }} />
                  </td>
                  <td className="text-right tabular-nums text-muted-foreground pr-2">{inr(rate)}</td>
                  <td className="text-right tabular-nums pr-1">{off ? '—' : inr((+shown || 0) * rate, 2)}</td>
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
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold text-muted-foreground">Order-level costs (spread over {row.qty.toLocaleString()} pcs)</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] table-fixed text-sm">
            <colgroup><col style={{ width: 28 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 84 }} /><col style={{ width: 84 }} /><col style={{ width: 28 }} /></colgroup>
            <tbody>
              {nu.map(n => {
                const off = n.include === 'No';
                const isTransport = n.name === 'Auto Transport';
                const autoT = isTransport && !n.manual_override;
                return (
                  <tr key={n.id} className={cn('[&>td]:py-0.5', off && 'opacity-50')}>
                    <td><IncludeToggle value={n.include} onChange={v => apply(b => patchNonUnit(b, n.id, { include: v }))} /></td>
                    <td className="min-w-0">
                      {isTransport ? (
                        <span className="pl-2 truncate">{n.name}{autoT && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">AUTO</span>}</span>
                      ) : (
                        <EditCell kind="text" align="left" value={n.name ?? ''} onCommit={raw => apply(b => patchNonUnit(b, n.id, { name: raw.trim() || 'Item' }))} />
                      )}
                    </td>
                    <td><EditCell value={+(+n.total_quantity || 0).toFixed(3)} disabled={autoT ? 'Packed CBM × quantity' : null}
                      onCommit={raw => { const v = parseNum(raw); if (v != null && v >= 0) apply(b => patchNonUnit(b, n.id, { total_quantity: v })); }} /></td>
                    <td><EditCell value={+n.cost_each_inr || 0} display={inr(+n.cost_each_inr || 0)} disabled={autoT ? 'Auto transport rate from Settings' : null}
                      onCommit={raw => { const v = parseNum(raw); if (v != null && v >= 0) apply(b => patchNonUnit(b, n.id, { cost_each_inr: v })); }} /></td>
                    <td className="text-right tabular-nums pr-1">{off || !row.qty ? '—' : inr(((+n.total_quantity || 0) * (+n.cost_each_inr || 0)) / row.qty, 2)}</td>
                    <td>
                      {!isTransport && (
                        <button className="text-muted-foreground/50 hover:text-destructive" onClick={() => apply(b => deleteNonUnit(b, n.id))} aria-label="Delete cost"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="outline" className="mt-2 h-8 gap-1" onClick={() => apply(b => addNonUnit(b, id))}>
          <Plus className="h-3.5 w-3.5" /> Add order-level cost
        </Button>
      </div>
    </div>
  );
}
