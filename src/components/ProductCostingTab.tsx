import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ChevronDown, Plus, Trash2, Upload, X, Camera, ClipboardCheck, FileText, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { loadCurrencyMap, getCachedCurrencyMap, subscribeCurrencyMap, convertFromInr, type CurrencyMap } from '@/lib/currency';
import * as calc from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';
import { computeProductCosting } from '@/lib/costing-engine';

import { ProductVendorsPanel } from '@/components/ProductVendorsPanel';
import { VendorCombobox } from '@/components/VendorCombobox';
import { ResizableTableHead } from '@/components/ResizableTableHead';
import { ProductCostingTabMobile } from '@/components/ProductCostingTabMobile';
import { ProductChemicalsPicker } from '@/components/ProductChemicalsPicker';
import { useIsMobile } from '@/hooks/use-mobile';


const DIFFICULTIES = ['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'];

type PackagingType = 'no_packaging' | 'ic_only' | 'ic_mc' | 'corrugate_bubble' | 'bulk_pack';

const packagingIncludeForType = (packagingType: string, componentName: string, forceAllOff = false): boolean | null => {
  const name = (componentName || '').toLowerCase();
  if (packagingType === 'no_packaging' || forceAllOff) return false;
  if (name.includes('ic box') || name.includes('inner carton') || name === 'ic') return packagingType === 'ic_only' || packagingType === 'ic_mc';
  if (name.includes('mc box') || name.includes('master carton') || name.includes('outer carton')) return packagingType === 'ic_mc' || packagingType === 'bulk_pack';
  if (name === 'corrugate wrap' || name === 'bubble wrap') return packagingType === 'corrugate_bubble';
  if (name.includes('foam') || name.includes('bulk pack')) return packagingType === 'bulk_pack';
  return null;
};

const PRICED_QTY_DEFAULT_COGS_TYPES = new Set(['Raw Piece', 'Subcontracting', 'Hardware']);

const shouldBackfillPricedQty = (item: any) => (
  !item?.is_auto_calculated &&
  PRICED_QTY_DEFAULT_COGS_TYPES.has(item?.cogs_type) &&
  (Number(item?.unit_cost_inr) || 0) > 0 &&
  (Number(item?.components_per_product) || 0) <= 0
);

const preserveManualNo = (item: any, defaultIncluded: boolean) => defaultIncluded && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No';

const SectionHeader = ({ title, open, onToggle, badge, done, hasReview, onDoneChange }: { title: string; open: boolean; onToggle: () => void; badge?: string; done?: boolean; hasReview?: boolean; onDoneChange?: (next: boolean) => void }) => (
  <div className={`w-full flex items-center gap-2 py-2 px-3 rounded-md transition-colors ${done ? 'bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50' : 'bg-muted/50 hover:bg-muted'}`}>
    {onDoneChange && (
      <Checkbox
        checked={!!done}
        onCheckedChange={(v) => onDoneChange(!!v)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Mark ${title} done`}
        title="Mark section done"
      />
    )}
    <button onClick={onToggle} className="flex-1 flex items-center gap-2 text-left min-w-0">
      <ChevronDown className={`h-4 w-4 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`} />
      <span className={`text-sm font-semibold flex-1 truncate ${done ? 'text-green-800 dark:text-green-300' : ''}`}>{title}</span>
      {hasReview && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200">⚠ Review</span>}
      {badge && <span className="text-xs calc-field px-2 py-0.5 rounded">{badge}</span>}
    </button>
  </div>
);

const AutoCell = ({ children, isAuto }: { children: React.ReactNode; isAuto?: boolean }) => (
  <span className={isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}>{children}</span>
);

export type ProductCostingSummary = {
  unitPriceInr: number;
  unitPriceUsd: number;
  unitCostInr: number;
  unitCostUsd: number;
  exchangeRate: number;
};

type Props = { productId: string; onProductUpdated?: () => void; onSummaryChange?: (s: ProductCostingSummary) => void };

export function ProductCostingTab({ productId: id, onProductUpdated, onSummaryChange }: Props) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();


  // Data state
  const [product, setProduct] = useState<any>(null);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [cbm, setCbm] = useState<any>(null);
  const [cogsItems, setCogsItems] = useState<any[]>([]);
  const [nonUnitCogs, setNonUnitCogs] = useState<any[]>([]);
  const [overheadItems, setOverheadItems] = useState<any[]>([]);
  const [shippingItems, setShippingItems] = useState<any[]>([]);
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [boxData, setBoxData] = useState<any[]>([]);
  const [chemicalPrices, setChemicalPrices] = useState<any[]>([]);
  const [hardwarePrices, setHardwarePrices] = useState<any[]>([]);
  const [rawMaterialCosts, setRawMaterialCosts] = useState<any[]>([]);
  const [difficulties, setDifficulties] = useState<Array<{ name: string; adjustment_factor: number }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; cost_per_cbm_inr: number }>>([]);
  const [difficultiesError, setDifficultiesError] = useState<string | null>(null);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [inquiryOverrides, setInquiryOverrides] = useState<any | null>(null);
  const [currencyMap, setCurrencyMap] = useState<CurrencyMap | null>(getCachedCurrencyMap());
  useEffect(() => {
    loadCurrencyMap().then(setCurrencyMap).catch(() => {});
    return subscribeCurrencyMap(setCurrencyMap);
  }, []);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [recalcTick, setRecalcTick] = useState(0);
  const [recalcing, setRecalcing] = useState(false);

  // Section open state
  const [sections, setSections] = useState({
    info: true, cbm: true, cogs: true, nonUnitCogs: false,
    overhead: true, indirectOh: false, shipping: true, summary: true,
  });
  const [selectedCogsIds, setSelectedCogsIds] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setSections(s => ({ ...s, [key]: !(s as any)[key] }));

  // Debounced save — accumulates pending updates so rapid edits to different fields don't drop earlier ones
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdates = useRef<Record<string, any>>({});
  const flushSave = useCallback(async () => {
    if (!id) return;
    const updates = pendingUpdates.current;
    pendingUpdates.current = {};
    if (saveTimeout.current) { clearTimeout(saveTimeout.current); saveTimeout.current = null; }
    if (Object.keys(updates).length === 0) return;
    const { error } = await (supabase as any).from('products').update(updates).eq('id', id);
    if (error) toast.error('Save failed: ' + error.message);
    else onProductUpdated?.();
  }, [id, onProductUpdated]);
  const saveProduct = useCallback((updates: any, immediate = false) => {
    pendingUpdates.current = { ...pendingUpdates.current, ...updates };
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    if (immediate) {
      flushSave();
    } else {
      saveTimeout.current = setTimeout(flushSave, 500);
    }
  }, [flushSave]);

  const updateProduct = (field: string, value: any, immediate = false) => {
    setProduct((p: any) => ({ ...p, [field]: value }));
    saveProduct({ [field]: value }, immediate);
  };

  // Flush pending edits on unmount so leaving the page doesn't drop the last change
  useEffect(() => {
    return () => { flushSave(); };
  }, [flushSave]);

  const saveCbm = useCallback((updates: any) => {
    if (!id) return;
    (supabase as any).from('cbm_estimates').update(updates).eq('product_id', id).then(({ error }: any) => {
      if (error) toast.error('CBM save failed');
    });
  }, [id]);

  const updateCbm = (field: string, value: any) => {
    setCbm((c: any) => ({ ...c, [field]: value }));
    saveCbm({ [field]: value });
  };

  // Recalculate all auto-managed costs (finishing, packaging, overhead, transport, freight)
  const recalculateAllAutoCosts = useCallback(async () => {
    if (!id || recalcing) return;
    setRecalcing(true);
    try {
      // Reset auto flags on rows we manage so the effects will rewrite them
      const autoCogsNames = ['color', 'stain', 'sealer', 'lacquer', 'ic box', 'inner carton', 'mc box', 'master carton', 'outer carton', 'domestic freight'];
      const cogsToReset = cogsItems.filter(i => {
        const n = (i.component_name || '').toLowerCase();
        return autoCogsNames.some(k => n.includes(k));
      });
      const ohToReset = overheadItems.filter(i => i.labor_type === 'Finishing' || i.labor_type === 'Packaging');

      await Promise.all([
        ...cogsToReset.map(i =>
          (supabase as any).from('cogs_items').update({ is_auto_calculated: true }).eq('id', i.id)
        ),
        ...ohToReset.map(i =>
          (supabase as any).from('overhead_items').update({ is_auto_estimated: true }).eq('id', i.id)
        ),
      ]);

      // Re-insert any missing auto-managed rows (so deleted ones come back) using
      // the shared idempotent seeder so the same logic runs from headless recost too.
      const { seedDefaultCostingRows } = await import('@/lib/costing-seed');
      const seeded = await seedDefaultCostingRows(id);

      // Refetch cogs + overhead so newly seeded rows appear in state.
      const [{ data: freshCogs }, { data: freshOh }] = await Promise.all([
        (supabase as any).from('cogs_items').select('*').eq('product_id', id).order('sort_order'),
        (supabase as any).from('overhead_items').select('*').eq('product_id', id).order('sort_order'),
      ]);

      const beforeCount = cogsItems.length + overheadItems.length;
      const afterCount = (freshCogs?.length || 0) + (freshOh?.length || 0);
      const restored = Math.max(0, afterCount - beforeCount);

      setCogsItems(() => {
        const fresh = (freshCogs || []) as any[];
        return fresh.map((i) => cogsToReset.some((c) => c.id === i.id) ? { ...i, is_auto_calculated: true } : i);
      });
      setOverheadItems(() => {
        const fresh = (freshOh || []) as any[];
        return fresh.map((i) => ohToReset.some((o) => o.id === i.id) ? { ...i, is_auto_estimated: true } : i);
      });

      // Force all auto-calc effects to re-run
      setRecalcTick(t => t + 1);
      void seeded;
      toast.success(restored > 0 ? `Recalculated auto costs (restored ${restored} row${restored === 1 ? '' : 's'})` : 'Recalculated auto costs');
    } catch (e: any) {
      toast.error('Recalc failed: ' + (e?.message || 'unknown error'));
    } finally {
      setTimeout(() => setRecalcing(false), 600);
    }
  }, [id, cogsItems, overheadItems, recalcing, product?.packaging_type, product?.source_location_id]);


  // Fetch all data
  useEffect(() => {
    const KEY = 'seenMarkupToNpmNotice_2026_05';
    if (typeof window !== 'undefined' && !localStorage.getItem(KEY)) {
      toast.info('Markup input is now Net Profit Margin. The price is unchanged; only the number you enter changes. 25% markup = 20% NPM.', { duration: 8000 });
      localStorage.setItem(KEY, '1');
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    const fetchAll = async () => {
      const [prodRes, typesRes, cbmRes, cogsRes, nucRes, ohRes, shipRes, stRes, empRes, gsRes, bdRes, chemRes, hwPricesRes, diffRes, locRes, rawRes] = await Promise.all([
        (supabase as any).from('products').select('*').eq('id', id).single(),
        (supabase as any).from('product_types').select('*').order('name'),
        (supabase as any).from('cbm_estimates').select('*').eq('product_id', id).single(),
        (supabase as any).from('cogs_items').select('*').eq('product_id', id).order('sort_order'),
        (supabase as any).from('non_unit_cogs').select('*').eq('product_id', id).order('sort_order'),
        (supabase as any).from('overhead_items').select('*').eq('product_id', id).order('sort_order'),
        (supabase as any).from('shipping_items').select('*').eq('product_id', id),
        (supabase as any).from('shipping_types').select('*').order('name'),
        (supabase as any).from('labor_employees').select('*'),
        (supabase as any).from('global_settings').select('*').limit(1).single(),
        (supabase as any).from('box_data').select('*'),
        (supabase as any).from('chemical_prices').select('*'),
        (supabase as any).from('hardware_prices').select('*').order('name'),
        (supabase as any).from('finishing_difficulty').select('name, adjustment_factor'),
        (supabase as any).from('local_transport_locations').select('id, name, cost_per_cbm_inr, active, sort_order').eq('active', true).order('sort_order'),
        (supabase as any).from('raw_material_costs').select('id, name, cost, unit_type, active'),
      ]);
      if (prodRes.data) setProduct(prodRes.data);
      if (typesRes.data) setProductTypes(typesRes.data);
      if (cbmRes.data) setCbm(cbmRes.data);
      if (cogsRes.data) setCogsItems(cogsRes.data);
      if (nucRes.data) setNonUnitCogs(nucRes.data);
      if (ohRes.data) setOverheadItems(ohRes.data);
      if (shipRes.data) setShippingItems(shipRes.data);

      // Defaults (COGS, overhead, CBM, non-unit COGS) are guaranteed by the DB trigger
      // `trg_seed_product_defaults` which fires on product INSERT. No client-side self-heal
      // is needed and would race with the trigger / cause duplicate rows.

      // Integrity check: warn if seeded row counts look wrong (duplicates).
      // Helps catch regressions where the trigger and a self-heal both fire.
      const cogsRows = (cogsRes.data || []) as Array<{ cogs_type: string; component_name: string | null }>;
      const ohRows = (ohRes.data || []) as Array<{ labor_type: string }>;
      const issues: string[] = [];

      const cogsKeyCounts = new Map<string, number>();
      for (const r of cogsRows) {
        const k = `${r.cogs_type}::${r.component_name ?? ''}`;
        cogsKeyCounts.set(k, (cogsKeyCounts.get(k) || 0) + 1);
      }
      const dupCogs = [...cogsKeyCounts.entries()].filter(([, n]) => n > 1);
      if (dupCogs.length > 0) {
        issues.push(`${dupCogs.length} duplicate COGS row${dupCogs.length === 1 ? '' : 's'} (e.g. ${dupCogs[0][0].split('::').join(' / ')})`);
      }

      const ohKeyCounts = new Map<string, number>();
      for (const r of ohRows) ohKeyCounts.set(r.labor_type, (ohKeyCounts.get(r.labor_type) || 0) + 1);
      const dupOh = [...ohKeyCounts.entries()].filter(([, n]) => n > 1);
      if (dupOh.length > 0) {
        issues.push(`${dupOh.length} duplicate Overhead row${dupOh.length === 1 ? '' : 's'} (e.g. ${dupOh[0][0]})`);
      }

      if (issues.length > 0) {
        console.warn('[ProductCostingTab] data integrity issues for product', id, issues);
        toast.warning('Costing data looks off', {
          description: issues.join(' · ') + '. Contact dev if it persists.',
          duration: 10000,
        });
      }

      // Self-heal: ensure a cbm_estimates row exists
      if (!cbmRes.data) {
        const { data: gs } = await (supabase as any).from('global_settings').select('mc_height_buffer_inch').limit(1).single();
        const { data: newCbm } = await (supabase as any)
          .from('cbm_estimates')
          .insert({ product_id: id, mc_height_buffer_inch: gs?.mc_height_buffer_inch ?? 2.5 })
          .select()
          .single();
        if (newCbm) setCbm(newCbm);
      }
      // Self-heal: ensure default Auto Transport non-unit COGS exists
      if (!nucRes.data || nucRes.data.length === 0) {
        const { data: newNuc } = await (supabase as any).from('non_unit_cogs').insert({
          product_id: id, name: 'Auto Transport', total_quantity: 1, cost_each_inr: 0, include: 'Yes', sort_order: 0,
        }).select();
        if (newNuc) setNonUnitCogs(newNuc);
      }
      if (stRes.data) setShippingTypes(stRes.data);
      if (empRes.data) setEmployees(empRes.data);
      if (gsRes.data) setGlobalSettings(gsRes.data);
      if (bdRes.data) setBoxData(bdRes.data);
      if (chemRes.data) setChemicalPrices(chemRes.data);
      if (hwPricesRes.data) setHardwarePrices(hwPricesRes.data);
      if ((rawRes as any).data) setRawMaterialCosts((rawRes as any).data);
      if (diffRes.error) {
        const msg = `Could not load finishing difficulty options: ${diffRes.error.message}`;
        setDifficultiesError(msg);
        toast.error(msg);
      } else if (!diffRes.data || diffRes.data.length === 0) {
        setDifficultiesError('No finishing difficulty options configured. Add at least one in Settings → Finishing.');
      } else {
        setDifficultiesError(null);
        setDifficulties(diffRes.data);
      }
      if (locRes.error) {
        const msg = `Could not load source locations: ${locRes.error.message}`;
        setLocationsError(msg);
        toast.error(msg);
      } else {
        setLocationsError(null);
        setLocations(locRes.data || []);
      }

      // Fetch inquiry-level overrides if this product belongs to an inquiry
      if (prodRes.data?.customer_rfq_id) {
        const { data: inqData } = await (supabase as any)
          .from('customer_rfqs')
          .select('*')
          .eq('id', prodRes.data.customer_rfq_id)
          .maybeSingle();
        if (inqData) setInquiryOverrides(inqData);
      }

      setDataLoaded(true);
    };
    fetchAll();
  }, [id]);

  useEffect(() => {
    if (!dataLoaded || cogsItems.length === 0) return;
    const rowsToBackfill = cogsItems.filter(shouldBackfillPricedQty);
    if (rowsToBackfill.length === 0) return;

    const ids = rowsToBackfill.map(item => item.id);
    setCogsItems(items => items.map(item => (
      ids.includes(item.id) ? { ...item, components_per_product: 1 } : item
    )));
    void (supabase as any)
      .from('cogs_items')
      .update({ components_per_product: 1 })
      .in('id', ids)
      .then(({ error }: any) => {
        if (error) toast.error('Qty/Prod backfill failed: ' + error.message);
      });
  }, [dataLoaded, cogsItems]);

  // ===== DERIVED CALCULATIONS (Steps 1-12) =====
  // Effective settings = global_settings merged with per-inquiry overrides (if any)
  const effectiveSettings = useMemo(
    () => mergeSettingsWithInquiry(globalSettings as any, inquiryOverrides as any),
    [globalSettings, inquiryOverrides],
  );

  const productType = productTypes.find(t => t.id === product?.product_type_id);
  const w = product?.width_inch || 0;
  const d = product?.depth_inch || 0;
  const h = product?.height_inch || 0;
  const qty = product?.quantity || 100;
  const ri = calc.runningInches(w, d, h);
  const prePackCbm = calc.prePackagedCbm(w, d, h);
  const percentWood = product?.percent_wood || 1;
  const difficulty = product?.finishing_difficulty || 'Medium';
  // Phase 3a: difficulty factor is sourced from the finishing_difficulty DB table;
  // fall back to hardcoded defaults via getDifficultyFactor if the table is empty.
  const difficultyFactor = difficulties.find(d => d.name === difficulty)?.adjustment_factor
    ?? calc.getDifficultyFactor(difficulty);

  // Unique box types for dropdowns
  const uniqueBoxTypes = useMemo(() => {
    const types = [...new Set(boxData.map(b => b.box_type))];
    return types.sort();
  }, [boxData]);

  const icType = cbm?.ic_type || '7 ply';
  const mcType = cbm?.mc_type || '7 ply';

  // Step 2 & 3: IC calcs with type-specific cost lookup
  const icAdd = productType?.pkg_ic_add_per_side_in || 0.5;
  const autoIcDims = calc.calcICDimensions(w, d, h, icAdd);
  // Allow manual overrides: use saved values from cbm if they exist, otherwise auto-calculated
  const icDims = {
    ic_width: cbm?.ic_width ?? autoIcDims.ic_width,
    ic_depth: cbm?.ic_depth ?? autoIcDims.ic_depth,
    ic_height: cbm?.ic_height ?? autoIcDims.ic_height,
  };
  const icBoxes = boxData.filter(b => b.box_type === icType && b.cost_per_sq_in > 0);
  const avgIcCostPerSqIn = icBoxes.length > 0
    ? icBoxes.reduce((s: number, b: any) => s + b.cost_per_sq_in, 0) / icBoxes.length
    : 0;
  const icCost = calc.calcICCostEstimate(icDims.ic_width, icDims.ic_depth, icDims.ic_height, avgIcCostPerSqIn);
  const productsPerIc = cbm?.products_per_ic || 1;

  // Phase 3a: IC OD = IC ID + box offsets from box_data for the selected IC type.
  const icBoxOffsets = calc.getBoxOdOffsets(boxData, icType);
  const icOd = calc.calcIcOd(icDims.ic_width, icDims.ic_depth, icDims.ic_height, icBoxOffsets);
  const icOdVolumeCbm = calc.calcICVolumeCbm(icOd.ic_od_width, icOd.ic_od_depth, icOd.ic_od_height);
  // IC Volume displayed/persisted is the OD volume (used for MC layout and IC-only shipping).
  const icVolume = icOdVolumeCbm;

  // Step 4: MC calcs with type-specific cost lookup
  const packagingType: PackagingType = product?.packaging_type || 'ic_mc';
  const includeMc = packagingType === 'ic_mc';
  const noPackaging = packagingType === 'no_packaging';
  const mcManualLayout = cbm?.mc_manual_layout ?? false;
  const autoMcResult = calc.calcMCPacking({
    include_mc: includeMc,
    mc_type: mcType,
    mc_max_width: cbm?.mc_max_width || 25,
    mc_max_depth: cbm?.mc_max_depth || 25,
    mc_max_height: cbm?.mc_max_height || 25,
    mc_buffer_inch: cbm?.mc_buffer_inch || 1,
    mc_height_buffer_inch: cbm?.mc_height_buffer_inch ?? globalSettings?.mc_height_buffer_inch ?? 2.5,
    mc_weight_limit_kg: cbm?.mc_weight_limit_kg || 20,
    mc_empty_weight_kg: cbm?.mc_empty_weight_kg || 1.5,
    product_weight_kg: product?.weight_kg || 0,
    quantity: qty,
    products_per_ic: productsPerIc,
    ic_width: icDims.ic_width,
    ic_depth: icDims.ic_depth,
    ic_height: icDims.ic_height,
    // Phase 3a: packing layout uses IC OD
    ic_od_width: icOd.ic_od_width,
    ic_od_depth: icOd.ic_od_depth,
    ic_od_height: icOd.ic_od_height,
  });

  // When manual layout override is on, use stored layout values and recompute dims/volume
  const mcResult = (() => {
    if (!mcManualLayout || !includeMc) return autoMcResult;
    const along_w = cbm?.mc_ics_along_w || autoMcResult.mc_ics_along_w;
    const along_d = cbm?.mc_ics_along_d || autoMcResult.mc_ics_along_d;
    const along_h = cbm?.mc_ics_along_h || autoMcResult.mc_ics_along_h;
    const wd_buffer = cbm?.mc_buffer_inch || 1;
    const h_buffer = cbm?.mc_height_buffer_inch ?? globalSettings?.mc_height_buffer_inch ?? 2.5;
    // Use IC OD for manual layout too
    const mc_width = icOd.ic_od_width * along_w + wd_buffer;
    const mc_depth = icOd.ic_od_depth * along_d + wd_buffer;
    const mc_height = icOd.ic_od_height * along_h + h_buffer;
    const mc_volume_cbm = (mc_width * mc_depth * mc_height) / 61020;
    const products_per_mc = along_w * along_d * along_h * productsPerIc;
    return { ...autoMcResult, mc_ics_along_w: along_w, mc_ics_along_d: along_d, mc_ics_along_h: along_h, mc_width, mc_depth, mc_height, mc_volume_cbm, products_per_mc };
  })();

  // Phase 3a: MC OD = MC ID + box offsets from the selected MC type.
  const mcBoxOffsets = calc.getBoxOdOffsets(boxData, mcType);
  const mcOd = calc.calcMcOd(mcResult.mc_width, mcResult.mc_depth, mcResult.mc_height, mcBoxOffsets);
  const mcOdVolumeCbm = includeMc ? (mcOd.mc_od_width * mcOd.mc_od_depth * mcOd.mc_od_height) / 61020 : 0;

  // MC cost estimate
  const mcBoxes = boxData.filter(b => b.box_type === mcType && b.cost_per_sq_in > 0);
  const avgMcCostPerSqIn = mcBoxes.length > 0
    ? mcBoxes.reduce((s: number, b: any) => s + b.cost_per_sq_in, 0) / mcBoxes.length
    : 0;
  let mcCost = calc.calcICCostEstimate(mcResult.mc_width, mcResult.mc_depth, mcResult.mc_height, avgMcCostPerSqIn);

  // Bulk pack: derive MC from pieces/box & shrink so the cost surfaces in COGS
  const isBulkPack = packagingType === 'bulk_pack';
  const bulkPackLocal = isBulkPack ? calc.calcBulkPacking({
    piece_width: w,
    piece_depth: d,
    piece_height: h,
    pieces_per_box: product?.bulk_pieces_per_box || 1,
    shrink_factor: product?.bulk_shrink_factor ?? 1,
    mc_buffer_inch: cbm?.mc_buffer_inch || 1,
    mc_height_buffer_inch: cbm?.mc_height_buffer_inch ?? globalSettings?.mc_height_buffer_inch ?? 2.5,
  }) : null;
  if (bulkPackLocal) {
    mcCost = calc.calcICCostEstimate(bulkPackLocal.mc_width, bulkPackLocal.mc_depth, bulkPackLocal.mc_height, avgMcCostPerSqIn);
  }
  const bulkFoamRow = (rawMaterialCosts as any[]).find((r: any) => r?.active !== false && /foam/i.test(String(r?.name || '')));
  const bulkFoamPricePerSqIn = Number(bulkFoamRow?.cost) || 0;
  const bulkFoamSqInPerPiece = isBulkPack ? calc.surfaceAreaSqIn(w, d, h) : 0;

  // Corrugate + Bubble Wrap packaging (alternative to IC/MC)
  const wrappingResult = useMemo(() => calc.calcCorrugateBubblePackaging(
    w, d, h, icAdd,
    {
      corrugate_kg_per_sq_in: globalSettings?.corrugate_kg_per_sq_in ?? 0.25,
      bubble_kg_per_sq_in: globalSettings?.bubble_kg_per_sq_in ?? 0.20,
      corrugate_price_per_kg: globalSettings?.corrugate_price_per_kg ?? 0,
      bubble_price_per_kg: globalSettings?.bubble_price_per_kg ?? 0,
    },
  ), [w, d, h, icAdd, globalSettings?.corrugate_kg_per_sq_in, globalSettings?.bubble_kg_per_sq_in, globalSettings?.corrugate_price_per_kg, globalSettings?.bubble_price_per_kg]);

  // Phase 3a: shipping CBM uses MC OD (or IC OD if no MC), not ID.
  const finalUnitCbm = noPackaging
    ? prePackCbm
    : packagingType === 'corrugate_bubble'
    ? wrappingResult.final_unit_cbm
    : calc.calcFinalUnitCbm(includeMc, icOdVolumeCbm, productsPerIc, mcOdVolumeCbm, mcResult.products_per_mc);
  const totalCbm = calc.calcTotalCbm(finalUnitCbm, qty);

  // Persist derived CBM values so summary/quotes always use current numbers
  useEffect(() => {
    if (!dataLoaded || !id || !cbm) return;

    const derivedUpdates = {
      ic_width: icDims.ic_width,
      ic_depth: icDims.ic_depth,
      ic_height: icDims.ic_height,
      ic_cost_estimate: icCost,
      ic_volume_cbm: icVolume,
      mc_ics_along_w: mcResult.mc_ics_along_w,
      mc_ics_along_d: mcResult.mc_ics_along_d,
      mc_ics_along_h: mcResult.mc_ics_along_h,
      mc_width: mcResult.mc_width,
      mc_depth: mcResult.mc_depth,
      mc_height: mcResult.mc_height,
      products_per_mc: mcResult.products_per_mc,
      mc_cost_estimate: mcCost,
      mc_volume_cbm: mcResult.mc_volume_cbm,
      final_unit_cbm: finalUnitCbm,
      total_cbm: totalCbm,
      total_weight_kg: (product?.weight_kg || 0) * qty,
    };

    const hasChanges = Object.entries(derivedUpdates).some(([key, value]) => {
      const current = cbm[key as keyof typeof cbm];
      return Math.abs((Number(current) || 0) - (Number(value) || 0)) > 0.0001;
    });

    if (!hasChanges) return;

    setCbm((prev: any) => ({ ...prev, ...derivedUpdates }));
    saveCbm(derivedUpdates);
  }, [
    dataLoaded,
    id,
    cbm?.id,
    icDims.ic_width,
    icDims.ic_depth,
    icDims.ic_height,
    icCost,
    icVolume,
    mcResult.mc_ics_along_w,
    mcResult.mc_ics_along_d,
    mcResult.mc_ics_along_h,
    mcResult.mc_width,
    mcResult.mc_depth,
    mcResult.mc_height,
    mcResult.products_per_mc,
    mcResult.mc_volume_cbm,
    mcCost,
    finalUnitCbm,
    totalCbm,
    product?.weight_kg,
    qty,
    saveCbm,
  ]);

  // Step 5: Auto-populate finishing materials COGS
  //  - Matches by chemical_price_id when set, falls back to category/name heuristic.
  //  - Uses unit-aware pricing (price_per_unit_inr falls back to legacy price_per_litre_inr).
  //  - Supports Wax (grams via surface area).
  useEffect(() => {
    if (!dataLoaded || !product || !productType || cogsItems.length === 0) return;

    const priceOf = (c: any) => Number(c?.price_per_unit_inr ?? c?.price_per_litre_inr ?? 0);
    const unitOf = (c: any) => (c?.unit_type as string) || 'L';
    const byId = (cid: string | null | undefined) => chemicalPrices.find(c => c.id === cid);
    const byCategory = (cat: string, prefer?: (c: any) => boolean) => {
      const matches = chemicalPrices.filter(c => c.category === cat);
      if (prefer) return matches.find(prefer) || matches[0];
      return matches[0];
    };

    const colorQty = ri > 0 ? calc.calcFinishingMaterialQty(productType.finishing_color_per_100ri || 0, ri, percentWood) : 0;
    const sealerQty = ri > 0 ? calc.calcFinishingMaterialQty(productType.finishing_sealer_l_per_100ri || 0, ri, percentWood) : 0;
    const lacquerQty = ri > 0 ? calc.calcFinishingMaterialQty(productType.finishing_lacquer_per_100ri || 0, ri, percentWood) : 0;
    const waxGramsPerSqIn = Number((productType as any).finishing_wax_g_per_sqin ?? 0);
    const waxQty = (calc as any).calcWaxGrams ? (calc as any).calcWaxGrams(w, d, h, waxGramsPerSqIn, percentWood) : 0;

    const autoUpdates: { id: string; components_per_product: number; unit_cost_inr: number; units: string }[] = [];

    cogsItems.forEach(item => {
      if (!item.is_auto_calculated || item.cogs_type !== 'Finishing Materials') return;
      const hasQty = (Number(item.components_per_product) || 0) > 0;
      const hasPrice = (Number(item.unit_cost_inr) || 0) > 0;
      if (hasQty || hasPrice) return;

      const linked = byId((item as any).chemical_price_id);
      const name = (item.component_name || '').toLowerCase();
      let cat: string | undefined = linked?.category;
      if (!cat) {
        if (name.includes('color') || name.includes('stain')) cat = 'Color';
        else if (name.includes('sealer')) cat = 'Sealer';
        else if (name.includes('lacquer')) cat = 'Lacquer';
        else if (name.includes('wax')) cat = 'Wax';
      }
      if (!cat) return;

      const chem = linked || (cat === 'Lacquer'
        ? byCategory('Lacquer', c => (c.name || '').includes('NC'))
        : byCategory(cat));
      const price = priceOf(chem);
      const units = unitOf(chem);
      let qty = 0;
      if (cat === 'Color') qty = colorQty;
      else if (cat === 'Sealer') qty = sealerQty;
      else if (cat === 'Lacquer') qty = lacquerQty;
      else if (cat === 'Wax') qty = waxQty;

      autoUpdates.push({ id: item.id, components_per_product: qty, unit_cost_inr: price, units });
    });

    if (autoUpdates.length > 0) {
      setCogsItems(prev => prev.map(item => {
        const upd = autoUpdates.find(u => u.id === item.id);
        if (!upd) return item;
        return { ...item, components_per_product: upd.components_per_product, unit_cost_inr: upd.unit_cost_inr, units: upd.units };
      }));
      autoUpdates.forEach(upd => {
        (supabase as any).from('cogs_items').update({
          components_per_product: upd.components_per_product,
          unit_cost_inr: upd.unit_cost_inr,
          units: upd.units,
        }).eq('id', upd.id);
      });
    }
  }, [dataLoaded, product?.product_type_id, w, d, h, percentWood, productTypes.length, chemicalPrices.length, cogsItems.length, recalcTick]);

  // Step 5b: Seed default finishing chemicals from product_type_default_chemicals
  // Runs when the product's type is set. Creates a Finishing Materials row for each
  // default chemical that isn't already present (matched by chemical_price_id, or by
  // category for legacy unlinked rows). New rows are flagged is_auto_calculated so
  // the Step 5 effect fills in qty/price on the next pass.
  const seededTypeRef = useRef<string | null>(null);
  useEffect(() => {
    const typeId = product?.product_type_id;
    if (!dataLoaded || !id || !typeId) return;
    if (seededTypeRef.current === typeId) return;
    seededTypeRef.current = typeId;
    (async () => {
      const { data: defaults } = await (supabase as any)
        .from('product_type_default_chemicals')
        .select('chemical_price_id, chemical_price:chemical_prices(id, name, category, unit_type, price_per_unit_inr, price_per_litre_inr)')
        .eq('product_type_id', typeId);
      if (!defaults || defaults.length === 0) return;

      const existingChemIds = new Set(cogsItems.map(i => (i as any).chemical_price_id).filter(Boolean));
      const existingCats = new Set(
        cogsItems
          .filter(i => i.cogs_type === 'Finishing Materials')
          .map(i => {
            const n = (i.component_name || '').toLowerCase();
            if (n.includes('color') || n.includes('stain')) return 'Color';
            if (n.includes('sealer')) return 'Sealer';
            if (n.includes('lacquer')) return 'Lacquer';
            if (n.includes('wax')) return 'Wax';
            return null;
          })
          .filter(Boolean) as string[]
      );

      const baseSort = (cogsItems.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0)) + 1;
      let s = baseSort;
      const rows = defaults
        .filter((d: any) => d.chemical_price && !existingChemIds.has(d.chemical_price.id) && !existingCats.has(d.chemical_price.category))
        .map((d: any) => ({
          product_id: id,
          cogs_type: 'Finishing Materials',
          component_name: d.chemical_price.name,
          chemical_price_id: d.chemical_price.id,
          is_auto_calculated: true,
          include: 'Yes',
          units: d.chemical_price.unit_type || 'L',
          components_per_product: 0,
          unit_cost_inr: Number(d.chemical_price.price_per_unit_inr ?? d.chemical_price.price_per_litre_inr ?? 0),
          sort_order: s++,
        }));
      if (rows.length === 0) return;
      const { data: inserted } = await (supabase as any).from('cogs_items').insert(rows).select();
      if (inserted) setCogsItems(prev => [...prev, ...inserted]);
    })();
  }, [dataLoaded, id, product?.product_type_id, cogsItems.length, recalcTick]);

  // Step 6: Auto-populate packaging COGS (IC Box, MC Box, Corrugate Wrap, Bubble Wrap)
  const wrapCreatingRef = useRef(false);
  useEffect(() => {
    if (!dataLoaded || !product || cogsItems.length === 0 || w === 0) return;

    const isWrapMode = packagingType === 'corrugate_bubble';
    const isIcOnly = packagingType === 'ic_only';
    const isNoPackaging = packagingType === 'no_packaging';

    const updates: { id: string; components_per_product: number; unit_cost_inr: number; include: string; waste_factor: number; units?: string }[] = [];

    cogsItems.forEach(item => {
      if (!item.is_auto_calculated) return;
      const name = (item.component_name || '').toLowerCase();
      if (name.includes('ic box') || name.includes('inner carton') || name === 'ic') {
        const defaultIncluded = !isNoPackaging && !isWrapMode && !isBulkPack;
        updates.push({
          id: item.id,
          components_per_product: defaultIncluded && productsPerIc > 0 ? 1 / productsPerIc : 0,
          unit_cost_inr: defaultIncluded ? icCost : 0,
          include: preserveManualNo(item, defaultIncluded),
          waste_factor: 0.05,
        });
      } else if (name.includes('mc box') || name.includes('master carton') || name.includes('outer carton')) {
        const ppmc = isBulkPack
          ? (bulkPackLocal?.pieces_per_mc || 1)
          : (mcResult.products_per_mc || 1);
        const useMc = !isNoPackaging && !isWrapMode && !isIcOnly && ppmc > 0;
        updates.push({
          id: item.id,
          components_per_product: useMc ? 1 / ppmc : 0,
          unit_cost_inr: useMc ? mcCost : 0,
          include: preserveManualNo(item, useMc),
          waste_factor: 0,
        });
      } else if (name === 'corrugate wrap') {
        const defaultIncluded = !isNoPackaging && isWrapMode;
        updates.push({
          id: item.id,
          components_per_product: defaultIncluded ? wrappingResult.corrugate_kg : 0,
          unit_cost_inr: defaultIncluded ? (globalSettings?.corrugate_price_per_kg ?? 0) : 0,
          include: preserveManualNo(item, defaultIncluded),
          waste_factor: 0,
          units: 'KG',
        });
      } else if (name === 'bubble wrap') {
        const defaultIncluded = !isNoPackaging && isWrapMode;
        updates.push({
          id: item.id,
          components_per_product: defaultIncluded ? wrappingResult.bubble_kg : 0,
          unit_cost_inr: defaultIncluded ? (globalSettings?.bubble_price_per_kg ?? 0) : 0,
          include: preserveManualNo(item, defaultIncluded),
          waste_factor: 0,
          units: 'KG',
        });
      } else if (name.includes('foam') || name.includes('bulk pack')) {
        const defaultIncluded = isBulkPack;
        updates.push({
          id: item.id,
          components_per_product: defaultIncluded ? bulkFoamSqInPerPiece : 0,
          unit_cost_inr: defaultIncluded ? bulkFoamPricePerSqIn : 0,
          include: preserveManualNo(item, defaultIncluded),
          waste_factor: 0,
          units: 'sq in',
        });
      }
    });

    if (updates.length > 0) {
      setCogsItems(prev => prev.map(item => {
        const upd = updates.find(u => u.id === item.id);
        if (!upd) return item;
        return { ...item, ...upd };
      }));
      updates.forEach(upd => {
        const dbUpd: any = {
          components_per_product: upd.components_per_product,
          unit_cost_inr: upd.unit_cost_inr,
          include: upd.include,
          waste_factor: upd.waste_factor,
        };
        if (upd.units) dbUpd.units = upd.units;
        (supabase as any).from('cogs_items').update(dbUpd).eq('id', upd.id);
      });
    }

    // Auto-create Corrugate/Bubble rows on first switch into wrap mode
    if (isWrapMode && !wrapCreatingRef.current) {
      const hasCorrugate = cogsItems.some(i => (i.component_name || '').toLowerCase() === 'corrugate wrap');
      const hasBubble = cogsItems.some(i => (i.component_name || '').toLowerCase() === 'bubble wrap');
      if (!hasCorrugate || !hasBubble) {
        wrapCreatingRef.current = true;
        (async () => {
          const toInsert: any[] = [];
          if (!hasCorrugate) {
            toInsert.push({
              product_id: id, cogs_type: 'Packaging', component_name: 'Corrugate Wrap',
              units: 'KG', components_per_product: wrappingResult.corrugate_kg,
              unit_cost_inr: globalSettings?.corrugate_price_per_kg ?? 0,
              waste_factor: 0, is_auto_calculated: true, include: 'Yes',
              sort_order: cogsItems.length + 100,
            });
          }
          if (!hasBubble) {
            toInsert.push({
              product_id: id, cogs_type: 'Packaging', component_name: 'Bubble Wrap',
              units: 'KG', components_per_product: wrappingResult.bubble_kg,
              unit_cost_inr: globalSettings?.bubble_price_per_kg ?? 0,
              waste_factor: 0, is_auto_calculated: true, include: 'Yes',
              sort_order: cogsItems.length + 101,
            });
          }
          if (toInsert.length) {
            const { data } = await (supabase as any).from('cogs_items').insert(toInsert).select();
            if (data) setCogsItems(prev => [...prev, ...data]);
          }
          wrapCreatingRef.current = false;
        })();
      }
    }
  }, [dataLoaded, icCost, mcCost, productsPerIc, mcResult.products_per_mc, includeMc, packagingType, wrappingResult.corrugate_kg, wrappingResult.bubble_kg, globalSettings?.corrugate_price_per_kg, globalSettings?.bubble_price_per_kg, w, cogsItems.length, recalcTick, id, bulkPackLocal?.pieces_per_mc, bulkFoamSqInPerPiece, bulkFoamPricePerSqIn]);

  // Step 7: Auto-populate Finishing and Packaging overhead MH
  useEffect(() => {
    if (!dataLoaded || !product || !productType || !globalSettings || overheadItems.length === 0 || employees.length === 0) return;

    // Phase 3a: new finishing formula — MH/100RI × adjustment factor × %wood × RI/100
    const finishingMhPer100Ri = productType.finishing_mh_per_100ri ?? 0;
    const finishingMh = calc.calcFinishingMhPerUnit(finishingMhPer100Ri, difficultyFactor, percentWood, ri);

    // Phase 3a: pick packaging MH/CBM rate from product_types based on packaging type.
    const pkgMhPerCbm = calc.packagingMhPerCbmForType(productType, packagingType);
    const packagingMh = noPackaging ? 0 : calc.calcPackagingLaborMhPerUnit(pkgMhPerCbm, finalUnitCbm);

    const ohUpdates: { id: string; man_hours_per_unit: number; include?: string }[] = [];

    overheadItems.forEach(item => {
      if (!item.is_auto_estimated) return;
      if (noPackaging && item.labor_type === 'Packaging') {
        ohUpdates.push({ id: item.id, man_hours_per_unit: 0, include: 'No' });
        return;
      }
      if (item.include === 'No') return;
      if (item.labor_type === 'Finishing' && finishingMh > 0) {
        ohUpdates.push({ id: item.id, man_hours_per_unit: parseFloat(finishingMh.toFixed(4)) });
      } else if (item.labor_type === 'Packaging') {
        ohUpdates.push({ id: item.id, man_hours_per_unit: parseFloat(packagingMh.toFixed(4)) });
      }
    });

    if (ohUpdates.length > 0) {
      setOverheadItems(prev => prev.map(item => {
        const upd = ohUpdates.find(u => u.id === item.id);
        if (!upd) return item;
        return { ...item, man_hours_per_unit: upd.man_hours_per_unit, ...(upd.include ? { include: upd.include } : {}) };
      }));
      ohUpdates.forEach(upd => {
        (supabase as any).from('overhead_items').update({ man_hours_per_unit: upd.man_hours_per_unit, ...(upd.include ? { include: upd.include } : {}) }).eq('id', upd.id);
      });
    }
  }, [dataLoaded, product?.product_type_id, w, d, h, difficulty, difficultyFactor, percentWood, finalUnitCbm, noPackaging, packagingType, globalSettings?.id, employees.length, productTypes.length, overheadItems.length, recalcTick]);

  // Step 7b: Auto-populate "Auto Transport" non-unit COGS — qty = total CBM, cost = rate/CBM
  useEffect(() => {
    if (!dataLoaded || !globalSettings || !product || finalUnitCbm <= 0) return;
    const autoTransportRate = (effectiveSettings as any).auto_transport_cost_per_cbm || 500;
    const transportItem = nonUnitCogs.find(i => i.name === 'Auto Transport');
    if (!transportItem) return;
    if (transportItem.manual_override) return;
    const totalCbm = +(finalUnitCbm * qty).toFixed(4);
    if (Math.abs((transportItem.total_quantity || 0) - totalCbm) < 0.0001 &&
        Math.abs((transportItem.cost_each_inr || 0) - autoTransportRate) < 0.01) return;
    setNonUnitCogs(prev => prev.map(i => i.id === transportItem.id ? { ...i, total_quantity: totalCbm, cost_each_inr: autoTransportRate } : i));
    void (supabase as any).from('non_unit_cogs').update({ total_quantity: totalCbm, cost_each_inr: autoTransportRate }).eq('id', transportItem.id).then(({ error }: any) => { if (error) console.error('Auto Transport update failed:', error); });
  }, [dataLoaded, finalUnitCbm, qty, globalSettings?.id, nonUnitCogs.length, recalcTick]);

  // Step 7c: Auto-create or update Domestic Freight COGS when product has a source_location_id
  const freightCreatingRef = useRef(false);
  useEffect(() => {
    if (!dataLoaded || !id) return;
    const locId = product?.source_location_id;
    const selectedLoc = locId ? locations.find(l => l.id === locId) : null;
    const externallySourced = !!selectedLoc;
    if (!externallySourced || !globalSettings || prePackCbm <= 0) return;
    const freightItem = cogsItems.find(i => i.component_name === 'Domestic Freight (External Sourcing)' && i.is_auto_calculated);
    const transportRate = Number(selectedLoc!.cost_per_cbm_inr) || effectiveSettings.local_transport_cost_per_cbm || 3500;
    if (!freightItem) {
      if (freightCreatingRef.current) return;
      freightCreatingRef.current = true;
      (async () => {
        const { data: existing } = await (supabase as any).from('cogs_items')
          .select('id').eq('product_id', id)
          .eq('component_name', 'Domestic Freight (External Sourcing)')
          .eq('is_auto_calculated', true).limit(1);
        if (existing && existing.length > 0) {
          const { data: row } = await (supabase as any).from('cogs_items').select('*').eq('id', existing[0].id).single();
          if (row) setCogsItems(prev => [...prev, row]);
          freightCreatingRef.current = false;
          return;
        }
        const { data } = await (supabase as any).from('cogs_items').insert({
          product_id: id,
          cogs_type: 'Subcontracting',
          component_name: 'Domestic Freight (External Sourcing)',
          units: 'CBM',
          components_per_product: prePackCbm,
          unit_cost_inr: transportRate,
          waste_factor: 0,
          is_auto_calculated: true,
          include: 'Yes',
          sort_order: cogsItems.length,
        }).select().single();
        if (data) setCogsItems(prev => prev.some(i => i.id === data.id) ? prev : [...prev, data]);
        freightCreatingRef.current = false;
      })();
      return;
    }
    if (Math.abs((freightItem.components_per_product || 0) - prePackCbm) < 0.0001 &&
        Math.abs((freightItem.unit_cost_inr || 0) - transportRate) < 0.01) return;
    setCogsItems(prev => prev.map(i => i.id === freightItem.id ? { ...i, components_per_product: prePackCbm, unit_cost_inr: transportRate } : i));
    (supabase as any).from('cogs_items').update({ components_per_product: prePackCbm, unit_cost_inr: transportRate }).eq('id', freightItem.id);
  }, [dataLoaded, prePackCbm, product?.source_location_id, locations, globalSettings?.id, cogsItems.length, recalcTick]);

  // === Shared costing engine: single source of truth for final aggregate values ===
  // The inline IC/MC/wrapping/CBM calculations above still drive the CBM section UI
  // and CBM persistence effect; for the standard auto-packing path they equal the
  // engine's internal values exactly (the engine was ported byte-for-byte from this
  // same code in Part 1). The engine values displayed in the summary now match what
  // product-pricing.ts uses for the inquiry list, quote generation, and analytics.
  const engine = useMemo(() => {
    if (!dataLoaded || !product) return null;
    return computeProductCosting({
      product,
      cogsItems,
      nonUnitCogs,
      overheadItems,
      shippingItems,
      cbmRow: cbm,
      productType,
      boxData,
      chemicalPrices,
      shippingTypes,
      laborEmployees: employees,
      globalSettings,
      inquiryOverrides,
      locations,
      difficulties,
      rawMaterialCosts,
    });
  }, [dataLoaded, product, cogsItems, nonUnitCogs, overheadItems, shippingItems, cbm, productType, boxData, chemicalPrices, shippingTypes, employees, globalSettings, inquiryOverrides, locations, difficulties, rawMaterialCosts]);

  // Direct overhead breakdown for display (per-row hourly rate × MH × qty).
  // Kept inline because the per-row breakdown is shown in the Overhead section UI;
  // the totals below come from the engine.
  const ohItems = overheadItems.map(item => ({
    include: noPackaging && item.labor_type === 'Packaging' ? 'No' : item.include,
    labor_type: item.labor_type,
    man_hours_per_unit: noPackaging && item.labor_type === 'Packaging' ? 0 : item.man_hours_per_unit || 0,
    hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
  }));
  const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
  const indirectOhPerMh = effectiveSettings && globalSettings ? calc.calcIndirectOhPerManHour(effectiveSettings as any) : 0;

  // Shipping selection — UI needs shipItem/shipType for the dropdown and labels
  const shipItem = shippingItems[0];
  const overrideShipType = inquiryOverrides?.shipping_type_id_override
    ? shippingTypes.find(s => s.id === inquiryOverrides.shipping_type_id_override)
    : null;
  const shipType = overrideShipType || shippingTypes.find(s => s.id === shipItem?.shipping_type_id);

  // Auto-assign default shipping type if none set
  useEffect(() => {
    if (!dataLoaded || !globalSettings || shippingItems.length > 0 || shippingTypes.length === 0) return;
    const defaultName = globalSettings.default_shipping_type;
    const defaultType = shippingTypes.find(s => s.name === defaultName) || shippingTypes[0];
    if (defaultType && id) {
      (supabase as any).from('shipping_items').insert({ product_id: id, shipping_type_id: defaultType.id }).select().single()
        .then(({ data }: any) => { if (data) setShippingItems([data]); });
    }
  }, [dataLoaded, globalSettings?.id, shippingTypes.length, shippingItems.length]);

  const cogsHasReview = cogsItems.some(i => i.include === 'Review');
  const overheadHasReview = overheadItems.some(i => i.include === 'Review');

  // === Engine-sourced final aggregates ===
  const cogsPerUnit = engine?.cogsPerUnit ?? 0;
  const nonUnitCogsPerUnit = engine?.nonUnitCogsPerUnit ?? 0;
  const directOhPerUnit = engine?.directOhPerUnit ?? 0;
  const indirectOhPerUnit = engine?.indirectOhPerUnit ?? 0;
  const shippingPerUnit = engine?.shippingPerUnit ?? 0;
  const exchangeRate = engine?.exchangeRate ?? (globalSettings?.exchange_rate ?? 90);
  const markupPercent = engine?.markupPercent ?? (product?.markup_percent ?? 0.2);
  const summary = engine?.summary ?? calc.calcProductCostSummary(
    0, 0, 0, 0, 0, markupPercent, exchangeRate, qty,
  );

  // Report summary up to parent (ProductDetail header)
  useEffect(() => {
    if (!onSummaryChange || !dataLoaded) return;
    onSummaryChange({
      unitPriceInr: summary.unit_price_inr,
      unitPriceUsd: summary.unit_price_usd,
      unitCostInr: summary.product_cost_per_unit_inr,
      unitCostUsd: summary.product_cost_per_unit_usd,
      exchangeRate,
    });
  }, [summary.unit_price_inr, summary.unit_price_usd, summary.product_cost_per_unit_inr, summary.product_cost_per_unit_usd, exchangeRate, dataLoaded]);

  // Persist calculated price/cost to products table so other screens (inquiry list, dashboard)
  // can show the exact same number as the costing sheet without recomputing.
  useEffect(() => {
    if (!dataLoaded || !product?.id) return;
    const priceUsd = Number.isFinite(summary.unit_price_usd) ? +summary.unit_price_usd.toFixed(4) : null;
    const costUsd = Number.isFinite(summary.product_cost_per_unit_usd) ? +summary.product_cost_per_unit_usd.toFixed(4) : null;
    if (priceUsd === null && costUsd === null) return;
    if ((product as any).calculated_unit_price_usd === priceUsd && (product as any).calculated_unit_cost_usd === costUsd) return;
    let written = false;
    const writeNow = () => {
      if (written) return;
      written = true;
      (supabase as any).from('products').update({
        calculated_unit_price_usd: priceUsd,
        calculated_unit_cost_usd: costUsd,
      }).eq('id', product.id).then(() => {
        onProductUpdated?.();
      });
    };
    const t = setTimeout(writeNow, 600);
    return () => {
      clearTimeout(t);
      // Flush on cleanup so navigation doesn't lose the latest value
      writeNow();
    };
  }, [summary.unit_price_usd, summary.product_cost_per_unit_usd, dataLoaded, product?.id, onProductUpdated]);

  // COGS item update helper
  const updateCogsItem = async (itemId: string, field: string, value: any) => {
    // If user edits an auto-calculated field, mark it as manual
    const updates: any = { [field]: value };
    const item = cogsItems.find(i => i.id === itemId);
    if (field === 'include' && item?.cogs_type === 'Packaging' && value === 'No') {
      updates.is_auto_calculated = false;
    }
    if (field === 'components_per_product' || field === 'unit_cost_inr') {
      updates.is_auto_calculated = false;
    }
    setCogsItems(items => items.map(i => i.id === itemId ? { ...i, ...updates } : i));
    await (supabase as any).from('cogs_items').update(updates).eq('id', itemId);
  };

  // Overhead item update helper
  const updateOverheadItem = async (itemId: string, field: string, value: any) => {
    const updates: any = { [field]: value };
    if (field === 'man_hours_per_unit') {
      updates.is_auto_estimated = false;
    }
    setOverheadItems(items => items.map(i => i.id === itemId ? { ...i, ...updates } : i));
    await (supabase as any).from('overhead_items').update(updates).eq('id', itemId);
  };

  // Shipping update
  const setShippingType = async (shippingTypeId: string) => {
    if (shipItem) {
      await (supabase as any).from('shipping_items').update({ shipping_type_id: shippingTypeId }).eq('id', shipItem.id);
      setShippingItems(items => items.map(i => i.id === shipItem.id ? { ...i, shipping_type_id: shippingTypeId } : i));
    } else {
      const { data } = await (supabase as any).from('shipping_items').insert({ product_id: id, shipping_type_id: shippingTypeId }).select().single();
      if (data) setShippingItems([data]);
    }
  };

  if (!product) return <div className="text-center py-12 text-muted-foreground">Loading product...</div>;

  if (isMobile) {
    return (
      <ProductCostingTabMobile
        productId={id}
        product={product}
        setProduct={setProduct}
        productTypes={productTypes}
        cbm={cbm}
        cogsItems={cogsItems}
        setCogsItems={setCogsItems}
        nonUnitCogs={nonUnitCogs}
        setNonUnitCogs={setNonUnitCogs}
        overheadItems={overheadItems}
        setOverheadItems={setOverheadItems}
        shippingItems={shippingItems}
        shippingTypes={shippingTypes}
        employees={employees}
        globalSettings={globalSettings}
        hardwarePrices={hardwarePrices}
        chemicalPrices={chemicalPrices}
        ri={ri}
        prePackCbm={prePackCbm}
        finalUnitCbm={finalUnitCbm}
        totalCbm={totalCbm}
        cogsPerUnit={cogsPerUnit}
        nonUnitCogsPerUnit={nonUnitCogsPerUnit}
        directOhPerUnit={directOhPerUnit}
        indirectOhPerUnit={indirectOhPerUnit}
        totalDirectMhPerUnit={totalDirectMhPerUnit}
        indirectOhPerMh={indirectOhPerMh}
        shippingPerUnit={shippingPerUnit}
        exchangeRate={exchangeRate}
        markupPercent={markupPercent}
        qty={qty}
        summary={summary}
        shipItem={shipItem}
        updateProduct={updateProduct}
        updateCbm={updateCbm}
        updateCogsItem={updateCogsItem}
        updateOverheadItem={updateOverheadItem}
        setShippingType={setShippingType}
        recalculateAllAutoCosts={recalculateAllAutoCosts}
        recalcing={recalcing}
      />
    );
  }

  return (
    <div className="space-y-2">
        <ProductVendorsPanel productId={id} />

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={recalculateAllAutoCosts} disabled={recalcing}>
            {recalcing ? 'Recalculating…' : 'Recalculate all auto costs'}
          </Button>
        </div>

        {/* Section A: Product Info */}
        <Collapsible open={sections.info} onOpenChange={() => toggle('info')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="A. Product Info" open={sections.info} onToggle={() => {}} badge={`RI: ${ri.toFixed(1)}″ | Pre-pkg: ${fmt.cbm(prePackCbm)}`} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="py-2 px-1 space-y-2">
              {/* Product Photo */}
              <div className="flex items-start gap-3 mb-2">
                <div className="relative group">
                  {product.photo_url ? (
                    <div className="relative">
                      <img src={product.photo_url} alt={product.name} className="h-20 w-20 object-cover rounded-md border" />
                      <button
                        onClick={async () => {
                          updateProduct('photo_url', null);
                        }}
                        className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="h-20 w-20 border-2 border-dashed rounded-md flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
                      <Camera className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[8px] text-muted-foreground mt-0.5">Add Photo</span>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !id) return;
                          const ext = file.name.split('.').pop() || 'jpg';
                          const path = `${id}.${ext}`;
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
                <div className="flex-1 grid grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Name</label>
                <Input className="h-7 text-xs" defaultValue={product.name} onBlur={e => updateProduct('name', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">SKU</label>
                <Input className="h-7 text-xs" defaultValue={product.sku || ''} onBlur={e => updateProduct('sku', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Quantity</label>
                <Input className="h-7 text-xs" type="number" defaultValue={qty} onBlur={e => updateProduct('quantity', parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">MOQ</label>
                <Input className="h-7 text-xs" type="number" defaultValue={product.moq || 50} onBlur={e => updateProduct('moq', parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground" title="Absolute floor — customer cannot order less than this. Between Hard MOQ and MOQ, the below-MOQ surcharge applies.">Hard MOQ</label>
                <Input className="h-7 text-xs" type="number" defaultValue={(product as any).hard_moq ?? ''} placeholder={String(product.moq || 50)}
                  onBlur={e => updateProduct('hard_moq', e.target.value === '' ? null : parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Width (in)</label>
                <Input className="h-7 text-xs" type="number" defaultValue={w || ''} onBlur={e => updateProduct('width_inch', Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Depth (in)</label>
                <Input className="h-7 text-xs" type="number" defaultValue={d || ''} onBlur={e => updateProduct('depth_inch', Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Height (in)</label>
                <Input className="h-7 text-xs" type="number" defaultValue={h || ''} onBlur={e => updateProduct('height_inch', Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Weight (kg)</label>
                <Input className="h-7 text-xs" type="number" defaultValue={product.weight_kg || ''} onBlur={e => updateProduct('weight_kg', Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Product Type</label>
                <Select value={product.product_type_id || ''} onValueChange={v => updateProduct('product_type_id', v)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {productTypes.map(pt => (
                      <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Packaging Type</label>
                <Select
                  value={packagingType}
                  onValueChange={async (v) => {
                    // Keep legacy include_mc flag in sync for downstream code
                    updateProduct('packaging_type', v);
                    const nextIncludeMc = v === 'ic_mc';
                    if ((cbm?.include_mc ?? true) !== nextIncludeMc) {
                      updateCbm('include_mc', nextIncludeMc);
                    }
                    const packagingUpdates = cogsItems
                      .filter(item => item.cogs_type === 'Packaging')
                      .map(item => ({ id: item.id, include: packagingIncludeForType(v, item.component_name, v === 'no_packaging') }));
                    const validPackagingUpdates = packagingUpdates.filter(update => update.include !== null);
                    if (validPackagingUpdates.length > 0) {
                      setCogsItems(items => items.map(item => {
                        const update = validPackagingUpdates.find(u => u.id === item.id);
                        return update ? { ...item, include: update.include ? 'Yes' : 'No' } : item;
                      }));
                      validPackagingUpdates.forEach(update => {
                        (supabase as any).from('cogs_items').update({ include: update.include ? 'Yes' : 'No' }).eq('id', update.id);
                      });
                    }
                    if (v === 'no_packaging') {
                      const packagingOverheadIds = overheadItems.filter(item => item.labor_type === 'Packaging').map(item => item.id);
                      if (packagingOverheadIds.length > 0) {
                        setOverheadItems(items => items.map(item => packagingOverheadIds.includes(item.id) ? { ...item, include: 'No', man_hours_per_unit: 0 } : item));
                        (supabase as any).from('overhead_items').update({ include: 'No', man_hours_per_unit: 0 }).in('id', packagingOverheadIds);
                      }
                    }
                    if (v === 'bulk_pack') {
                      // Ensure a Bulk Foam auto-calc row exists
                      const hasFoam = cogsItems.some(i => i.cogs_type === 'Packaging' && /foam|bulk pack/i.test(i.component_name || ''));
                      if (!hasFoam) {
                        const { data: newRow } = await (supabase as any).from('cogs_items').insert({
                          product_id: id, cogs_type: 'Packaging', component_name: 'Bulk Foam',
                          is_auto_calculated: true, waste_factor: 0, include: 'Yes', units: 'sq in', sort_order: 99,
                        }).select().single();
                        if (newRow) setCogsItems(items => [...items, newRow]);
                      }
                    }
                  }}
                >
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ic_only">IC only</SelectItem>
                    <SelectItem value="ic_mc">IC + MC</SelectItem>
                    <SelectItem value="corrugate_bubble">Corrugate + Bubble Wrap</SelectItem>
                    <SelectItem value="bulk_pack">Bulk Pack (single stack)</SelectItem>
                    <SelectItem value="no_packaging">No packaging</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Difficulty</label>
                <Select value={product.finishing_difficulty || 'Medium'} onValueChange={v => {
                  updateProduct('finishing_difficulty', v);
                  // Immediately recompute Finishing overhead MH/unit with the new difficulty.
                  const newFactor = difficulties.find(x => x.name === v)?.adjustment_factor
                    ?? calc.getDifficultyFactor(v);
                  const finishingMhPer100Ri = productType?.finishing_mh_per_100ri ?? 0;
                  const newFinishingMh = calc.calcFinishingMhPerUnit(finishingMhPer100Ri, newFactor, percentWood, ri);
                  const finRows = overheadItems.filter(i => i.labor_type === 'Finishing');
                  if (finRows.length) {
                    const mh = parseFloat(newFinishingMh.toFixed(4));
                    setOverheadItems(prev => prev.map(i => i.labor_type === 'Finishing'
                      ? { ...i, man_hours_per_unit: mh, is_auto_estimated: true }
                      : i));
                    finRows.forEach(r => {
                      (supabase as any).from('overhead_items')
                        .update({ man_hours_per_unit: mh, is_auto_estimated: true })
                        .eq('id', r.id);
                    });
                  }
                }}>


                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(difficulties.length > 0 ? difficulties.map(d => d.name) : DIFFICULTIES).map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                {difficultiesError && (
                  <p className="text-[10px] text-destructive mt-1">⚠ {difficultiesError}</p>
                )}
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">% Wood</label>
                <Select
                  value={String(Math.round((product.percent_wood ?? 1) * 100))}
                  onValueChange={(v) => updateProduct('percent_wood', Number(v) / 100)}
                >
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 21 }, (_, i) => i * 5).map(p => (
                      <SelectItem key={p} value={String(p)}>{p}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Target Price (USD)</label>
                <Input className="h-7 text-xs" type="number" defaultValue={product.target_price_usd || ''} onBlur={e => updateProduct('target_price_usd', Number(e.target.value) || null)} />
              </div>
              <div className="col-span-2 pt-2">
                <label className="text-[10px] text-muted-foreground">Source Location</label>
                <Select
                  value={product.source_location_id || '__inhouse__'}
                  onValueChange={async (v) => {
                    const newLocId = v === '__inhouse__' ? null : v;
                    setProduct((p: any) => ({ ...p, source_location_id: newLocId }));
                    await (supabase as any).from('products').update({ source_location_id: newLocId }).eq('id', id);
                    if (!newLocId) {
                      const freightItems = cogsItems.filter(i => i.component_name === 'Domestic Freight (External Sourcing)');
                      for (const fi of freightItems) {
                        await (supabase as any).from('cogs_items').delete().eq('id', fi.id);
                      }
                      setCogsItems(prev => prev.filter(i => i.component_name !== 'Domestic Freight (External Sourcing)'));
                    }
                    onProductUpdated?.();
                  }}
                >
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__inhouse__">In-house (Jodhpur)</SelectItem>
                    {locations.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name} — ₹{Number(loc.cost_per_cbm_inr).toLocaleString()}/CBM</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {locationsError && (
                  <p className="text-[10px] text-destructive mt-1">⚠ {locationsError}</p>
                )}
                {product.source_location_id && (() => {
                  const loc = locations.find(l => l.id === product.source_location_id);
                  const rate = loc?.cost_per_cbm_inr || 0;
                  return (
                    <p className="text-[10px] text-muted-foreground mt-1">Domestic freight ₹{Number(rate).toLocaleString()}/CBM × {prePackCbm.toFixed(4)} CBM added to COGS</p>
                  );
                })()}
              </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Quote Notes (shown to customer)</label>
                <Textarea
                  className="text-xs min-h-[60px]"
                  rows={2}
                  defaultValue={product.quote_notes || ''}
                  placeholder="Notes that appear on the customer quote under the product name…"
                  onBlur={e => {
                    const v = e.target.value;
                    if (v !== (product.quote_notes || '')) updateProduct('quote_notes', v || null, true);
                  }}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section B: CBM Calculator */}
        <Collapsible open={sections.cbm} onOpenChange={() => toggle('cbm')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="B. CBM Calculator" open={sections.cbm} onToggle={() => {}} badge={`Unit: ${fmt.cbm(finalUnitCbm)} | Total: ${fmt.cbm(totalCbm)}`} done={product.cbm_done} onDoneChange={(v) => updateProduct('cbm_done', v, true)} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="py-2 px-1 space-y-3">
              {packagingType === 'corrugate_bubble' ? (
                <>
                  <div className="grid grid-cols-6 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Wrapped W (in)</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{wrappingResult.wrapped_w.toFixed(2)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Wrapped D (in)</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{wrappingResult.wrapped_d.toFixed(2)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Wrapped H (in)</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{wrappingResult.wrapped_h.toFixed(2)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Surface Area (sq in)</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{wrappingResult.surface_area_sq_in.toFixed(1)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Final Unit CBM</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.cbm(finalUnitCbm)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Total CBM</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.cbm(totalCbm)}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <div className="p-2 rounded-md border border-border/50 bg-muted/30">
                      <div className="text-[10px] font-medium text-muted-foreground mb-1">Corrugate Wrap (per unit)</div>
                      <div className="text-xs">{wrappingResult.corrugate_kg.toFixed(3)} kg × {fmt.inr(globalSettings?.corrugate_price_per_kg ?? 0)}/kg = <span className="font-semibold">{fmt.inr(wrappingResult.corrugate_cost)}</span></div>
                    </div>
                    <div className="p-2 rounded-md border border-border/50 bg-muted/30">
                      <div className="text-[10px] font-medium text-muted-foreground mb-1">Bubble Wrap (per unit)</div>
                      <div className="text-xs">{wrappingResult.bubble_kg.toFixed(3)} kg × {fmt.inr(globalSettings?.bubble_price_per_kg ?? 0)}/kg = <span className="font-semibold">{fmt.inr(wrappingResult.bubble_cost)}</span></div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Box-data lookups are skipped in this mode. Wrap quantities flow into COGS as auto-calculated rows.</p>
                </>
              ) : packagingType === 'bulk_pack' ? (
                <>
                  <div className="grid grid-cols-6 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">MC Type</label>
                      <Select value={mcType} onValueChange={v => updateCbm('mc_type', v)}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {uniqueBoxTypes.map(bt => <SelectItem key={bt} value={bt}>{bt}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Pieces per box</label>
                      <Input className="h-7 text-xs" type="number" min={1} step={1}
                        defaultValue={product.bulk_pieces_per_box ?? 1}
                        onBlur={e => updateProduct('bulk_pieces_per_box', Math.max(1, parseInt(e.target.value) || 1))} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground" title="How much height EACH ADDITIONAL piece adds, as a % of one piece's height. 100 = no nesting, each piece stacks fully. 25 = deep nesting, each extra piece only adds a quarter of its height. For NO shrink/nesting, use 100.">Height per extra piece (%)</label>
                      <Input className="h-7 text-xs" type="number" min={0} max={100} step={1}
                        defaultValue={Math.round(((product.bulk_shrink_factor ?? 1) * 100))}
                        onBlur={e => updateProduct('bulk_shrink_factor', Math.min(1, Math.max(0, Number(e.target.value) / 100)))} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">MC W/D Buffer (in)</label>
                      <Input className="h-7 text-xs" type="number" step="0.1" defaultValue={cbm?.mc_buffer_inch ?? 1} onBlur={e => updateCbm('mc_buffer_inch', Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">MC H Buffer (in)</label>
                      <Input className="h-7 text-xs" type="number" step="0.1" defaultValue={cbm?.mc_height_buffer_inch ?? globalSettings?.mc_height_buffer_inch ?? 2.5} onBlur={e => updateCbm('mc_height_buffer_inch', Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Foam</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">2 mm/piece</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Column Height (in)</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{(engine?.bulkPack?.column_height_in ?? 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">MC Inner</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.dim(engine?.bulkPack?.mc_width ?? 0, engine?.bulkPack?.mc_depth ?? 0, engine?.bulkPack?.mc_height ?? 0)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">MC CBM</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.cbm(engine?.bulkPack?.mc_volume_cbm ?? 0)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Per-unit CBM</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.cbm(finalUnitCbm)}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Pieces/MC</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{engine?.bulkPack?.pieces_per_mc ?? 0}</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">MC Cost</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.inr(mcCost)}</span>
                    </div>
                  </div>
                  {engine?.bulkPack?.warning && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15 px-2 py-1 rounded">⚠ {engine.bulkPack.warning}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">Single vertical stack. Box size is derived from your chosen pieces/box and shrink %. Foam (2 mm) is priced from raw_material_costs by name "Foam".</p>
                </>
              ) : (
              <>
              <div className="grid grid-cols-6 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Type</label>
                  <Select value={icType} onValueChange={v => updateCbm('ic_type', v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {uniqueBoxTypes.map(bt => (
                        <SelectItem key={bt} value={bt}>{bt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Products/IC</label>
                  <Input className="h-7 text-xs" type="number" defaultValue={productsPerIc} onBlur={e => updateCbm('products_per_ic', parseInt(e.target.value))} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Width</label>
                  <Input className="h-7 text-xs" type="number" step="0.1"
                    value={icDims.ic_width}
                    onChange={e => updateCbm('ic_width', Number(e.target.value))}
                    placeholder={String(autoIcDims.ic_width)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Depth</label>
                  <Input className="h-7 text-xs" type="number" step="0.1"
                    value={icDims.ic_depth}
                    onChange={e => updateCbm('ic_depth', Number(e.target.value))}
                    placeholder={String(autoIcDims.ic_depth)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Height</label>
                  <Input className="h-7 text-xs" type="number" step="0.1"
                    value={icDims.ic_height}
                    onChange={e => updateCbm('ic_height', Number(e.target.value))}
                    placeholder={String(autoIcDims.ic_height)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Cost</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.inr(icCost)}</span>
                </div>
              </div>

              {includeMc && (
                <div className="flex items-center gap-4">
                  <span className="text-xs font-medium">Master Carton Type:</span>
                  <div className="w-36">
                    <Select value={mcType} onValueChange={v => updateCbm('mc_type', v)}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {uniqueBoxTypes.map(bt => (
                          <SelectItem key={bt} value={bt}>{bt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {includeMc && (
                <div className="grid grid-cols-6 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">MC Max W</label>
                    <Input className="h-7 text-xs" type="number" defaultValue={cbm?.mc_max_width || 25} onBlur={e => updateCbm('mc_max_width', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">MC Max D</label>
                    <Input className="h-7 text-xs" type="number" defaultValue={cbm?.mc_max_depth || 25} onBlur={e => updateCbm('mc_max_depth', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">MC Max H</label>
                    <Input className="h-7 text-xs" type="number" defaultValue={cbm?.mc_max_height || 25} onBlur={e => updateCbm('mc_max_height', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">MC W/D Buffer (in)</label>
                    <Input className="h-7 text-xs" type="number" step="0.1" defaultValue={cbm?.mc_buffer_inch ?? 1} onBlur={e => updateCbm('mc_buffer_inch', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">MC H Buffer (in)</label>
                    <Input className="h-7 text-xs" type="number" step="0.1" defaultValue={cbm?.mc_height_buffer_inch ?? globalSettings?.mc_height_buffer_inch ?? 2.5} onBlur={e => updateCbm('mc_height_buffer_inch', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Weight Limit (kg)</label>
                    <Input className="h-7 text-xs" type="number" defaultValue={cbm?.mc_weight_limit_kg || 20} onBlur={e => updateCbm('mc_weight_limit_kg', Number(e.target.value))} />
                  </div>
                </div>
              )}

              {includeMc && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={mcManualLayout} onCheckedChange={(v) => updateCbm('mc_manual_layout', !!v)} id="mc-manual" />
                    <label htmlFor="mc-manual" className="text-[10px] text-muted-foreground cursor-pointer">Manual layout override</label>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    <div><label className="text-[10px] text-muted-foreground">ICs along W</label>
                      {mcManualLayout ? (
                        <Input className="h-7 text-xs" type="number" min={1} defaultValue={mcResult.mc_ics_along_w} onBlur={e => updateCbm('mc_ics_along_w', Math.max(1, Number(e.target.value) || 1))} />
                      ) : (
                        <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{mcResult.mc_ics_along_w}</span>
                      )}
                    </div>
                    <div><label className="text-[10px] text-muted-foreground">ICs along D</label>
                      {mcManualLayout ? (
                        <Input className="h-7 text-xs" type="number" min={1} defaultValue={mcResult.mc_ics_along_d} onBlur={e => updateCbm('mc_ics_along_d', Math.max(1, Number(e.target.value) || 1))} />
                      ) : (
                        <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{mcResult.mc_ics_along_d}</span>
                      )}
                    </div>
                    <div><label className="text-[10px] text-muted-foreground">ICs along H</label>
                      {mcManualLayout ? (
                        <Input className="h-7 text-xs" type="number" min={1} defaultValue={mcResult.mc_ics_along_h} onBlur={e => updateCbm('mc_ics_along_h', Math.max(1, Number(e.target.value) || 1))} />
                      ) : (
                        <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{mcResult.mc_ics_along_h}</span>
                      )}
                    </div>
                    <div><label className="text-[10px] text-muted-foreground">Products/MC</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{mcResult.products_per_mc}</span>
                    </div>
                    <div><label className="text-[10px] text-muted-foreground">MC Dims</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.dim(mcResult.mc_width, mcResult.mc_depth, mcResult.mc_height)}</span>
                    </div>
                    <div><label className="text-[10px] text-muted-foreground">MC Volume</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.cbm(mcResult.mc_volume_cbm)}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    <div><label className="text-[10px] text-muted-foreground">MC Cost</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.inr(mcCost)}</span>
                    </div>
                    <div><label className="text-[10px] text-muted-foreground">Final Unit CBM</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.cbm(finalUnitCbm)}</span>
                    </div>
                  </div>
                </div>
              )}

              {!includeMc && (
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="text-[10px] text-muted-foreground">IC Volume</label>
                    <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.cbm(icVolume)}</span>
                  </div>
                  <div><label className="text-[10px] text-muted-foreground">Final Unit CBM</label>
                    <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.cbm(finalUnitCbm)}</span>
                  </div>
                  <div><label className="text-[10px] text-muted-foreground">Total CBM</label>
                    <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.cbm(totalCbm)}</span>
                  </div>
                </div>
              )}
              </>
              )}

              {/* Carton Summary */}
              <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-border/50 space-y-1.5">
                <div className="text-xs">
                  <div className="flex items-center gap-2">
                    <span>📦</span>
                    <span className="font-medium">Inner Carton OD:</span>
                    <span>{fmt.dim(icOd.ic_od_width, icOd.ic_od_depth, icOd.ic_od_height)}</span>
                    <span className="text-muted-foreground">({fmt.cbm(icOdVolumeCbm)})</span>
                    <span className="text-muted-foreground">— {icType}</span>
                    <span className="text-muted-foreground">— {fmt.inr(icCost)}/box</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground ml-6">
                    (ID: {fmt.dim(icDims.ic_width, icDims.ic_depth, icDims.ic_height)} — {fmt.cbm(icVolume)})
                  </div>
                </div>
                {includeMc && (
                  <>
                    <div className="text-xs">
                      <div className="flex items-center gap-2">
                        <span>📦</span>
                        <span className="font-medium">Master Carton OD:</span>
                        <span>{fmt.dim(mcOd.mc_od_width, mcOd.mc_od_depth, mcOd.mc_od_height)}</span>
                        <span className="text-muted-foreground">({fmt.cbm(mcOdVolumeCbm)})</span>
                        <span className="text-muted-foreground">— {mcType}</span>
                        <span className="text-muted-foreground">— {fmt.inr(mcCost)}/box</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground ml-6">
                        (ID: {fmt.dim(mcResult.mc_width, mcResult.mc_depth, mcResult.mc_height)} — {fmt.cbm(mcResult.mc_volume_cbm)})
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground ml-6">
                      └── {productsPerIc} product{productsPerIc > 1 ? 's' : ''} per IC, {mcResult.products_per_mc} product{mcResult.products_per_mc > 1 ? 's' : ''} per MC
                    </div>
                  </>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section C: COGS */}
        <Collapsible open={sections.cogs} onOpenChange={() => toggle('cogs')}>
          <div className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <div className="flex-1 min-w-0"><SectionHeader title="C. COGS (Bill of Materials)" open={sections.cogs} onToggle={() => {}} badge={`${fmt.inr(cogsPerUnit)}/unit`} done={product.cogs_done} hasReview={cogsHasReview} onDoneChange={(v) => updateProduct('cogs_done', v, true)} /></div>
            </CollapsibleTrigger>
            {sections.cogs && (
              <ProductChemicalsPicker
                productId={id!}
                chemicals={chemicalPrices}
                cogsItems={cogsItems}
                onChanged={() => {
                  (supabase as any).from('cogs_items').select('*').eq('product_id', id).order('sort_order')
                    .then(({ data }: any) => { if (data) setCogsItems(data); });
                }}
              />
            )}
          </div>
          <CollapsibleContent>
            <div className="overflow-auto">
              <Table className="dense-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={cogsItems.length > 0 && selectedCogsIds.size === cogsItems.length}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedCogsIds(new Set(cogsItems.map(i => i.id)));
                          else setSelectedCogsIds(new Set());
                        }}
                        aria-label="Select all COGS rows"
                      />
                    </TableHead>
                    <ResizableTableHead storageKey="cogs.include" defaultWidth={56} minWidth={48}>Include</ResizableTableHead>
                    <ResizableTableHead storageKey="cogs.type" defaultWidth={104} minWidth={70}>Type</ResizableTableHead>
                    <ResizableTableHead storageKey="cogs.component" defaultWidth={150} minWidth={90}>Component</ResizableTableHead>
                    <ResizableTableHead storageKey="cogs.vendor" defaultWidth={140} minWidth={70}>Vendor</ResizableTableHead>
                    <ResizableTableHead storageKey="cogs.units" defaultWidth={56} minWidth={40}>Units</ResizableTableHead>
                    <ResizableTableHead storageKey="cogs.qty" defaultWidth={112} minWidth={70} align="right">Qty/Prod</ResizableTableHead>
                    <ResizableTableHead storageKey="cogs.cost" defaultWidth={112} minWidth={70} align="right">Cost (₹)</ResizableTableHead>
                    <ResizableTableHead storageKey="cogs.waste" defaultWidth={68} minWidth={50} align="right">Waste%</ResizableTableHead>
                    <ResizableTableHead storageKey="cogs.unitcost" defaultWidth={112} minWidth={70} align="right">Unit Cost</ResizableTableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cogsItems.map(item => {
                    const costCalc = calc.calcCogsItemCost({
                      include: item.include,
                      components_per_product: item.components_per_product || 0,
                      unit_cost_inr: item.unit_cost_inr || 0,
                      waste_factor: item.waste_factor || 0,
                    });
                    const isAuto = item.is_auto_calculated;
                    const isSelected = selectedCogsIds.has(item.id);
                    return (
                      <TableRow key={item.id} className={cn(
                        item.include === 'No' && 'opacity-40',
                        isAuto && 'bg-blue-50/50 dark:bg-blue-950/20',
                        item.include === 'Review' && 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 border-l-2 border-amber-500'
                      )}>
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              setSelectedCogsIds(prev => {
                                const next = new Set(prev);
                                if (checked) next.add(item.id); else next.delete(item.id);
                                return next;
                              });
                            }}
                            aria-label="Select row"
                          />
                        </TableCell>
                        <TableCell>
                          <Select value={item.include || 'Yes'} onValueChange={v => updateCogsItem(item.id, 'include', v)}>
                            <SelectTrigger className="h-6 text-[10px] w-14 border-none"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Yes">Yes</SelectItem>
                              <SelectItem value="Review">Review</SelectItem>
                              <SelectItem value="No">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {isAuto ? (
                            <>
                              {item.cogs_type}
                              <Badge variant="secondary" className="ml-1 text-[7px] h-3 px-1">auto</Badge>
                            </>
                          ) : (
                            <Select value={item.cogs_type} onValueChange={v => updateCogsItem(item.id, 'cogs_type', v)}>
                              <SelectTrigger className="h-6 text-[10px] w-32 border-transparent hover:border-input"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Raw Piece">Raw Piece</SelectItem>
                                <SelectItem value="Hardware">Hardware</SelectItem>
                                <SelectItem value="Accessories">Accessories</SelectItem>
                                <SelectItem value="Subcontracting">Subcontracting</SelectItem>
                                <SelectItem value="Finishing Materials">Finishing Materials</SelectItem>
                                <SelectItem value="Packaging">Packaging</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="align-middle">
                          {(item.cogs_type === 'Hardware' || item.cogs_type === 'Accessories') && !item.is_auto_calculated ? (
                            <div className="flex flex-col gap-1 w-full">
                              <Select
                                value={hardwarePrices.some(hp => hp.name === item.component_name) ? (item.component_name || '') : '__custom__'}
                                onValueChange={(v) => {
                                  if (v === '__custom__') {
                                    setCogsItems(items => items.map(i => i.id === item.id ? { ...i, component_name: '' } : i));
                                    updateCogsItem(item.id, 'component_name', '');
                                    return;
                                  }
                                  const hwItem = hardwarePrices.find(hp => hp.name === v);
                                  const updates: any = { component_name: v };
                                  if (hwItem) {
                                    updates.unit_cost_inr = hwItem.unit_cost_inr;
                                    updates.units = hwItem.units || 'pc';
                                  }
                                  setCogsItems(items => items.map(i => i.id === item.id ? { ...i, ...updates } : i));
                                  Object.entries(updates).forEach(([k, val]) => updateCogsItem(item.id, k, val));
                                }}
                              >
                                <SelectTrigger
                                  className="min-h-7 h-auto py-1 text-xs border-transparent hover:border-input w-full min-w-0 [&>span]:whitespace-normal [&>span]:break-words [&>span]:block [&>span]:text-left [&>span]:leading-tight"
                                  title={item.component_name || ''}
                                >
                                  <SelectValue placeholder="Select hardware…">
                                    {item.component_name || ''}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent className="max-w-[420px]">
                                  {hardwarePrices.map(hp => (
                                    <SelectItem key={hp.id} value={hp.name}>
                                      <span className="font-medium">{hp.name}</span>
                                      <span className="text-muted-foreground"> — {fmt.inr(hp.unit_cost_inr)}/{hp.units || 'pc'}</span>
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="__custom__">+ Custom name…</SelectItem>
                                </SelectContent>
                              </Select>
                              {!hardwarePrices.some(hp => hp.name === item.component_name) && (
                                <Input
                                  className="h-7 text-xs border-transparent hover:border-input w-full min-w-0"
                                  placeholder="Custom name"
                                  defaultValue={item.component_name || ''}
                                  title={item.component_name || ''}
                                  onBlur={e => updateCogsItem(item.id, 'component_name', e.target.value)}
                                />
                              )}
                            </div>
                          ) : (
                            <Input
                              className={`h-7 text-xs border-transparent hover:border-input w-full min-w-0 ${isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}`}
                              defaultValue={item.component_name || ''}
                              title={item.component_name || ''}
                              onBlur={e => updateCogsItem(item.id, 'component_name', e.target.value)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <VendorCombobox
                            value={item.vendor_name || ''}
                            onChange={v => updateCogsItem(item.id, 'vendor_name', v)}
                          />
                        </TableCell>
                        <TableCell className="text-[10px]">{item.units || 'pc'}</TableCell>
                        <TableCell className="text-right">
                          <Input className={`h-6 text-xs text-right border-transparent hover:border-input w-24 ${isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}`} type="number" step="any"
                            value={item.components_per_product ?? 0}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setCogsItems(items => items.map(i => i.id === item.id ? { ...i, components_per_product: v, is_auto_calculated: false } : i));
                            }}
                            onBlur={e => updateCogsItem(item.id, 'components_per_product', Number(e.target.value))} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input className={`h-6 text-xs text-right border-transparent hover:border-input w-24 ${isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}`} type="number" step="any"
                            value={item.unit_cost_inr ?? 0}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setCogsItems(items => items.map(i => i.id === item.id ? { ...i, unit_cost_inr: v, is_auto_calculated: false } : i));
                            }}
                            onBlur={e => updateCogsItem(item.id, 'unit_cost_inr', Number(e.target.value))} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input className="h-6 text-xs text-right border-transparent hover:border-input w-14" type="number"
                            defaultValue={(item.waste_factor || 0) * 100}
                            onBlur={e => updateCogsItem(item.id, 'waste_factor', Number(e.target.value) / 100)} />
                        </TableCell>
                        <TableCell className="text-right calc-field font-mono text-xs">{fmt.inr(costCalc.unit_cost)}</TableCell>
                        <TableCell className="p-0 text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            title={isAuto ? 'Delete auto-calculated row (it may be re-created if inputs change)' : 'Delete row'}
                            onClick={async () => {
                              const label = item.component_name || item.cogs_type;
                              const msg = isAuto
                                ? `Delete auto-calculated row "${label}"? It may be re-created automatically if its inputs change.`
                                : `Delete "${label}" row?`;
                              if (!confirm(msg)) return;
                              const { error } = await (supabase as any).from('cogs_items').delete().eq('id', item.id);
                              if (error) { toast.error(error.message); return; }
                              setCogsItems(items => items.filter(i => i.id !== item.id));
                              setSelectedCogsIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                onClick={async () => {
                  const { data } = await (supabase as any).from('cogs_items').insert({
                    product_id: id, cogs_type: 'Raw Piece', component_name: 'New Item',
                    sort_order: cogsItems.length,
                  }).select().single();
                  if (data) setCogsItems([...cogsItems, data]);
                }}>
                <Plus className="h-3 w-3" /> Add Row
              </Button>
              {selectedCogsIds.size > 0 && (
                <>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {selectedCogsIds.size} selected
                  </span>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]"
                    onClick={async () => {
                      const ids = Array.from(selectedCogsIds);
                      const { error } = await (supabase as any).from('cogs_items').update({ include: 'No' }).in('id', ids);
                      if (error) { toast.error(error.message); return; }
                      setCogsItems(items => items.map(i => ids.includes(i.id) ? { ...i, include: 'No' } : i));
                      toast.success(`Set ${ids.length} row${ids.length === 1 ? '' : 's'} to No`);
                    }}>
                    Set to No
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]"
                    onClick={async () => {
                      const ids = Array.from(selectedCogsIds);
                      const { error } = await (supabase as any).from('cogs_items').update({ include: 'Yes' }).in('id', ids);
                      if (error) { toast.error(error.message); return; }
                      setCogsItems(items => items.map(i => ids.includes(i.id) ? { ...i, include: 'Yes' } : i));
                      toast.success(`Set ${ids.length} row${ids.length === 1 ? '' : 's'} to Yes`);
                    }}>
                    Set to Yes
                  </Button>
                  <Button size="sm" variant="destructive" className="h-6 text-[10px] gap-1"
                    onClick={async () => {
                      const ids = Array.from(selectedCogsIds);
                      const hasAuto = cogsItems.some(i => ids.includes(i.id) && i.is_auto_calculated);
                      const msg = hasAuto
                        ? `Delete ${ids.length} row${ids.length === 1 ? '' : 's'}? Some are auto-calculated and may be re-created if their inputs change.`
                        : `Delete ${ids.length} row${ids.length === 1 ? '' : 's'}?`;
                      if (!confirm(msg)) return;
                      const { error } = await (supabase as any).from('cogs_items').delete().in('id', ids);
                      if (error) { toast.error(error.message); return; }
                      setCogsItems(items => items.filter(i => !ids.includes(i.id)));
                      setSelectedCogsIds(new Set());
                      toast.success(`Deleted ${ids.length} row${ids.length === 1 ? '' : 's'}`);
                    }}>
                    <Trash2 className="h-3 w-3" /> Delete Selected
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                    onClick={() => setSelectedCogsIds(new Set())}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section D: Non-Unit COGS */}
        <Collapsible open={sections.nonUnitCogs} onOpenChange={() => toggle('nonUnitCogs')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="D. Non-Unit COGS" open={sections.nonUnitCogs} onToggle={() => {}} badge={`${fmt.inr(nonUnitCogsPerUnit)}/unit`} done={product.cogs_done} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Table className="dense-table">
              <TableHeader>
                <TableRow>
                  <ResizableTableHead storageKey="nonunit.include" defaultWidth={64} minWidth={48}>Include</ResizableTableHead>
                  <ResizableTableHead storageKey="nonunit.name" defaultWidth={220} minWidth={100}>Name</ResizableTableHead>
                  <ResizableTableHead storageKey="nonunit.qty" defaultWidth={96} minWidth={70} align="right">Total Qty</ResizableTableHead>
                  <ResizableTableHead storageKey="nonunit.cost" defaultWidth={112} minWidth={70} align="right">Cost Each (₹)</ResizableTableHead>
                  <ResizableTableHead storageKey="nonunit.unitcost" defaultWidth={96} minWidth={70} align="right">Unit Cost</ResizableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonUnitCogs.map(item => {
                  const isAutoTransport = item.name === 'Auto Transport';
                  const locked = isAutoTransport && !item.manual_override;
                  const toggleManual = async () => {
                    const next = !item.manual_override;
                    setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, manual_override: next } : i));
                    await (supabase as any).from('non_unit_cogs').update({ manual_override: next }).eq('id', item.id);
                    if (!next) setRecalcTick(t => t + 1);
                  };
                  return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Select value={item.include || 'Yes'} onValueChange={async v => {
                        setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, include: v } : i));
                        const { error } = await (supabase as any).from('non_unit_cogs').update({ include: v }).eq('id', item.id);
                        if (error) toast.error(`Could not save include: ${error.message}`);
                      }}>
                        <SelectTrigger className="h-6 text-[10px] w-14 border-none"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Yes">Yes</SelectItem>
                          <SelectItem value="No">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {isAutoTransport ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          Auto Transport
                          <button
                            type="button"
                            onClick={toggleManual}
                            className={`text-[9px] px-1 rounded ${item.manual_override ? 'bg-amber-200 text-amber-900' : 'bg-muted'} hover:opacity-80`}
                            title={item.manual_override ? 'Manual override on — click to revert to auto' : 'Auto-calculated — click to edit manually'}
                          >
                            {item.manual_override ? 'manual' : 'auto'}
                          </button>
                        </span>
                      ) : (
                        <Input className="h-6 text-xs border-transparent" defaultValue={item.name || ''}
                          onBlur={async e => {
                            const v = e.target.value;
                            setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, name: v } : i));
                            const { error } = await (supabase as any).from('non_unit_cogs').update({ name: v }).eq('id', item.id);
                            if (error) toast.error(`Could not save name: ${error.message}`);
                          }} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {locked ? (
                        <span className="text-xs text-muted-foreground">{(item.total_quantity || 0).toFixed(4)}</span>
                      ) : (
                        <Input key={`qty-${item.id}-${item.manual_override}`} className="h-6 text-xs text-right border-transparent w-18" type="number" defaultValue={item.total_quantity || 0}
                          onBlur={async e => {
                            const v = Number(e.target.value);
                            setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, total_quantity: v } : i));
                            const { error } = await (supabase as any).from('non_unit_cogs').update({ total_quantity: v }).eq('id', item.id);
                            if (error) toast.error(`Could not save qty: ${error.message}`);
                          }} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {locked ? (
                        <span className="text-xs text-muted-foreground">{item.cost_each_inr || 0}</span>
                      ) : (
                        <Input key={`cost-${item.id}-${item.manual_override}`} className="h-6 text-xs text-right border-transparent w-18" type="number" defaultValue={item.cost_each_inr || 0}
                          onBlur={async e => {
                            const v = Number(e.target.value);
                            setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, cost_each_inr: v } : i));
                            const { error } = await (supabase as any).from('non_unit_cogs').update({ cost_each_inr: v }).eq('id', item.id);
                            if (error) toast.error(`Could not save cost: ${error.message}`);
                          }} />
                      )}
                    </TableCell>
                    <TableCell className="text-right calc-field">{qty > 0 ? fmt.inr((item.total_quantity * item.cost_each_inr) / qty) : '—'}</TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Button size="sm" variant="outline" className="mt-1 h-6 text-[10px] gap-1"
              onClick={async () => {
                const { data } = await (supabase as any).from('non_unit_cogs').insert({ product_id: id, name: 'New Item', sort_order: nonUnitCogs.length }).select().single();
                if (data) setNonUnitCogs([...nonUnitCogs, data]);
              }}>
              <Plus className="h-3 w-3" /> Add Row
            </Button>
          </CollapsibleContent>
        </Collapsible>

        {/* Section E: Direct Overhead */}
        <Collapsible open={sections.overhead} onOpenChange={() => toggle('overhead')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="E. Direct Overhead (Labor)" open={sections.overhead} onToggle={() => {}} badge={`${fmt.inr(directOhPerUnit)}/unit`} done={product.overhead_done} hasReview={overheadHasReview} onDoneChange={(v) => updateProduct('overhead_done', v, true)} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Table className="dense-table">
              <TableHeader>
                <TableRow>
                  <ResizableTableHead storageKey="overhead.include" defaultWidth={56} minWidth={48}>Include</ResizableTableHead>
                  <ResizableTableHead storageKey="overhead.labor" defaultWidth={128} minWidth={80}>Labor Type</ResizableTableHead>
                  <ResizableTableHead storageKey="overhead.mhunit" defaultWidth={112} minWidth={70} align="right">MH/Unit</ResizableTableHead>
                  <ResizableTableHead storageKey="overhead.totalmh" defaultWidth={112} minWidth={70} align="right">Total MH</ResizableTableHead>
                  <ResizableTableHead storageKey="overhead.rate" defaultWidth={112} minWidth={70} align="right">Rate (₹/hr)</ResizableTableHead>
                  <ResizableTableHead storageKey="overhead.unitcost" defaultWidth={112} minWidth={70} align="right">Unit Cost</ResizableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overheadItems.map(item => {
                  const rate = calc.avgRateByDesignation(employees, item.labor_type);
                  const unitCost = (item.man_hours_per_unit || 0) * rate;
                  const isAuto = item.is_auto_estimated;
                  return (
                    <TableRow key={item.id} className={cn(
                      isAuto && 'bg-blue-50/50 dark:bg-blue-950/20',
                      item.include === 'Review' && 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 border-l-2 border-amber-500'
                    )}>
                      <TableCell>
                        <Select value={item.include || 'Yes'} onValueChange={v => updateOverheadItem(item.id, 'include', v)}>
                          <SelectTrigger className="h-6 text-[10px] w-14 border-none"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Yes">Yes</SelectItem>
                            <SelectItem value="No">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{item.labor_type}
                        {isAuto && <Badge variant="secondary" className="ml-1 text-[7px] h-3 px-1">auto</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input className={`h-6 text-xs text-right border-transparent hover:border-input w-24 ${isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}`} type="number" step="any"
                          value={Number.isFinite(item.man_hours_per_unit) ? item.man_hours_per_unit : 0}
                          onChange={e => {
                            const v = Number(e.target.value);
                            const safe = Number.isFinite(v) ? v : 0;
                            setOverheadItems(items => items.map(i => i.id === item.id ? { ...i, man_hours_per_unit: safe, is_auto_estimated: false } : i));
                          }}
                          onBlur={e => {
                            const v = Number(e.target.value);
                            updateOverheadItem(item.id, 'man_hours_per_unit', Number.isFinite(v) ? v : 0);
                          }} />
                      </TableCell>
                      <TableCell className="text-right calc-field">{fmt.hrs((Number.isFinite(item.man_hours_per_unit) ? item.man_hours_per_unit : 0) * qty)}</TableCell>
                      <TableCell className="text-right calc-field">{fmt.inr(rate)}</TableCell>
                      <TableCell className="text-right calc-field">{fmt.inr(unitCost)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>

        {/* Section F: Indirect Overhead */}
        <Collapsible open={sections.indirectOh} onOpenChange={() => toggle('indirectOh')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="F. Indirect Overhead" open={sections.indirectOh} onToggle={() => {}} badge={`${fmt.inr(indirectOhPerUnit)}/unit`} done={product.overhead_done} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="py-2 px-1 grid grid-cols-3 gap-4 text-xs">
              <div><span className="text-muted-foreground">Total Direct MH/Unit:</span> <span className="font-mono">{totalDirectMhPerUnit.toFixed(2)} hrs</span></div>
              <div><span className="text-muted-foreground">Indirect OH/MH:</span> <span className="font-mono">{fmt.inr(indirectOhPerMh)}</span></div>
              <div><span className="text-muted-foreground">Indirect OH/Unit:</span> <span className="font-mono font-semibold">{fmt.inr(indirectOhPerUnit)}</span></div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section G: Shipping */}
        <Collapsible open={sections.shipping} onOpenChange={() => toggle('shipping')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="G. Shipping" open={sections.shipping} onToggle={() => {}} badge={`${fmt.inr(shippingPerUnit)}/unit`} done={product.shipping_done} onDoneChange={(v) => updateProduct('shipping_done', v, true)} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="py-2 px-1 flex items-center gap-4">
              <div>
                <label className="text-[10px] text-muted-foreground">Shipping Type</label>
                <Select value={shipItem?.shipping_type_id || ''} onValueChange={setShippingType}>
                  <SelectTrigger className="h-7 text-xs w-48"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {shippingTypes.map(st => (
                      <SelectItem key={st.id} value={st.id}>{st.name} — {fmt.inr(st.cost_inr)}/{st.per_unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">Unit CBM:</span>{' '}
                <span className="font-mono">{fmt.cbm(finalUnitCbm)}</span>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">Unit Cost:</span>{' '}
                <span className="font-mono font-semibold">{fmt.inr(shippingPerUnit)}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section H: Cost & Revenue Summary */}
        <Collapsible open={sections.summary} onOpenChange={() => toggle('summary')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="H. Cost & Revenue Summary" open={sections.summary} onToggle={() => {}} badge={`NPM: ${fmt.pct(summary.npm)}`} done={product.revenue_done} onDoneChange={(v) => updateProduct('revenue_done', v, true)} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="py-2 px-1 space-y-3">
              {/* Cost breakdown */}
              <Table className="dense-table">
                <TableHeader>
                  <TableRow>
                    <ResizableTableHead storageKey="summary.category" defaultWidth={180} minWidth={100}>Category</ResizableTableHead>
                    <ResizableTableHead storageKey="summary.peru-inr" defaultWidth={128} minWidth={80} align="right">Per Unit (₹)</ResizableTableHead>
                    <ResizableTableHead storageKey="summary.peru-usd" defaultWidth={128} minWidth={80} align="right">Per Unit ($)</ResizableTableHead>
                    <ResizableTableHead storageKey="summary.total-inr" defaultWidth={128} minWidth={80} align="right">Total (₹)</ResizableTableHead>
                    <ResizableTableHead storageKey="summary.pct" defaultWidth={112} minWidth={70} align="right">% of Cost</ResizableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { label: 'COGS', value: summary.total_cogs_per_unit },
                    { label: 'Direct Overhead', value: summary.total_direct_oh_per_unit },
                    { label: 'Indirect Overhead', value: summary.total_indirect_oh_per_unit },
                    { label: 'Shipping', value: summary.total_shipping_per_unit },
                  ].map(row => (
                    <TableRow key={row.label}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right font-mono">{fmt.inr(row.value)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt.usd(row.value / exchangeRate)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt.inr(row.value * qty)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {summary.product_cost_per_unit_inr > 0
                          ? fmt.pct(row.value / summary.product_cost_per_unit_inr)
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Product Cost</TableCell>
                    <TableCell className="text-right font-mono">{fmt.inr(summary.product_cost_per_unit_inr)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt.usd(summary.product_cost_per_unit_usd)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt.inr(summary.total_cost_inr)}</TableCell>
                    <TableCell className="text-right">100.0%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {/* Pricing */}
              <div className="grid grid-cols-4 gap-3 border-t pt-3">
                <div>
                  <label className="text-[10px] text-muted-foreground">Net Profit Margin %</label>
                  <Input className="h-7 text-xs" type="number" step="0.1"
                    defaultValue={(calc.markupToNpm(markupPercent) * 100).toFixed(1)}
                    key={`npm-${markupPercent}`}
                    onBlur={e => {
                      const npmPct = Number(e.target.value);
                      if (!isFinite(npmPct) || npmPct < 0 || npmPct >= 100) {
                        e.target.value = (calc.markupToNpm(markupPercent) * 100).toFixed(1);
                        toast.error('Enter a value between 0 and 99.9');
                        return;
                      }
                      updateProduct('markup_percent', calc.npmToMarkup(npmPct / 100));
                    }} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Unit Price (₹)</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.inr(summary.unit_price_inr)}</span>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Unit Price ($)</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.usd(summary.unit_price_usd)}</span>
                </div>
                {(() => {
                  const qc = (inquiryOverrides?.quoting_currency as string) || '';
                  if (!qc || qc === 'USD' || qc === 'INR') return null;
                  const foreign = convertFromInr(currencyMap, summary.unit_price_inr, qc, 'import');
                  return (
                    <div>
                      <label className="text-[10px] text-muted-foreground">Unit Price ({qc})</label>
                      <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{isFinite(foreign) ? fmt.money(foreign, qc) : '—'}</span>
                    </div>
                  );
                })()}
                <div>
                  <label className="text-[10px] text-muted-foreground">Total Revenue</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.inr(summary.total_revenue_inr)}</span>
                </div>
              </div>

              {/* Margins */}
              <div className="grid grid-cols-4 gap-3">
                <div className="text-xs">
                  <span className="text-muted-foreground">Gross Profit:</span>{' '}
                  <span className="font-mono font-semibold">{fmt.inr(summary.gross_profit_inr)}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">GPM:</span>{' '}
                  <span className="font-mono font-semibold">{fmt.pct(summary.gpm)}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Net Profit:</span>{' '}
                  <span className="font-mono font-semibold">{fmt.inr(summary.net_profit_inr)}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">NPM:</span>{' '}
                  <span className="font-mono font-semibold">{fmt.pct(summary.npm)}</span>
                </div>
              </div>

              {/* Target price comparison + Max Raw Piece */}
              {product.target_price_usd && (() => {
                const targetUsd = product.target_price_usd;
                const deltaUsd = targetUsd - summary.unit_price_usd;
                const isUnder = deltaUsd >= 0;

                // Back-calculate max raw piece cost:
                // Target price = cost × (1 + markup), so max cost = target / (1 + markup)
                // Max raw piece = max cost - all non-raw-piece costs
                const maxTotalCostUsd = targetUsd / (1 + markupPercent);
                const maxTotalCostInr = maxTotalCostUsd * exchangeRate;
                // Non-raw-piece costs = overhead + indirect OH + shipping + non-unit COGS + finishing + packaging + hardware + accessories COGS
                const rawPieceCogs = cogsItems
                  .filter(i => i.include !== 'No' && i.cogs_type === 'Raw Piece')
                  .reduce((sum, item) => sum + calc.calcCogsItemCost({
                    include: item.include, components_per_product: item.components_per_product || 0,
                    unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0,
                  }).unit_cost, 0);
                const nonRawPieceCosts = summary.product_cost_per_unit_inr - rawPieceCogs;
                const maxRawPieceInr = maxTotalCostInr - nonRawPieceCosts;
                const maxRawPieceUsd = exchangeRate > 0 ? maxRawPieceInr / exchangeRate : 0;

                return (
                  <div className="border-t pt-3 space-y-2">
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-muted-foreground">Target: <strong>{fmt.usd(targetUsd)}</strong></span>
                      <span className={isUnder ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                        {isUnder ? '✓ Under target' : '✗ Over target'} by {fmt.usd(Math.abs(deltaUsd))}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Current Raw Piece</span>
                        <span className="font-mono font-semibold">{fmt.inr(rawPieceCogs)}</span>
                        <span className="text-muted-foreground ml-1">({fmt.usd(exchangeRate > 0 ? rawPieceCogs / exchangeRate : 0)})</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Max Raw Piece (at target)</span>
                        <span className={`font-mono font-semibold ${maxRawPieceInr >= rawPieceCogs ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt.inr(maxRawPieceInr)}
                        </span>
                        <span className="text-muted-foreground ml-1">({fmt.usd(maxRawPieceUsd)})</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Raw Piece Budget Left</span>
                        <span className={`font-mono font-semibold ${maxRawPieceInr - rawPieceCogs >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt.inr(maxRawPieceInr - rawPieceCogs)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Non-Raw-Piece Costs</span>
                        <span className="font-mono">{fmt.inr(nonRawPieceCosts)}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          </CollapsibleContent>
        </Collapsible>
    </div>
  );
}

