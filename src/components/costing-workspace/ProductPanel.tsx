// One SKU's full costing in costing-sheet order: 1. COGS (where it comes from and every
// material line), 2. Labour (what sets the hours, then the hours), 3. Shipping (packing,
// CBM, freight), 4. Margin (unit cost, NPM, price vs target with a solver), all editable
// in place. Used as the drill-in panel of the Costing Workspace and, in page
// mode, as the product page's Costing tab (with product details, chemicals and vendors).
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Copy, ExternalLink, Plus, RotateCcw, Sparkles, Target, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FobEstimatePanel } from '@/components/FobEstimatePanel';
import { ProductChemicalsPicker } from '@/components/ProductChemicalsPicker';
import { VendorCombobox } from '@/components/VendorCombobox';
import { supabase } from '@/integrations/supabase/client';
import { shrinkImageForUpload } from '@/lib/image-resize';
import { avgRateByDesignation, npmToMarkup } from '@/lib/calculations';
import { applyLiveRates, withLiveDirectRates } from '@/lib/live-rates';
import { COGS_CATEGORY_FALLBACK, isHardwareCogsType, useCogsCategories } from '@/lib/cogs-categories';
import { cn } from '@/lib/utils';
import { isPhotoEstimated, type PhotoEstimateRecord } from '@/lib/photo-intake';
import {
  BUCKETS, addCogsLine, addNonUnit, deleteCogsLine, deleteNonUnit, lineValue, patchCbm, patchCogsLine, patchNonUnit,
  patchOverhead, patchProductsSame, setLaborHours, targetLineEach, type Apply, type Bundle, type WorkspaceRow,
  isDomesticFreight, pasteCogsLines, stepTotals,
} from '@/lib/costing-workspace';
import { EditCell, GapChip, SelectCell, Thumb, inr, num, parseNum, money, pct, usd } from './cells';
import { ALL_COLS, BANDS, type Col, type StepId } from './columns';
import { McPlanBreakdown } from './McPlan';
import { copyLines, useCopiedLines } from './line-clipboard';

const colById = (id: string): Col => ALL_COLS.find(c => c.id === id)!;
const band = (id: StepId) => BANDS.find(b => b.id === id)!;

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
  const over = (row.gap ?? 0) > 0.005;
  const isInr = row.cur === 'INR';
  const done = (field: string) => ({ checked: !!p[field], onChange: (v: boolean) => apply(b => patchProductsSame(b, [id], { [field]: v })) });
  const cogsReview = bundle.cogs.filter(c => c.product_id === id && c.include === 'Review').length;
  const ohReview = [...bundle.oh, ...bundle.nu].filter(o => o.product_id === id && o.include === 'Review').length;
  // Highest raw piece price that still meets the target at the current NPM.
  const maxRawInr = row.maxCostInr != null ? row.maxCostInr - (row.costInr - row.buckets.raw_piece) : null;
  const pkg = p.packaging_type || 'ic_mc';
  const steps = stepTotals(row);

  return (
    <div className={cn('flex flex-col bg-card', page ? 'rounded-lg border border-border/70 shadow-sm' : 'h-full')}>
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

        <QuantityBar row={row} bundle={bundle} apply={apply} />

        <FlowStrip row={row} />

        {page && (
          <Section title="Product details" defaultOpen>
            <ProductDetails row={row} apply={apply} />
          </Section>
        )}

        <Section step="cogs" sub={inr(steps.cogs) + '/unit'} count={bundle.cogs.filter(c => c.product_id === id && c.include !== 'No' && !isDomesticFreight(c)).length} defaultOpen done={done('cogs_done')} review={cogsReview}>
          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
            {['source', 'outsourced'].map(cid => <Field key={cid} col={colById(cid)} row={row} bundle={bundle} apply={apply} />)}
          </div>
          {page && onReload && (
            <div className="mb-3">
              <ProductChemicalsPicker productId={id} chemicals={bundle.chemicalPrices} cogsItems={bundle.cogs.filter(c => c.product_id === id)} onChanged={onReload} />
            </div>
          )}
          <CogsLines row={row} bundle={bundle} apply={apply} show={l => !isDomesticFreight(l)} />
        </Section>

        <Section step="labour" sub={`${num(r.manHoursPerUnit, 2)} MH · ${inr(steps.labour)}/unit`} defaultOpen={page} done={done('overhead_done')} review={ohReview}>
          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
            {['ptype', 'difficulty', 'wood', 'ri'].map(cid => <Field key={cid} col={colById(cid)} row={row} bundle={bundle} apply={apply} />)}
          </div>
          <LaborLines row={row} bundle={bundle} apply={apply} />
        </Section>

        <Section step="shipping" sub={`${r.finalUnitCbm.toFixed(4)} CBM${pkg === 'ic_mc' || pkg === 'bulk_pack' ? ` · ${r.productsPerMc || 1}/MC` : ''} · ${inr(steps.shipping)}/unit`} defaultOpen={page}
          done={{ checked: !!p.cbm_done && !!p.shipping_done, onChange: v => apply(b => patchProductsSame(b, [id], { cbm_done: v, shipping_done: v })) }}>
          <SubHead>Packing and CBM</SubHead>
          <PackagingFields row={row} bundle={bundle} apply={apply} />
          <SubHead className="mt-4">Freight</SubHead>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Field col={colById('shipping')} row={row} bundle={bundle} apply={apply} />
            <div className="text-sm"><div className="text-xs text-muted-foreground">Per unit</div><div className="h-8 flex items-center tabular-nums font-medium">{inr(r.shippingPerUnit, 2)} · {r.finalUnitCbm.toFixed(4)} CBM</div></div>
          </div>
          {r.fobEstimate && <div className="mt-3"><FobEstimatePanel estimate={r.fobEstimate} shippingPerUnit={r.shippingPerUnit} /></div>}
          {bundle.cogs.some(c => c.product_id === id && isDomesticFreight(c)) && (
            <div className="mt-3"><CogsLines row={row} bundle={bundle} apply={apply} show={isDomesticFreight} fixed /></div>
          )}
        </Section>

        <Section step="margin" sub={`${pct(row.margin)} NPM · ${money(row.price, row.cur)}`} defaultOpen done={done('revenue_done')}>
          <div className="-mx-4 grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-4">
            <Figure label="Unit cost" value={inr(row.costInr)} sub={isInr ? 'per unit' : usd(row.cost)} />
            <Figure label="NPM" sub={`markup ${pct(row.markup)}`}>
              <PanelInput col={colById('npm')} row={row} bundle={bundle} apply={apply} big />
            </Figure>
            <Figure label="Price" value={<span className="text-primary">{money(row.price, row.cur)}</span>} sub={isInr ? `markup on ${inr(row.costInr)}` : inr(row.priceInr)} />
            <Figure label="Target" sub={<GapChip row={row} />}>
              <PanelInput col={colById('target')} row={row} bundle={bundle} apply={apply} big placeholder="none" />
            </Figure>
          </div>
          {over && (
            <div className="-mx-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-destructive/[0.04] px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">To hit {money(row.target, row.cur)}:</span>
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
            <div className="-mx-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm">
              <span className="text-muted-foreground">Max raw piece at target:</span>
              <b className={cn('tabular-nums', maxRawInr >= row.buckets.raw_piece ? 'text-success' : 'text-destructive')}>{inr(maxRawInr, 2)}</b>
              <span className="text-muted-foreground tabular-nums">{isInr ? '' : `(${usd(maxRawInr / (r.exchangeRate || 1))}) · `}headroom {inr(maxRawInr - row.buckets.raw_piece, 2)}</span>
            </div>
          )}

          <table className="mt-3 w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-muted-foreground [&>th]:pb-1 [&>th]:font-medium">
                <th className="text-left">Per unit</th><th className="text-right">₹</th><th className="text-right">of price</th>
              </tr>
            </thead>
            <tbody className="[&>tr>td]:py-1">
              {([['cogs', steps.cogs], ['labour', steps.labour], ['shipping', steps.shipping]] as const).map(([k, v]) => (
                <tr key={k}>
                  <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: band(k).color }} />{band(k).n}. {band(k).label}</td>
                  <td className="text-right">{inr(v, 2)}</td>
                  <td className="w-20 text-right text-muted-foreground">{pct(v / (row.priceInr || 1))}</td>
                </tr>
              ))}
              {steps.capital > 0 && (
                <tr><td className="pl-[18px]">Cost of capital</td><td className="text-right">{inr(steps.capital, 2)}</td><td className="text-right text-muted-foreground">{pct(steps.capital / (row.priceInr || 1))}</td></tr>
              )}
              <tr className="border-t font-medium"><td className="pt-2">Unit cost</td><td className="pt-2 text-right">{inr(row.costInr, 2)}</td><td className="pt-2 text-right text-muted-foreground">{pct(row.costInr / (row.priceInr || 1))}</td></tr>
              <tr className="text-primary"><td>Margin ({pct(row.margin)} NPM)</td><td className="text-right">{inr(row.priceInr - row.costInr, 2)}</td><td className="text-right">{pct(row.margin)}</td></tr>
              <tr className="border-t font-semibold"><td className="pt-2">Price</td><td className="pt-2 text-right">{inr(row.priceInr, 2)}</td><td className="pt-2 text-right">{isInr ? '' : usd(row.price)}</td></tr>
            </tbody>
          </table>
          <div className="mt-2 text-xs text-muted-foreground">{isInr ? 'Quoted in rupees' : `₹${num(r.exchangeRate, 2)} / $`} · contribution {pct(row.contribution)}</div>

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
      <div className="text-xs text-muted-foreground">{label}</div>
      {children ?? <div className="text-lg font-semibold tabular-nums leading-tight mt-0.5 h-9 flex items-center">{value}</div>}
      <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">{sub}</div>
    </div>
  );
}

/**
 * Packaging & CBM: what the packing comes to first (CBM, cartons, costs), then the inputs grouped
 * by what they describe (piece, inner carton, master carton or bulk box). Only the groups the
 * chosen packaging uses are shown, and each input has its label on the left and its unit on the right.
 */
function PackagingFields({ row, bundle, apply }: { row: WorkspaceRow; bundle: Bundle; apply: Apply }) {
  const { p, r } = row;
  const id = p.id;
  const pkg = p.packaging_type || 'ic_mc';
  const cbmRow = row.cbmRow || {};
  const hasIc = pkg === 'ic_mc' || pkg === 'ic_only';
  const hasMc = pkg === 'ic_mc' || pkg === 'bulk_pack';
  const field = (cid: string) => <Field col={colById(cid)} row={row} bundle={bundle} apply={apply} bare />;
  const dims = (prefix: string) => (
    <div className="grid grid-cols-3 gap-2">
      {['w', 'd', 'h'].map(a => <Field key={a} col={colById(`${prefix}_${a}`)} row={row} bundle={bundle} apply={apply} inline />)}
    </div>
  );
  // A single input lined up with the W column of the size rows above and below it.
  const one = (child: React.ReactNode, unit?: string, wide?: boolean) => (
    <div className="grid grid-cols-3 gap-2">
      <div className={cn('flex min-w-0 items-center gap-1.5', wide && 'col-span-2 sm:col-span-1')}><span className="w-3 shrink-0" /><div className="min-w-0 flex-1">{child}</div></div>
      {unit && <div className="flex items-center text-xs text-muted-foreground">{unit}</div>}
    </div>
  );
  const mcSize = r.mcDims.mc_width ? `${num(r.mcDims.mc_width, 1)} × ${num(r.mcDims.mc_depth, 1)} × ${num(r.mcDims.mc_height, 1)} in` : null;
  const cartons = hasMc && r.productsPerMc > 0 && row.qty > 0 ? Math.ceil(row.qty / r.productsPerMc) : null;

  return (
    <div className="space-y-3">
      {/* What it comes to */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-4">
        <PkgStat label="Packed CBM per piece" value={`${r.finalUnitCbm.toFixed(4)} m³`} />
        <PkgStat label="Line CBM" value={`${num(r.finalUnitCbm * row.qty, 2)} m³`} note={`for ${row.qty.toLocaleString()} pcs`} />
        <PkgStat label="Inner carton cost" value={hasIc ? `${inr(r.icCost, 1)} each` : 'Not used'} muted={!hasIc}
          note={hasIc && (cbmRow.products_per_ic || 1) > 1 ? `${cbmRow.products_per_ic} pcs per carton` : undefined} />
        <PkgStat label={pkg === 'bulk_pack' ? 'Bulk box cost' : 'Master carton cost'} value={hasMc ? `${inr(r.mcCost, 1)} each` : 'Not used'} muted={!hasMc}
          note={hasMc ? `${r.productsPerMc || 1} pcs per carton${cartons ? ` · ${cartons.toLocaleString()} cartons` : ''}` : undefined} />
      </div>

      <div className="px-3"><PkgRow label="Packaging">{one(field('pkg_type'), undefined, true)}</PkgRow></div>

      <PkgGroup title="Piece">
        <PkgRow label="Size" unit="in">{dims('piece')}</PkgRow>
        <PkgRow label="Weight">{one(field('weight'), 'kg')}</PkgRow>
      </PkgGroup>

      {hasIc && (
        <PkgGroup title="Inner carton" note="Size is the inside; it follows the piece size unless typed.">
          <PkgRow label="Inside size" unit="in">{dims('ic')}</PkgRow>
          <PkgRow label="Board">{one(field('ic_type'), undefined, true)}</PkgRow>
          <PkgRow label="Pieces per carton">{one(field('per_ic'))}</PkgRow>
        </PkgGroup>
      )}

      {hasMc && (
        <PkgGroup title={pkg === 'bulk_pack' ? 'Bulk box' : 'Master carton'} note={mcSize ? `Comes to ${mcSize} inside` : undefined}>
          {pkg === 'bulk_pack' && <>
            <PkgRow label="Pieces per box">
              {one(<NumField value={p.bulk_pieces_per_box ?? 1} min={1} int
                onCommit={n => apply(b => patchProductsSame(b, [id], { bulk_pieces_per_box: Math.max(1, n) }))} />)}
            </PkgRow>
            <PkgRow label="Height per extra piece" hint="How much height each additional piece adds, as a % of one piece's height. 100 = no nesting.">
              {one(<NumField value={Math.round((p.bulk_shrink_factor ?? 1) * 100)}
                onCommit={n => apply(b => patchProductsSame(b, [id], { bulk_shrink_factor: Math.min(1, Math.max(0, n / 100)) }))} />, '%')}
            </PkgRow>
          </>}
          <PkgRow label="Largest allowed" unit="in" hint={colById('mc_w').hint}>{dims('mc')}</PkgRow>
          <PkgRow label="Board">{one(field('mc_type'), undefined, true)}</PkgRow>
          <PkgRow label="Side buffer" hint="Space left inside the carton around the sides (W and D).">
            {one(<NumField value={cbmRow.mc_buffer_inch ?? 1} onCommit={n => apply(b => patchCbm(b, [id], { mc_buffer_inch: n }))} />, 'in')}
          </PkgRow>
          <PkgRow label="Top buffer" hint="Space left inside the carton above the contents (H).">
            {one(<NumField value={cbmRow.mc_height_buffer_inch ?? bundle.gs?.mc_height_buffer_inch ?? 2.5} onCommit={n => apply(b => patchCbm(b, [id], { mc_height_buffer_inch: n }))} />, 'in')}
          </PkgRow>
          <PkgRow label="Weight limit">
            {one(<NumField value={cbmRow.mc_weight_limit_kg || 20} onCommit={n => apply(b => patchCbm(b, [id], { mc_weight_limit_kg: n }))} />, 'kg')}
          </PkgRow>
          {pkg === 'ic_mc' && <>
            <PkgRow label="Inner cartons per MC">
              <div className="flex flex-wrap items-center gap-3 pl-[18px]">
                <label className="flex h-8 items-center gap-2 text-sm">
                  <Checkbox checked={!!cbmRow.mc_manual_layout} onCheckedChange={c => apply(b => patchCbm(b, [id], { mc_manual_layout: !!c }))} />
                  Set by hand
                </label>
                {cbmRow.mc_manual_layout && ['w', 'd', 'h'].map(a => (
                  <div key={a} className="w-20">
                    <NumField prefix={a.toUpperCase()} value={cbmRow[`mc_ics_along_${a}`] ?? 1} min={1} int
                      onCommit={n => apply(b => patchCbm(b, [id], { [`mc_ics_along_${a}`]: Math.max(1, n) }))} />
                  </div>
                ))}
              </div>
            </PkgRow>
            {r.mcPlan && (
              <PkgRow label="Pieces per MC" hint={colById('per_mc').hint}>
                <div className="flex flex-wrap items-center gap-2 pl-[18px]">
                  <div className="w-28">{field('per_mc')}</div>
                  {r.mcPlan.override != null && (
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => apply(b => patchCbm(b, [id], { products_per_mc_override: null }))}>
                      <RotateCcw className="h-3.5 w-3.5" /> Use calculated ({r.mcPlan.autoPieces})
                    </Button>
                  )}
                </div>
              </PkgRow>
            )}
            {r.mcPlan && (
              <div className="rounded-md border border-dashed px-3 py-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">How the master carton is filled</div>
                <McPlanBreakdown plan={r.mcPlan} className="text-muted-foreground" />
              </div>
            )}
          </>}
          {r.bulkPack?.warning && <div className="text-xs text-warning">{r.bulkPack.warning}</div>}
        </PkgGroup>
      )}
    </div>
  );
}

function PkgStat({ label, value, note, muted }: { label: string; value: string; note?: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-base font-semibold tabular-nums', muted && 'font-normal text-muted-foreground')}>{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function PkgGroup({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <div className="text-sm font-semibold">{title}</div>
        {note && <div className="text-xs text-muted-foreground">{note}</div>}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

/** One labelled input line: label on the left, input in the middle, unit on the right (stacks on phones). */
function PkgRow({ label, unit, hint, children }: { label: string; unit?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_2rem] items-center gap-x-2 gap-y-1 sm:grid-cols-[9.5rem_1fr_2rem]">
      <div className="col-span-2 text-sm text-foreground sm:col-span-1" title={hint}>{label}</div>
      <div className="min-w-0">{children}</div>
      <div className="text-xs text-muted-foreground">{unit}</div>
    </div>
  );
}

/** What the photo estimate assumed, until someone has checked the draft numbers. */
function PhotoEstimateNote({ est, onChecked }: { est: PhotoEstimateRecord; onChecked: () => void }) {
  const [more, setMore] = useState(false);
  const assumptions = est.assumptions ?? [];
  return (
    <div className="border-b bg-highlight/[0.05] px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-highlight" />
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

/** One costing step as the panel shows it: the four steps run 1. COGS → 4. Margin, like the grid. */
function FlowStrip({ row }: { row: WorkspaceRow }) {
  const s = stepTotals(row);
  const part = (k: StepId, v: number) => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: band(k).color }} />
      <span className="text-muted-foreground">{band(k).label}</span>
      <b className="font-medium tabular-nums">{inr(s[k as 'cogs' | 'labour' | 'shipping'])}</b>
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-4 py-2.5 text-sm">
      {part('cogs', s.cogs)}<span className="text-muted-foreground">+</span>
      {part('labour', s.labour)}<span className="text-muted-foreground">+</span>
      {part('shipping', s.shipping)}
      {s.capital > 0 && <><span className="text-muted-foreground">+</span><span className="whitespace-nowrap"><span className="text-muted-foreground">capital </span><b className="font-medium tabular-nums">{inr(s.capital)}</b></span></>}
      <span className="text-muted-foreground">=</span>
      <span className="whitespace-nowrap"><span className="text-muted-foreground">cost </span><b className="tabular-nums">{inr(s.cost)}</b></span>
      <span className="text-muted-foreground">→</span>
      <span className="whitespace-nowrap"><b className="tabular-nums text-primary">{money(row.price, row.cur)}</b><span className="text-muted-foreground"> at {pct(row.margin)} NPM</span></span>
      <span className="ml-auto"><GapChip row={row} /></span>
    </div>
  );
}

function SubHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-2 text-xs font-medium text-muted-foreground', className)}>{children}</div>;
}

function Section({ title: titleProp, step, sub, count, defaultOpen, done, review, children }: {
  title?: string; step?: StepId; sub?: string; count?: number; defaultOpen?: boolean; done?: Done;
  /** Lines in this section flagged for review; the badge opens the section and jumps to the first one. */
  review?: number; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const st = step ? band(step) : null;
  const title = st ? `${st.n}. ${st.label}` : titleProp ?? '';
  const jumpToReview = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    setOpen(true);
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-review]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('animate-pulse');
      setTimeout(() => el.classList.remove('animate-pulse'), 1600);
    });
  };
  return (
    <div className="border-b" ref={ref} style={st ? { borderLeft: `3px solid ${st.color}` } : undefined}>
      <div className="flex w-full items-center gap-2 px-4 py-3 hover:bg-muted/40">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(o => !o)}>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          <span className="text-sm font-semibold">{title}</span>
          {count != null && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{count}</span>}
          {!!review && (
            <span role="button" tabIndex={0} onClick={jumpToReview} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && jumpToReview(e)}
              title="Show the lines flagged for review"
              className="rounded bg-warning/15 px-1.5 text-[10px] font-medium text-warning hover:bg-warning/25">
              {review} to review
            </span>
          )}
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

function NumField({ label, prefix, value, onCommit, min = 0, int, hint }: {
  label?: string; prefix?: string; value: number | null | undefined; onCommit: (n: number) => void; min?: number; int?: boolean; hint?: string;
}) {
  const input = (
    <EditCell className="border-border" align="left" value={value ?? ''}
      onCommit={raw => { const n = parseNum(raw); if (n != null && n >= min) onCommit(int ? Math.round(n) : n); }} />
  );
  if (prefix) return (
    <label className="flex min-w-0 items-center gap-1.5" title={hint}>
      <span className="shrink-0 text-xs text-muted-foreground">{prefix}</span>
      <div className="min-w-0 flex-1">{input}</div>
    </label>
  );
  return (
    <label className="block min-w-0" title={hint}>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <div className={cn(label && 'mt-0.5')}>{input}</div>
    </label>
  );
}

/** Order quantity and MOQs, first thing in the panel: they drive shipping pooling and the MOQ shown on the quote. */
function QuantityBar({ row, bundle, apply }: { row: WorkspaceRow; bundle: Bundle; apply: Apply }) {
  const { p } = row;
  const set = (patch: Record<string, any>) => apply(b => patchProductsSame(b, [p.id], patch));
  return (
    <div className="grid grid-cols-3 gap-x-4 border-b px-4 py-2.5">
      <Field col={colById('qty')} row={row} bundle={bundle} apply={apply} />
      <NumField label="MOQ" value={p.moq ?? 50} int onCommit={n => set({ moq: n })} />
      <label className="block min-w-0" title="Absolute floor: the customer cannot order less. Between hard MOQ and MOQ the order is allowed at the quoted price.">
        <span className="text-xs text-muted-foreground">Hard MOQ</span>
        <div className="mt-0.5">
          <EditCell className="border-border" align="left" value={p.hard_moq ?? ''} placeholder={String(p.moq ?? 50)}
            onCommit={raw => { if (raw.trim() === '') { set({ hard_moq: null }); return; } const n = parseNum(raw); if (n != null && n >= 0) set({ hard_moq: Math.round(n) }); }} />
        </div>
      </label>
    </div>
  );
}

/** Page mode only: photo and the note printed under the product on quotes. */
function ProductDetails({ row, apply }: { row: WorkspaceRow; apply: Apply }) {
  const { p } = row;
  const id = p.id;
  const set = (patch: Record<string, any>) => apply(b => patchProductsSame(b, [id], patch));
  const [notes, setNotes] = useState<string | null>(null);
  const upload = async (file: File) => {
    const img = await shrinkImageForUpload(file);
    const path = `${id}.${img.ext}`;
    const { error } = await supabase.storage.from('product-photos').upload(path, img.blob, { contentType: img.contentType, upsert: true });
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
            <span className="mt-0.5 text-xs text-muted-foreground">Add photo</span>
            <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </label>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
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
      className={cn('-ml-2 border-border/60', big && 'h-9 mt-0.5 text-lg font-semibold')}
      onCommit={raw => apply(b => e.write(b, [row.p.id], raw))}
    />
  );
}

function Field({ col, row, bundle, apply, inline, bare }: {
  col: Col; row: WorkspaceRow; bundle: Bundle; apply: Apply; inline?: boolean;
  /** Input only: the label is shown beside it by the caller. */
  bare?: boolean;
}) {
  const e = col.edit!;
  const v = e.get(row);
  return (
    <label className={cn('min-w-0', inline ? 'flex items-center gap-1.5' : 'block')}>
      {!bare && <span className={cn('text-xs text-muted-foreground', inline && 'w-3 shrink-0')}>{inline ? col.label.replace('"', '') : col.label}</span>}
      <div className={cn(inline ? 'flex-1 min-w-0' : !bare && 'mt-0.5')}>
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

/** Marks a line flagged for review (include = 'Review'): still counted in the cost until someone checks it. */
function ReviewChip({ onChecked }: { onChecked: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onChecked} className="shrink-0 rounded bg-warning/15 px-1 text-[10px] font-semibold uppercase text-warning hover:bg-warning/25">Review</button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">Flagged for a second look; it is still counted in the cost. Check the item, quantity and price, then click to mark it checked.</TooltipContent>
    </Tooltip>
  );
}

/** Row highlight for a line flagged for review. */
const reviewRow = 'bg-warning/[0.08] [&>td:first-child]:shadow-[inset_3px_0_0_hsl(var(--warning))]';

/** Include toggle for a line. A line flagged for review is included (it counts in the cost) and carries its own Review chip. */
function IncludeToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Checkbox checked={value !== 'No'} onCheckedChange={c => onChange(c ? 'Yes' : 'No')} aria-label="Include" />;
}

const AUTO_TIP = 'Calculated by the costing engine. Typing a value makes it a manual line; Recalculate auto costs hands it back.';

/** COGS lines grouped by category. `show` picks which lines this table carries; `fixed` hides the add-line controls. */
function CogsLines({ row, bundle, apply, show = () => true, fixed }: { row: WorkspaceRow; bundle: Bundle; apply: Apply; show?: (l: any) => boolean; fixed?: boolean }) {
  const categories = useCogsCategories();
  const [addType, setAddType] = useState('Raw Piece');
  const [showExcluded, setShowExcluded] = useState(false);
  const id = row.p.id;
  const resolved = new Map((row.r.resolvedCogsRows as any[]).map(c => [c.id, c]));
  const order = [...categories, ...COGS_CATEGORY_FALLBACK];
  const lines = bundle.cogs.filter(c => c.product_id === id && show(c))
    .map(c => resolved.get(c.id) ?? c)
    .sort((a, b) => (order.indexOf(a.cogs_type) + 1 || 99) - (order.indexOf(b.cogs_type) + 1 || 99) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const excluded = lines.filter(l => l.include === 'No');
  const visible = showExcluded || fixed ? lines : lines.filter(l => l.include !== 'No' || l.cogs_type === 'Raw Piece');
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
            <tr className="text-xs text-muted-foreground [&>th]:pb-1 [&>th]:font-medium">
              <th /><th className="text-left">Item</th><th className="text-left">Vendor</th><th className="text-right">Qty</th><th className="text-left pl-1">Unit</th><th className="text-right">₹ each</th><th className="text-right">Waste</th><th className="text-right">₹ / unit</th><th />
            </tr>
          </thead>
          {types.map(t => (
            <tbody key={t}>
              {!fixed && <tr><td colSpan={9} className="pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">{t}{t === 'Raw Piece' && rawSlots.length > 1 ? ` — ticked costs add up: ${inr(rawSlots.filter(l => l.include !== 'No').reduce((a, l) => a + lineValue(l), 0), 2)}` : ''}</td></tr>}
              {visible.filter(l => l.cogs_type === t).map(l => {
                const auto = !!l.is_auto_calculated;
                const off = l.include === 'No';
                const review = l.include === 'Review';
                const hw = isHardwareCogsType(t) && !auto && hardware.length > 0;
                return (
                  <tr key={l.id} data-review={review || undefined} className={cn('[&>td]:py-0.5', off && 'opacity-50', review && reviewRow)}>
                    <td>
                      <IncludeToggle value={l.include} onChange={v => save(l.id, { include: v })} />
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
                        {review && <ReviewChip onChecked={() => save(l.id, { include: 'Yes' })} />}
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
                        {!auto && row.target != null && (() => {
                          const each = targetLineEach(row, l);
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="text-muted-foreground/50 hover:text-primary disabled:opacity-30" disabled={each == null}
                                  onClick={() => each != null && save(l.id, { unit_cost_inr: Math.round(each * 100) / 100 })} aria-label="Target this line">
                                  <Target className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{each != null ? `Set ₹ each to ${inr(each, 2)} so the price lands on the ${money(row.target, row.cur)} target` : 'This line alone can’t reach the target'}</TooltipContent>
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
      {!fixed && <div className="flex flex-wrap items-center gap-2">
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={addType} onChange={e => setAddType(e.target.value)}>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => apply(b => addCogsLine(b, id, addType, addType === 'Raw Piece' ? { include: rawSlots.some(l => l.include === 'Yes') ? 'No' : 'Yes', sort_order: rawSlots.length, component_name: `Raw Piece ${rawSlots.length + 1}` } : {}))}>
          <Plus className="h-3.5 w-3.5" /> Add line
        </Button>
        <CopyLinesButton row={row} lines={lines.filter(l => !l.is_auto_calculated)} />
        <PasteLinesButton id={id} apply={apply} />
        {excluded.length > 0 && (
          <button className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowExcluded(s => !s)}>
            {showExcluded ? 'Hide' : 'Show'} {excluded.length} excluded line{excluded.length === 1 ? '' : 's'}
          </button>
        )}
      </div>}
    </div>
  );
}

/** Copy some of this SKU's typed cost lines, to paste onto other SKUs (their panel, or the selection bar). */
function CopyLinesButton({ row, lines }: { row: WorkspaceRow; lines: any[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  if (!lines.length) return null;
  const label = row.p.sku || row.p.name || 'this SKU';
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (o) setPicked(new Set(lines.filter(l => l.include !== 'No').map(l => l.id))); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1"><Copy className="h-3.5 w-3.5" /> Copy lines</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="mb-2 text-sm font-medium">Copy lines to paste on other SKUs</div>
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {lines.map(l => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={picked.has(l.id)} onCheckedChange={c => setPicked(s => { const n = new Set(s); if (c) n.add(l.id); else n.delete(l.id); return n; })} />
              <span className="min-w-0 flex-1 truncate">{l.component_name || l.cogs_type}</span>
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{+(+l.components_per_product || 0).toFixed(3)} × {inr(+l.unit_cost_inr || 0, 2)}</span>
            </label>
          ))}
        </div>
        <Button size="sm" className="mt-3 w-full" disabled={!picked.size} onClick={() => {
          copyLines(label, lines.filter(l => picked.has(l.id)));
          setOpen(false);
          toast.success(`Copied ${picked.size} line${picked.size === 1 ? '' : 's'}. Open another SKU, or tick several in the grid, and paste.`);
        }}>Copy {picked.size} line{picked.size === 1 ? '' : 's'}</Button>
      </PopoverContent>
    </Popover>
  );
}

function PasteLinesButton({ id, apply }: { id: string; apply: Apply }) {
  const copied = useCopiedLines();
  if (!copied) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => apply(b => pasteCogsLines(b, [id], copied.lines))}>
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste {copied.lines.length}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Add the {copied.lines.length} line{copied.lines.length === 1 ? '' : 's'} copied from {copied.from}</TooltipContent>
    </Tooltip>
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
            <tr className="text-xs text-muted-foreground [&>th]:pb-1 [&>th]:font-medium">
              <th /><th className="text-left">Labor</th><th className="text-right">Hrs / unit</th><th className="text-right">₹ / hr</th><th className="text-right">₹ / unit</th>
            </tr>
          </thead>
          <tbody>
            {oh.map(o => {
              const rate = avgRateByDesignation(withLiveDirectRates(bundle.employees as any, applyLiveRates(bundle.gs)), o.labor_type);
              const off = o.include === 'No';
              const review = o.include === 'Review';
              const shown = o.is_auto_estimated && o.labor_type === 'Finishing' ? row.r.autoLabor?.finishingMh ?? o.man_hours_per_unit
                : o.is_auto_estimated && o.labor_type === 'Packaging' ? row.r.autoLabor?.packagingMh ?? o.man_hours_per_unit : o.man_hours_per_unit;
              return (
                <tr key={o.id} data-review={review || undefined} className={cn('[&>td]:py-0.5', off && 'opacity-50', review && reviewRow)}>
                  <td><IncludeToggle value={o.include} onChange={v => apply(b => patchOverhead(b, o.id, { include: v }))} /></td>
                  <td>
                    <span className="pl-2">{o.labor_type}</span>
                    {o.is_auto_estimated && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">AUTO</span>}
                    {review && <span className="ml-1.5"><ReviewChip onChecked={() => apply(b => patchOverhead(b, o.id, { include: 'Yes' }))} /></span>}
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
                const review = n.include === 'Review';
                const isTransport = n.name === 'Auto Transport';
                const autoT = isTransport && !n.manual_override;
                return (
                  <tr key={n.id} data-review={review || undefined} className={cn('[&>td]:py-0.5', off && 'opacity-50', review && reviewRow)}>
                    <td><IncludeToggle value={n.include} onChange={v => apply(b => patchNonUnit(b, n.id, { include: v }))} /></td>
                    <td className="min-w-0">
                      {isTransport ? (
                        <span className="pl-2 truncate">{n.name}{autoT && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">AUTO</span>}</span>
                      ) : (
                        <div className="flex min-w-0 items-center gap-1">
                          <EditCell kind="text" align="left" value={n.name ?? ''} className="min-w-0" onCommit={raw => apply(b => patchNonUnit(b, n.id, { name: raw.trim() || 'Item' }))} />
                          {review && <ReviewChip onChecked={() => apply(b => patchNonUnit(b, n.id, { include: 'Yes' }))} />}
                        </div>
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
