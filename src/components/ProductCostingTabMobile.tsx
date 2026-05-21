import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';

import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, Trash2, ChevronRight, Check, Camera, X } from 'lucide-react';
import { ProductChemicalsPicker }  from '@/components/ProductChemicalsPicker';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { markupToNpm, npmToMarkup } from '@/lib/calculations';
import { VendorCombobox } from '@/components/VendorCombobox';

const DIFFICULTIES = ['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'];

export type MobileCostingProps = {
  productId: string;
  product: any;
  setProduct: React.Dispatch<React.SetStateAction<any>>;
  productTypes: any[];
  cbm: any;
  cogsItems: any[];
  setCogsItems: React.Dispatch<React.SetStateAction<any[]>>;
  nonUnitCogs: any[];
  setNonUnitCogs: React.Dispatch<React.SetStateAction<any[]>>;
  overheadItems: any[];
  setOverheadItems: React.Dispatch<React.SetStateAction<any[]>>;
  shippingItems: any[];
  shippingTypes: any[];
  employees: any[];
  globalSettings: any;
  hardwarePrices: any[];
  chemicalPrices: any[];

  // derived metrics
  ri: number;
  prePackCbm: number;
  finalUnitCbm: number;
  totalCbm: number;
  cogsPerUnit: number;
  nonUnitCogsPerUnit: number;
  directOhPerUnit: number;
  indirectOhPerUnit: number;
  totalDirectMhPerUnit: number;
  indirectOhPerMh: number;
  shippingPerUnit: number;
  exchangeRate: number;
  markupPercent: number;
  qty: number;
  summary: any;
  shipItem: any;

  // setters
  updateProduct: (field: string, value: any, immediate?: boolean) => void;
  updateCbm: (field: string, value: any) => void;
  updateCogsItem: (id: string, field: string, value: any) => void;
  updateOverheadItem: (id: string, field: string, value: any) => void;
  setShippingType: (id: string) => Promise<void>;
  recalculateAllAutoCosts: () => Promise<void>;
  recalcing: boolean;
};

type SectionKey = 'info' | 'cbm' | 'cogs' | 'nonunit' | 'overhead' | 'indirect' | 'shipping' | 'summary';

const SECTION_META: Record<SectionKey, { letter: string; title: string }> = {
  info: { letter: 'A', title: 'Product Info' },
  cbm: { letter: 'B', title: 'CBM Calculator' },
  cogs: { letter: 'C', title: 'COGS (Bill of Materials)' },
  nonunit: { letter: 'D', title: 'Non-Unit COGS' },
  overhead: { letter: 'E', title: 'Direct Overhead' },
  indirect: { letter: 'F', title: 'Indirect Overhead' },
  shipping: { letter: 'G', title: 'Shipping' },
  summary: { letter: 'H', title: 'Cost & Revenue Summary' },
};

export function ProductCostingTabMobile(props: MobileCostingProps) {
  const {
    product, productTypes, cbm, cogsItems, nonUnitCogs, overheadItems,
    shippingItems, shippingTypes, employees, globalSettings, hardwarePrices,
    chemicalPrices,
    ri, prePackCbm, finalUnitCbm, totalCbm,
    cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
    totalDirectMhPerUnit, indirectOhPerMh, shippingPerUnit,
    exchangeRate, markupPercent, qty, summary, shipItem,
    updateProduct, updateCbm, updateCogsItem, updateOverheadItem, setShippingType,
    setCogsItems, setNonUnitCogs, productId, recalculateAllAutoCosts, recalcing,
  } = props;

  const [openSection, setOpenSection] = useState<SectionKey | null>(null);

  const shipType = shippingTypes.find(s => s.id === shipItem?.shipping_type_id);
  const totalRevenueUsd = (summary.total_revenue_inr || 0) / (exchangeRate || 1);
  const margin = summary.npm || 0;
  const showCostLine = Math.abs(summary.unit_price_usd - summary.product_cost_per_unit_usd) > 0.01;

  const cogsHasReview = cogsItems.some((i: any) => i.include === 'Review');
  const overheadHasReview = overheadItems.some((i: any) => i.include === 'Review');

  const sections: Array<{ key: SectionKey; metric: string; done: boolean; hasReview?: boolean }> = [
    { key: 'info', metric: `RI ${ri.toFixed(1)}″ · ${fmt.cbm(prePackCbm)}`, done: false },
    { key: 'cbm', metric: `Unit ${fmt.cbm(finalUnitCbm)} · Total ${fmt.cbm(totalCbm)}`, done: !!product.cbm_done },
    { key: 'cogs', metric: `${fmt.inr(cogsPerUnit)}/unit · ${cogsItems.length} items`, done: !!product.cogs_done, hasReview: cogsHasReview },
    { key: 'nonunit', metric: `${fmt.inr(nonUnitCogsPerUnit)}/unit · ${nonUnitCogs.length} items`, done: !!product.cogs_done },
    { key: 'overhead', metric: `${fmt.inr(directOhPerUnit)}/unit`, done: !!product.overhead_done, hasReview: overheadHasReview },
    { key: 'indirect', metric: `${fmt.inr(indirectOhPerUnit)}/unit`, done: !!product.overhead_done },
    { key: 'shipping', metric: `${shipType?.name ?? '—'} · ${fmt.inr(shippingPerUnit)}/unit`, done: !!product.shipping_done },
    { key: 'summary', metric: `NPM ${fmt.pct(margin)}`, done: !!product.revenue_done },
  ];

  return (
    <div className="space-y-3">
      {/* Sticky summary header */}
      <button
        onClick={() => setOpenSection('summary')}
        className="sticky top-0 z-20 -mx-3 px-3 py-3 bg-background border-b w-[calc(100%+1.5rem)] text-left active:bg-muted/50 transition-colors"
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-bold">{fmt.usd(summary.unit_price_usd)}</span>
          <span className="text-sm text-muted-foreground font-mono">{fmt.inr(summary.unit_price_inr)}</span>
        </div>
        {showCostLine && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Cost: {fmt.usd(summary.product_cost_per_unit_usd)} · {fmt.inr(summary.product_cost_per_unit_inr)}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <span>Qty {qty}</span>
          <span className="opacity-50">·</span>
          <span>Rev {fmt.usd(totalRevenueUsd)}</span>
          <span className="opacity-50">·</span>
          <span>Margin {fmt.pct(margin)}</span>
        </div>
      </button>

      {/* Recalc button */}
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={recalculateAllAutoCosts} disabled={recalcing}>
          {recalcing ? 'Recalculating…' : 'Recalculate auto costs'}
        </Button>
      </div>

      {/* Section list */}
      <div className="space-y-2">
        {sections.map(s => {
          const meta = SECTION_META[s.key];
          return (
            <button
              key={s.key}
              onClick={() => setOpenSection(s.key)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 active:bg-accent transition-colors text-left min-h-[64px]"
            >
              <div className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${s.done ? 'bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                {meta.letter}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                  {meta.title}
                  {s.hasReview && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200">⚠ Review</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{s.metric}</div>
              </div>
              {s.done ? (
                <Check className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Section sheet */}
      <Sheet open={openSection !== null} onOpenChange={(o) => !o && setOpenSection(null)}>
        <SheetContent
          side="bottom"
          className="h-[92vh] p-0 flex flex-col gap-0 rounded-t-xl"
        >
          {openSection && (
            <>
              <SheetTitle className="sr-only">{SECTION_META[openSection].title}</SheetTitle>
              <SheetDescription className="sr-only">Edit {SECTION_META[openSection].title} for this product.</SheetDescription>
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-background sticky top-0 z-10">
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setOpenSection(null)}>
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {SECTION_META[openSection].letter}. {SECTION_META[openSection].title}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {sections.find(s => s.key === openSection)?.metric}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 pb-24">
                {openSection === 'info' && <InfoSection {...props} />}
                {openSection === 'cbm' && <CbmSection {...props} />}
                {openSection === 'cogs' && <CogsSection {...props} />}
                {openSection === 'nonunit' && <NonUnitSection {...props} />}
                {openSection === 'overhead' && <OverheadSection {...props} />}
                {openSection === 'indirect' && <IndirectSection {...props} />}
                {openSection === 'shipping' && <ShippingSection {...props} />}
                {openSection === 'summary' && <SummarySection {...props} />}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ===== Section A: Product Info =====
function InfoSection({ product, productTypes, cbm, updateProduct, updateCbm, productId, overheadItems, setOverheadItems, ri }: MobileCostingProps) {
  const productType = productTypes.find(pt => pt.id === product?.product_type_id);

  const packagingType = product?.packaging_type || 'ic_mc';
  const [difficulties, setDifficulties] = useState<Array<{ name: string; adjustment_factor?: number }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [difficultiesError, setDifficultiesError] = useState<string | null>(null);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const [d, l] = await Promise.all([
        (supabase as any).from('finishing_difficulty').select('name, adjustment_factor').order('sort_order'),
        (supabase as any).from('local_transport_locations').select('id, name').eq('active', true).order('sort_order'),
      ]);
      if (d.error) {
        const msg = `Could not load difficulty options: ${d.error.message}`;
        setDifficultiesError(msg);
        toast.error(msg);
      } else if (!d.data || d.data.length === 0) {
        setDifficultiesError('No finishing difficulty options configured.');
      } else {
        setDifficulties(d.data);
      }
      if (l.error) {
        const msg = `Could not load source locations: ${l.error.message}`;
        setLocationsError(msg);
        toast.error(msg);
      } else {
        setLocations(l.data || []);
      }
    })();
  }, []);
  return (
    <div className="space-y-3">
      {/* Photo */}
      <div className="flex items-start gap-3">
        {product.photo_url ? (
          <div className="relative">
            <img src={product.photo_url} alt={product.name} className="h-24 w-24 object-cover rounded-md border" />
            <button
              onClick={() => updateProduct('photo_url', null)}
              className="absolute -top-1 -right-1 h-5 w-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <label className="h-24 w-24 border-2 border-dashed rounded-md flex flex-col items-center justify-center cursor-pointer hover:border-primary/50">
            <Camera className="h-6 w-6 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground mt-1">Add Photo</span>
            <input
              type="file"
              className="hidden"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !productId) return;
                const ext = file.name.split('.').pop() || 'jpg';
                const path = `${productId}.${ext}`;
                const { error: uploadErr } = await supabase.storage.from('product-photos').upload(path, file, { contentType: file.type, upsert: true });
                if (uploadErr) { toast.error('Upload failed: ' + uploadErr.message); return; }
                const { data: urlData } = supabase.storage.from('product-photos').getPublicUrl(path);
                updateProduct('photo_url', urlData.publicUrl);
                toast.success('Photo uploaded');
              }}
            />
          </label>
        )}
      </div>

      <FieldGrid>
        <Field label="Name"><Input className="h-10" defaultValue={product.name} onBlur={e => updateProduct('name', e.target.value)} /></Field>
        <Field label="SKU"><Input className="h-10" defaultValue={product.sku || ''} onBlur={e => updateProduct('sku', e.target.value)} /></Field>
        <Field label="Quantity"><Input className="h-10" type="number" defaultValue={product.quantity || 100} onBlur={e => updateProduct('quantity', parseInt(e.target.value) || 0)} /></Field>
        <Field label="MOQ"><Input className="h-10" type="number" defaultValue={product.moq || 50} onBlur={e => updateProduct('moq', parseInt(e.target.value) || 0)} /></Field>
        <Field label="Width (in)"><Input className="h-10" type="number" defaultValue={product.width_inch || ''} onBlur={e => updateProduct('width_inch', Number(e.target.value))} /></Field>
        <Field label="Depth (in)"><Input className="h-10" type="number" defaultValue={product.depth_inch || ''} onBlur={e => updateProduct('depth_inch', Number(e.target.value))} /></Field>
        <Field label="Height (in)"><Input className="h-10" type="number" defaultValue={product.height_inch || ''} onBlur={e => updateProduct('height_inch', Number(e.target.value))} /></Field>
        <Field label="Weight (kg)"><Input className="h-10" type="number" defaultValue={product.weight_kg || ''} onBlur={e => updateProduct('weight_kg', Number(e.target.value))} /></Field>
      </FieldGrid>

      <Field label="Product Type">
        <Select value={product.product_type_id || ''} onValueChange={v => updateProduct('product_type_id', v)}>
          <SelectTrigger className="h-10"><SelectValue placeholder="Select..." /></SelectTrigger>
          <SelectContent>
            {productTypes.map(pt => <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Packaging Type">
        <Select
          value={packagingType}
          onValueChange={(v) => {
            updateProduct('packaging_type', v);
            const nextIncludeMc = v === 'ic_mc';
            if ((cbm?.include_mc ?? true) !== nextIncludeMc) updateCbm('include_mc', nextIncludeMc);
          }}
        >
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ic_only">IC only</SelectItem>
            <SelectItem value="ic_mc">IC + MC</SelectItem>
            <SelectItem value="corrugate_bubble">Corrugate + Bubble Wrap</SelectItem>
            <SelectItem value="no_packaging">No packaging</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Difficulty">
        <Select value={product.finishing_difficulty || 'Medium'} onValueChange={v => {
          updateProduct('finishing_difficulty', v);
          const newFactor = difficulties.find(x => x.name === v)?.adjustment_factor
            ?? calc.getDifficultyFactor(v);
          const finishingMhPer100Ri = productType?.finishing_mh_per_100ri ?? 0;
          const percentWood = product?.percent_wood ?? 1;
          const newFinishingMh = calc.calcFinishingMhPerUnit(finishingMhPer100Ri, newFactor, percentWood, ri);
          const finRows = overheadItems.filter((i: any) => i.labor_type === 'Finishing');
          if (finRows.length) {
            const mh = parseFloat(newFinishingMh.toFixed(4));
            setOverheadItems(prev => prev.map((i: any) => i.labor_type === 'Finishing'
              ? { ...i, man_hours_per_unit: mh, is_auto_estimated: true }
              : i));
            finRows.forEach((r: any) => {
              (supabase as any).from('overhead_items')
                .update({ man_hours_per_unit: mh, is_auto_estimated: true })
                .eq('id', r.id);
            });
          }
        }}>

          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(difficulties.length > 0 ? difficulties.map(d => d.name) : DIFFICULTIES).map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        {difficultiesError && <p className="text-xs text-destructive mt-1">⚠ {difficultiesError}</p>}
      </Field>

      <Field label="% Wood">
        <Select
          value={String(Math.round((product.percent_wood ?? 1) * 100))}
          onValueChange={(v) => updateProduct('percent_wood', Number(v) / 100)}
        >
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 21 }, (_, i) => i * 5).map(p => (
              <SelectItem key={p} value={String(p)}>{p}%</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Target Price (USD)">
        <Input className="h-10" type="number" defaultValue={product.target_price_usd || ''} onBlur={e => updateProduct('target_price_usd', Number(e.target.value) || null)} />
      </Field>

      <Field label="Source location">
        <Select
          value={product.source_location_id || '__inhouse__'}
          onValueChange={(v) => updateProduct('source_location_id', v === '__inhouse__' ? null : v)}
        >
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inhouse__">In-house (Jodhpur)</SelectItem>
            {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {locationsError && <p className="text-xs text-destructive mt-1">⚠ {locationsError}</p>}
      </Field>
    </div>
  );
}

// ===== Section B: CBM =====
function CbmSection(props: MobileCostingProps) {
  const { cbm, product, updateCbm, finalUnitCbm, totalCbm, prePackCbm } = props;
  const packagingType = product?.packaging_type || 'ic_mc';
  const includeMc = packagingType === 'ic_mc';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Pre-pkg CBM" value={fmt.cbm(prePackCbm)} />
        <Stat label="Final Unit CBM" value={fmt.cbm(finalUnitCbm)} highlight />
        <Stat label="Total CBM" value={fmt.cbm(totalCbm)} highlight />
      </div>

      {packagingType !== 'corrugate_bubble' && (
        <>
          <FieldGrid>
            <Field label="Products / IC">
              <Input className="h-10" type="number" defaultValue={cbm?.products_per_ic || 1} onBlur={e => updateCbm('products_per_ic', parseInt(e.target.value) || 1)} />
            </Field>
            <Field label="IC Width">
              <Input className="h-10" type="number" step="0.1" defaultValue={cbm?.ic_width || ''} onBlur={e => updateCbm('ic_width', Number(e.target.value))} />
            </Field>
            <Field label="IC Depth">
              <Input className="h-10" type="number" step="0.1" defaultValue={cbm?.ic_depth || ''} onBlur={e => updateCbm('ic_depth', Number(e.target.value))} />
            </Field>
            <Field label="IC Height">
              <Input className="h-10" type="number" step="0.1" defaultValue={cbm?.ic_height || ''} onBlur={e => updateCbm('ic_height', Number(e.target.value))} />
            </Field>
          </FieldGrid>

          {includeMc && (
            <>
              <div className="text-xs font-semibold text-muted-foreground mt-2">Master Carton</div>
              <FieldGrid>
                <Field label="MC Max W"><Input className="h-10" type="number" defaultValue={cbm?.mc_max_width || 25} onBlur={e => updateCbm('mc_max_width', Number(e.target.value))} /></Field>
                <Field label="MC Max D"><Input className="h-10" type="number" defaultValue={cbm?.mc_max_depth || 25} onBlur={e => updateCbm('mc_max_depth', Number(e.target.value))} /></Field>
                <Field label="MC Max H"><Input className="h-10" type="number" defaultValue={cbm?.mc_max_height || 25} onBlur={e => updateCbm('mc_max_height', Number(e.target.value))} /></Field>
                <Field label="Weight Limit (kg)"><Input className="h-10" type="number" defaultValue={cbm?.mc_weight_limit_kg || 20} onBlur={e => updateCbm('mc_weight_limit_kg', Number(e.target.value))} /></Field>
              </FieldGrid>
            </>
          )}
        </>
      )}

      <p className="text-[11px] text-muted-foreground pt-2">
        Detailed packing layout, box-type pickers, and manual overrides are available on desktop.
      </p>
    </div>
  );
}

// ===== Section C: COGS =====
function CogsSection(props: MobileCostingProps) {
  const { cogsItems, setCogsItems, updateCogsItem, cogsPerUnit, productId, hardwarePrices, chemicalPrices } = props;

  const refetchCogs = async () => {
    const { data } = await (supabase as any).from('cogs_items').select('*').eq('product_id', productId).order('sort_order');
    if (data) setCogsItems(data);
  };

  const addRow = async () => {
    const { data } = await (supabase as any).from('cogs_items').insert({
      product_id: productId, cogs_type: 'Raw Piece', component_name: 'New Item',
      sort_order: cogsItems.length,
    }).select().single();
    if (data) setCogsItems([...cogsItems, data]);
  };

  const deleteRow = async (item: any) => {
    if (item.is_auto_calculated) return;
    if (!confirm(`Delete "${item.component_name || item.cogs_type}" row?`)) return;
    const { error } = await (supabase as any).from('cogs_items').delete().eq('id', item.id);
    if (error) { toast.error(error.message); return; }
    setCogsItems(items => items.filter(i => i.id !== item.id));
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ProductChemicalsPicker
          productId={productId}
          chemicals={chemicalPrices}
          cogsItems={cogsItems}
          onChanged={refetchCogs}
        />
      </div>
      <div className="space-y-2">
        {cogsItems.map(item => {
          const costCalc = calc.calcCogsItemCost({
            include: item.include,
            components_per_product: item.components_per_product || 0,
            unit_cost_inr: item.unit_cost_inr || 0,
            waste_factor: item.waste_factor || 0,
          });
          const isAuto = item.is_auto_calculated;
          return (
            <Card key={item.id} className={cn(
              item.include === 'No' && 'opacity-50',
              isAuto && 'border-blue-500/30',
              item.include === 'Review' && 'bg-amber-100 dark:bg-amber-500/15 border-l-2 border-l-amber-500'
            )}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Select value={item.include || 'Yes'} onValueChange={v => updateCogsItem(item.id, 'include', v)}>
                    <SelectTrigger className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Yes">Include</SelectItem>
                      <SelectItem value="Review">Review</SelectItem>
                      <SelectItem value="No">Exclude</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    {isAuto && <Badge variant="secondary" className="text-[10px]">auto</Badge>}
                    <Button
                      size="icon" variant="ghost"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                      disabled={isAuto}
                      onClick={() => deleteRow(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Field label="Type">
                  {isAuto ? (
                    <div className="h-10 px-3 py-2 text-sm rounded-md border bg-muted/50">{item.cogs_type}</div>
                  ) : (
                    <Select value={item.cogs_type} onValueChange={v => updateCogsItem(item.id, 'cogs_type', v)}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Raw Piece">Raw Piece</SelectItem>
                        <SelectItem value="Hardware">Hardware</SelectItem>
                        <SelectItem value="Accessories">Accessories</SelectItem>
                        <SelectItem value="Subcontracting">Subcontracting</SelectItem>
                        <SelectItem value="Finishing Materials">Finishing Materials</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>

                <Field label="Component">
                  <Input
                    className="h-10"
                    defaultValue={item.component_name || ''}
                    onBlur={e => updateCogsItem(item.id, 'component_name', e.target.value)}
                  />
                </Field>

                <Field label="Vendor">
                  <VendorCombobox
                    className="h-10 text-sm"
                    value={item.vendor_name || ''}
                    onChange={v => updateCogsItem(item.id, 'vendor_name', v)}
                  />
                </Field>

                <FieldGrid>
                  <Field label={`Qty/Prod (${item.units || 'pc'})`}>
                    <Input className="h-10" type="number" step="any"
                      defaultValue={item.components_per_product ?? 0}
                      onBlur={e => updateCogsItem(item.id, 'components_per_product', Number(e.target.value))} />
                  </Field>
                  <Field label="Cost each (₹)">
                    <Input className="h-10" type="number" step="any"
                      defaultValue={item.unit_cost_inr ?? 0}
                      onBlur={e => updateCogsItem(item.id, 'unit_cost_inr', Number(e.target.value))} />
                  </Field>
                  <Field label="Waste %">
                    <Input className="h-10" type="number"
                      defaultValue={(item.waste_factor || 0) * 100}
                      onBlur={e => updateCogsItem(item.id, 'waste_factor', Number(e.target.value) / 100)} />
                  </Field>
                  <Field label="Unit cost">
                    <div className="h-10 px-3 py-2 rounded-md bg-muted/50 text-sm font-mono font-semibold flex items-center">
                      {fmt.inr(costCalc.unit_cost)}
                    </div>
                  </Field>
                </FieldGrid>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="py-3 border-t flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-muted-foreground">Total: </span>
          <span className="font-mono font-bold">{fmt.inr(cogsPerUnit)}/unit</span>
        </div>
        <Button size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" /> Add Row
        </Button>
      </div>
    </div>
  );
}

// ===== Section D: Non-Unit COGS =====
function NonUnitSection(props: MobileCostingProps) {
  const { nonUnitCogs, setNonUnitCogs, qty, nonUnitCogsPerUnit, productId } = props;

  const addRow = async () => {
    const { data } = await (supabase as any).from('non_unit_cogs').insert({
      product_id: productId, name: 'New Item', sort_order: nonUnitCogs.length,
    }).select().single();
    if (data) setNonUnitCogs([...nonUnitCogs, data]);
  };

  const deleteRow = async (item: any) => {
    if (item.name === 'Auto Transport') return;
    if (!confirm(`Delete "${item.name}" row?`)) return;
    const { error } = await (supabase as any).from('non_unit_cogs').delete().eq('id', item.id);
    if (error) { toast.error(error.message); return; }
    setNonUnitCogs(items => items.filter(i => i.id !== item.id));
  };

  const update = async (id: string, field: string, value: any) => {
    setNonUnitCogs(items => items.map(i => i.id === id ? { ...i, [field]: value } : i));
    const { error } = await (supabase as any).from('non_unit_cogs').update({ [field]: value }).eq('id', id);
    if (error) toast.error(`Could not save ${field}: ${error.message}`);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {nonUnitCogs.map(item => {
          const isAuto = item.name === 'Auto Transport';
          const locked = isAuto && !item.manual_override;
          const unitCost = qty > 0 ? (item.total_quantity * item.cost_each_inr) / qty : 0;
          return (
            <Card key={item.id} className={item.include === 'No' ? 'opacity-50' : ''}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Select value={item.include || 'Yes'} onValueChange={v => update(item.id, 'include', v)}>
                    <SelectTrigger className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Yes">Include</SelectItem>
                      <SelectItem value="No">Exclude</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    {isAuto && (
                      <button
                        type="button"
                        onClick={() => update(item.id, 'manual_override', !item.manual_override)}
                        className={`text-[10px] px-2 py-0.5 rounded ${item.manual_override ? 'bg-amber-200 text-amber-900' : 'bg-muted text-muted-foreground'}`}
                      >
                        {item.manual_override ? 'manual' : 'auto'}
                      </button>
                    )}
                    <Button
                      size="icon" variant="ghost"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                      disabled={isAuto}
                      onClick={() => deleteRow(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Field label="Name">
                  {isAuto ? (
                    <div className="h-10 px-3 py-2 text-sm rounded-md border bg-muted/50">Auto Transport</div>
                  ) : (
                    <Input className="h-10" defaultValue={item.name || ''} onBlur={e => update(item.id, 'name', e.target.value)} />
                  )}
                </Field>

                <FieldGrid>
                  <Field label="Total Qty">
                    {locked ? (
                      <div className="h-10 px-3 py-2 text-sm rounded-md border bg-muted/50 font-mono">{(item.total_quantity || 0).toFixed(4)}</div>
                    ) : (
                      <Input key={`q-${item.id}-${item.manual_override}`} className="h-10" type="number" defaultValue={item.total_quantity || 0}
                        onBlur={e => update(item.id, 'total_quantity', Number(e.target.value))} />
                    )}
                  </Field>
                  <Field label="Cost each (₹)">
                    {locked ? (
                      <div className="h-10 px-3 py-2 text-sm rounded-md border bg-muted/50 font-mono">{item.cost_each_inr || 0}</div>
                    ) : (
                      <Input key={`c-${item.id}-${item.manual_override}`} className="h-10" type="number" defaultValue={item.cost_each_inr || 0}
                        onBlur={e => update(item.id, 'cost_each_inr', Number(e.target.value))} />
                    )}
                  </Field>
                </FieldGrid>

                <div className="text-xs text-right">
                  <span className="text-muted-foreground">Unit cost: </span>
                  <span className="font-mono font-semibold">{fmt.inr(unitCost)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="py-3 border-t flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-muted-foreground">Total: </span>
          <span className="font-mono font-bold">{fmt.inr(nonUnitCogsPerUnit)}/unit</span>
        </div>
        <Button size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" /> Add Row
        </Button>
      </div>
    </div>
  );
}

// ===== Section E: Direct Overhead =====
function OverheadSection(props: MobileCostingProps) {
  const { overheadItems, employees, qty, updateOverheadItem, directOhPerUnit } = props;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {overheadItems.map(item => {
          const rate = calc.avgRateByDesignation(employees, item.labor_type);
          const unitCost = (item.man_hours_per_unit || 0) * rate;
          const isAuto = item.is_auto_estimated;
          return (
            <Card key={item.id} className={cn(
              item.include === 'No' && 'opacity-50',
              isAuto && 'border-blue-500/30',
              item.include === 'Review' && 'bg-amber-100 dark:bg-amber-500/15 border-l-2 border-l-amber-500'
            )}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    {item.labor_type}
                    {isAuto && <Badge variant="secondary" className="text-[10px]">auto</Badge>}
                  </div>
                  <Select value={item.include || 'Yes'} onValueChange={v => updateOverheadItem(item.id, 'include', v)}>
                    <SelectTrigger className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Yes">Include</SelectItem>
                      <SelectItem value="No">Exclude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <FieldGrid>
                  <Field label="MH / Unit">
                    <Input className="h-10" type="number" step="any"
                      defaultValue={Number.isFinite(item.man_hours_per_unit) ? item.man_hours_per_unit : 0}
                      onBlur={e => updateOverheadItem(item.id, 'man_hours_per_unit', Number(e.target.value) || 0)} />
                  </Field>
                  <Field label="Rate (₹/hr)">
                    <div className="h-10 px-3 py-2 rounded-md bg-muted/50 text-sm font-mono flex items-center">{fmt.inr(rate)}</div>
                  </Field>
                  <Field label="Total MH">
                    <div className="h-10 px-3 py-2 rounded-md bg-muted/50 text-sm font-mono flex items-center">{fmt.hrs((item.man_hours_per_unit || 0) * qty)}</div>
                  </Field>
                  <Field label="Unit Cost">
                    <div className="h-10 px-3 py-2 rounded-md bg-muted/50 text-sm font-mono font-semibold flex items-center">{fmt.inr(unitCost)}</div>
                  </Field>
                </FieldGrid>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="sticky bottom-0 -mx-3 px-3 py-3 bg-background border-t text-sm">
        <span className="text-muted-foreground">Total: </span>
        <span className="font-mono font-bold">{fmt.inr(directOhPerUnit)}/unit</span>
      </div>
    </div>
  );
}

// ===== Section F: Indirect Overhead =====
function IndirectSection({ totalDirectMhPerUnit, indirectOhPerMh, indirectOhPerUnit }: MobileCostingProps) {
  return (
    <div className="space-y-3">
      <Stat label="Total Direct MH / Unit" value={`${totalDirectMhPerUnit.toFixed(2)} hrs`} />
      <Stat label="Indirect OH / MH" value={fmt.inr(indirectOhPerMh)} />
      <Stat label="Indirect OH / Unit" value={fmt.inr(indirectOhPerUnit)} highlight />
      <p className="text-[11px] text-muted-foreground pt-2">
        Indirect overhead is computed from your global labor settings and direct man-hours. Edit global rates in Settings.
      </p>
    </div>
  );
}

// ===== Section G: Shipping =====
function ShippingSection({ shipItem, shippingTypes, finalUnitCbm, shippingPerUnit, setShippingType }: MobileCostingProps) {
  return (
    <div className="space-y-3">
      <Field label="Shipping Type">
        <Select value={shipItem?.shipping_type_id || ''} onValueChange={setShippingType}>
          <SelectTrigger className="h-10"><SelectValue placeholder="Select..." /></SelectTrigger>
          <SelectContent>
            {shippingTypes.map(st => (
              <SelectItem key={st.id} value={st.id}>{st.name} — {fmt.inr(st.cost_inr)}/{st.per_unit}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Stat label="Unit CBM" value={fmt.cbm(finalUnitCbm)} />
      <Stat label="Unit Cost" value={fmt.inr(shippingPerUnit)} highlight />
    </div>
  );
}

// ===== Section H: Cost & Revenue Summary =====
function SummarySection({ summary, exchangeRate, qty, markupPercent, updateProduct, product }: MobileCostingProps) {
  const rows = [
    { label: 'COGS', value: summary.total_cogs_per_unit },
    { label: 'Direct Overhead', value: summary.total_direct_oh_per_unit },
    { label: 'Indirect Overhead', value: summary.total_indirect_oh_per_unit },
    { label: 'Shipping', value: summary.total_shipping_per_unit },
  ];
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {rows.map(r => (
          <div key={r.label} className="flex justify-between items-center py-2 border-b text-sm">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-mono">{fmt.inr(r.value)}</span>
          </div>
        ))}
        <div className="flex justify-between items-center py-2 text-sm font-bold">
          <span>Product Cost / Unit</span>
          <span className="font-mono">{fmt.inr(summary.product_cost_per_unit_inr)}</span>
        </div>
        <div className="flex justify-between items-center pb-2 text-xs text-muted-foreground">
          <span>USD</span>
          <span className="font-mono">{fmt.usd(summary.product_cost_per_unit_usd)}</span>
        </div>
      </div>

      <Field label="Net Profit Margin %">
        <Input className="h-10" type="number" step="0.1"
          defaultValue={(markupToNpm(markupPercent) * 100).toFixed(1)}
          key={`npm-m-${markupPercent}`}
          onBlur={e => {
            const npmPct = Number(e.target.value);
            if (!isFinite(npmPct) || npmPct < 0 || npmPct >= 100) {
              e.target.value = (markupToNpm(markupPercent) * 100).toFixed(1);
              toast.error('Enter 0–99.9');
              return;
            }
            updateProduct('markup_percent', npmToMarkup(npmPct / 100));
          }} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Unit Price (₹)" value={fmt.inr(summary.unit_price_inr)} highlight />
        <Stat label="Unit Price ($)" value={fmt.usd(summary.unit_price_usd)} highlight />
        <Stat label="Total Revenue" value={fmt.inr(summary.total_revenue_inr)} />
        <Stat label="Net Margin" value={fmt.pct(summary.npm)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Gross Profit" value={fmt.inr(summary.gross_profit_inr)} />
        <Stat label="GPM" value={fmt.pct(summary.gpm)} />
        <Stat label="Net Profit" value={fmt.inr(summary.net_profit_inr)} />
      </div>

      <div className="border-t pt-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2">Completion</div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'cbm_done', label: 'CBM' },
            { key: 'cogs_done', label: 'COGS' },
            { key: 'overhead_done', label: 'Overhead' },
            { key: 'shipping_done', label: 'Shipping' },
            { key: 'revenue_done', label: 'Revenue' },
          ].map(c => (
            <label key={c.key} className="flex items-center gap-2 text-sm py-1">
              <Checkbox
                checked={product[c.key] || false}
                onCheckedChange={(v) => updateProduct(c.key, !!v, true)}
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== Helpers =====
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}
function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="p-3 rounded-md border bg-card">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono ${highlight ? 'text-base font-bold text-primary' : 'text-sm font-semibold'}`}>{value}</div>
    </div>
  );
}
