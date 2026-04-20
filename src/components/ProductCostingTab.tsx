import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import * as calc from '@/lib/calculations';
import { ProductVariants } from '@/components/ProductVariants';


const DIFFICULTIES = ['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'];

const SectionHeader = ({ title, open, onToggle, badge, done }: { title: string; open: boolean; onToggle: () => void; badge?: string; done?: boolean }) => (
  <button onClick={onToggle} className={`w-full flex items-center gap-2 py-2 px-3 rounded-md transition-colors text-left ${done ? 'bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50' : 'bg-muted/50 hover:bg-muted'}`}>
    <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
    <span className={`text-sm font-semibold flex-1 ${done ? 'text-green-800 dark:text-green-300' : ''}`}>{title}</span>
    {badge && <span className="text-xs calc-field px-2 py-0.5 rounded">{badge}</span>}
  </button>
);

const AutoCell = ({ children, isAuto }: { children: React.ReactNode; isAuto?: boolean }) => (
  <span className={isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}>{children}</span>
);

type Props = { productId: string; onProductUpdated?: () => void };

export function ProductCostingTab({ productId: id, onProductUpdated }: Props) {
  const navigate = useNavigate();

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
  const [projectSettings, setProjectSettings] = useState<any>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Section open state
  const [sections, setSections] = useState({
    info: true, cbm: true, cogs: true, nonUnitCogs: false,
    overhead: true, indirectOh: false, shipping: true, summary: true,
  });
  const toggle = (key: string) => setSections(s => ({ ...s, [key]: !(s as any)[key] }));

  // Debounced save
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const saveProduct = useCallback((updates: any) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      if (!id) return;
      const { error } = await (supabase as any).from('products').update(updates).eq('id', id);
      if (error) toast.error('Save failed: ' + error.message);
    }, 500);
  }, [id]);

  const updateProduct = (field: string, value: any) => {
    setProduct((p: any) => ({ ...p, [field]: value }));
    saveProduct({ [field]: value });
  };

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

  // Fetch all data
  useEffect(() => {
    if (!id) return;
    const fetchAll = async () => {
      const [prodRes, typesRes, cbmRes, cogsRes, nucRes, ohRes, shipRes, stRes, empRes, gsRes, bdRes, chemRes, hwPricesRes] = await Promise.all([
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
      ]);
      if (prodRes.data) setProduct(prodRes.data);
      if (typesRes.data) setProductTypes(typesRes.data);
      if (cbmRes.data) setCbm(cbmRes.data);
      if (cogsRes.data) setCogsItems(cogsRes.data);
      if (nucRes.data) setNonUnitCogs(nucRes.data);
      if (ohRes.data) setOverheadItems(ohRes.data);
      if (shipRes.data) setShippingItems(shipRes.data);
      if (stRes.data) setShippingTypes(stRes.data);
      if (empRes.data) setEmployees(empRes.data);
      if (gsRes.data) setGlobalSettings(gsRes.data);
      if (bdRes.data) setBoxData(bdRes.data);
      if (chemRes.data) setChemicalPrices(chemRes.data);
      if (hwPricesRes.data) setHardwarePrices(hwPricesRes.data);

      // Fetch project settings if product has a project_id
      if (prodRes.data?.project_id) {
        const { data: ps } = await (supabase as any).from('project_settings').select('*').eq('project_id', prodRes.data.project_id).maybeSingle();
        if (ps) setProjectSettings(ps);
      }

      setDataLoaded(true);
    };
    fetchAll();
  }, [id]);

  // ===== DERIVED CALCULATIONS (Steps 1-12) =====
  const productType = productTypes.find(t => t.id === product?.product_type_id);
  const w = product?.width_inch || 0;
  const d = product?.depth_inch || 0;
  const h = product?.height_inch || 0;
  const qty = product?.quantity || 100;
  const ri = calc.runningInches(w, d, h);
  const prePackCbm = calc.prePackagedCbm(w, d, h);
  const percentWood = product?.percent_wood || 1;
  const difficulty = product?.finishing_difficulty || 'Medium';
  const difficultyFactor = calc.getDifficultyFactor(difficulty);

  // Unique box types for dropdowns
  const uniqueBoxTypes = useMemo(() => {
    const types = [...new Set(boxData.map(b => b.box_type))];
    return types.sort();
  }, [boxData]);

  const icType = cbm?.ic_type || '7 ply';
  const mcType = cbm?.mc_type || '7 ply';

  // Step 2 & 3: IC calcs with type-specific cost lookup
  const icAdd = productType?.ic_addition_per_side_inch || 0.5;
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
  const icVolume = calc.calcICVolumeCbm(icDims.ic_width, icDims.ic_depth, icDims.ic_height);
  const productsPerIc = cbm?.products_per_ic || 1;

  // Step 4: MC calcs with type-specific cost lookup
  const includeMc = cbm?.include_mc ?? true;
  const mcManualLayout = cbm?.mc_manual_layout ?? false;
  const autoMcResult = calc.calcMCPacking({
    include_mc: includeMc,
    mc_type: mcType,
    mc_max_width: cbm?.mc_max_width || 25,
    mc_max_depth: cbm?.mc_max_depth || 25,
    mc_max_height: cbm?.mc_max_height || 25,
    mc_buffer_inch: cbm?.mc_buffer_inch || 1,
    mc_weight_limit_kg: cbm?.mc_weight_limit_kg || 20,
    mc_empty_weight_kg: cbm?.mc_empty_weight_kg || 1.5,
    product_weight_kg: product?.weight_kg || 0,
    quantity: qty,
    products_per_ic: productsPerIc,
    ic_width: icDims.ic_width,
    ic_depth: icDims.ic_depth,
    ic_height: icDims.ic_height,
  });

  // When manual layout override is on, use stored layout values and recompute dims/volume
  const mcResult = (() => {
    if (!mcManualLayout || !includeMc) return autoMcResult;
    const along_w = cbm?.mc_ics_along_w || autoMcResult.mc_ics_along_w;
    const along_d = cbm?.mc_ics_along_d || autoMcResult.mc_ics_along_d;
    const along_h = cbm?.mc_ics_along_h || autoMcResult.mc_ics_along_h;
    const buffer = cbm?.mc_buffer_inch || 1;
    const mc_width = icDims.ic_width * along_w + buffer;
    const mc_depth = icDims.ic_depth * along_d + buffer;
    const mc_height = icDims.ic_height * along_h + buffer;
    const mc_volume_cbm = (mc_width * mc_depth * mc_height) / 61020;
    const products_per_mc = along_w * along_d * along_h * productsPerIc;
    return { ...autoMcResult, mc_ics_along_w: along_w, mc_ics_along_d: along_d, mc_ics_along_h: along_h, mc_width, mc_depth, mc_height, mc_volume_cbm, products_per_mc };
  })();

  // MC cost estimate
  const mcBoxes = boxData.filter(b => b.box_type === mcType && b.cost_per_sq_in > 0);
  const avgMcCostPerSqIn = mcBoxes.length > 0
    ? mcBoxes.reduce((s: number, b: any) => s + b.cost_per_sq_in, 0) / mcBoxes.length
    : 0;
  const mcCost = calc.calcICCostEstimate(mcResult.mc_width, mcResult.mc_depth, mcResult.mc_height, avgMcCostPerSqIn);

  const finalUnitCbm = calc.calcFinalUnitCbm(includeMc, icVolume, productsPerIc, mcResult.mc_volume_cbm, mcResult.products_per_mc);
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
  useEffect(() => {
    if (!dataLoaded || !product || !productType || ri <= 0 || cogsItems.length === 0) return;

    const colorPrice = chemicalPrices.find(c => c.category === 'Color')?.price_per_litre_inr || 0;
    const sealerPrice = chemicalPrices.find(c => c.category === 'Sealer')?.price_per_litre_inr || 0;
    const lacquerPrice = chemicalPrices.find(c => c.category === 'Lacquer' && c.name.includes('NC'))?.price_per_litre_inr ||
                         chemicalPrices.find(c => c.category === 'Lacquer')?.price_per_litre_inr || 0;

    const colorQty = calc.calcFinishingMaterialQty(productType.finishing_color_per_100ri || 0, ri, percentWood);
    const sealerQty = calc.calcFinishingMaterialQty(productType.finishing_sealer_per_100ri || 0, ri, percentWood);
    const lacquerQty = calc.calcFinishingMaterialQty(productType.finishing_lacquer_per_100ri || 0, ri, percentWood);

    const autoUpdates: { id: string; components_per_product: number; unit_cost_inr: number; units: string }[] = [];

    cogsItems.forEach(item => {
      if (!item.is_auto_calculated || item.cogs_type !== 'Finishing Materials') return;
      const name = (item.component_name || '').toLowerCase();
      if (name.includes('color') || name.includes('stain')) {
        autoUpdates.push({ id: item.id, components_per_product: colorQty, unit_cost_inr: colorPrice, units: 'L' });
      } else if (name.includes('sealer')) {
        autoUpdates.push({ id: item.id, components_per_product: sealerQty, unit_cost_inr: sealerPrice, units: 'L' });
      } else if (name.includes('lacquer')) {
        autoUpdates.push({ id: item.id, components_per_product: lacquerQty, unit_cost_inr: lacquerPrice, units: 'L' });
      }
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
  }, [dataLoaded, product?.product_type_id, w, d, h, percentWood]);

  // Step 6: Auto-populate packaging COGS (IC Box, MC Box)
  useEffect(() => {
    if (!dataLoaded || !product || cogsItems.length === 0 || w === 0) return;

    const updates: { id: string; components_per_product: number; unit_cost_inr: number; include: string; waste_factor: number }[] = [];

    cogsItems.forEach(item => {
      if (!item.is_auto_calculated) return;
      const name = (item.component_name || '').toLowerCase();
      if (name.includes('ic box') || name.includes('inner carton') || name === 'ic') {
        updates.push({
          id: item.id,
          components_per_product: productsPerIc > 0 ? 1 / productsPerIc : 1,
          unit_cost_inr: icCost,
          include: 'Yes',
          waste_factor: 0.05,
        });
      } else if (name.includes('mc box') || name.includes('master carton') || name.includes('outer carton')) {
        const ppmc = mcResult.products_per_mc || 1;
        updates.push({
          id: item.id,
          components_per_product: includeMc && ppmc > 0 ? 1 / ppmc : 0,
          unit_cost_inr: mcCost,
          include: includeMc ? 'Yes' : 'No',
          waste_factor: 0,
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
        (supabase as any).from('cogs_items').update({
          components_per_product: upd.components_per_product,
          unit_cost_inr: upd.unit_cost_inr,
          include: upd.include,
          waste_factor: upd.waste_factor,
        }).eq('id', upd.id);
      });
    }
  }, [dataLoaded, icCost, mcCost, productsPerIc, mcResult.products_per_mc, includeMc, w]);

  // Step 7: Auto-populate Finishing and Packaging overhead MH
  useEffect(() => {
    if (!dataLoaded || !product || !productType || !globalSettings || overheadItems.length === 0 || employees.length === 0) return;

    const avgFinishingRate = calc.avgRateByDesignation(employees, 'Finishing') || calc.avgRateByDesignation(employees, 'Sanding');
    const contractorRate = productType.contractor_base_rate_per_ri || 0;
    const decrease = globalSettings.contractor_to_inhouse_decrease || 0;

    const finishingMh = calc.calcFinishingLaborMhPerUnit(contractorRate, decrease, difficultyFactor, avgFinishingRate, ri);

    // Packaging MH: packaging_mh_per_cbm from product type × finalUnitCbm
    const packagingMh = calc.calcPackagingLaborMhPerUnit(productType.packaging_mh_per_cbm || 0, finalUnitCbm);

    const ohUpdates: { id: string; man_hours_per_unit: number }[] = [];

    overheadItems.forEach(item => {
      if (!item.is_auto_estimated || item.include === 'No') return;
      if (item.labor_type === 'Finishing' && finishingMh > 0) {
        ohUpdates.push({ id: item.id, man_hours_per_unit: parseFloat(finishingMh.toFixed(4)) });
      } else if (item.labor_type === 'Packaging' && packagingMh > 0) {
        ohUpdates.push({ id: item.id, man_hours_per_unit: parseFloat(packagingMh.toFixed(4)) });
      }
    });

    if (ohUpdates.length > 0) {
      setOverheadItems(prev => prev.map(item => {
        const upd = ohUpdates.find(u => u.id === item.id);
        if (!upd) return item;
        return { ...item, man_hours_per_unit: upd.man_hours_per_unit };
      }));
      ohUpdates.forEach(upd => {
        (supabase as any).from('overhead_items').update({ man_hours_per_unit: upd.man_hours_per_unit }).eq('id', upd.id);
      });
    }
  }, [dataLoaded, product?.product_type_id, w, d, h, difficulty, percentWood, finalUnitCbm, globalSettings?.id, employees.length]);

  // Step 7b: Auto-populate "Auto Transport" non-unit COGS — qty = total CBM, cost = rate/CBM
  useEffect(() => {
    if (!dataLoaded || !globalSettings || !product || finalUnitCbm <= 0) return;
    const autoTransportRate = (globalSettings as any).auto_transport_cost_per_cbm || 500;
    const transportItem = nonUnitCogs.find(i => i.name === 'Auto Transport');
    if (!transportItem) return;
    const totalCbm = +(finalUnitCbm * qty).toFixed(4);
    if (Math.abs((transportItem.total_quantity || 0) - totalCbm) < 0.0001 &&
        Math.abs((transportItem.cost_each_inr || 0) - autoTransportRate) < 0.01) return;
    setNonUnitCogs(prev => prev.map(i => i.id === transportItem.id ? { ...i, total_quantity: totalCbm, cost_each_inr: autoTransportRate } : i));
    (supabase as any).from('non_unit_cogs').update({ total_quantity: totalCbm, cost_each_inr: autoTransportRate }).eq('id', transportItem.id);
  }, [dataLoaded, finalUnitCbm, qty, globalSettings?.id, nonUnitCogs.length]);

  // Step 7c: Auto-create or update Domestic Freight COGS when sourced_externally is true
  const freightCreatingRef = useRef(false);
  useEffect(() => {
    if (!dataLoaded || !product?.sourced_externally || !globalSettings || prePackCbm <= 0 || !id) return;
    const freightItem = cogsItems.find(i => i.component_name === 'Domestic Freight (External Sourcing)' && i.is_auto_calculated);
    const transportRate = globalSettings.local_transport_cost_per_cbm || 3500;
    if (!freightItem) {
      if (freightCreatingRef.current) return;
      freightCreatingRef.current = true;
      // Check DB first to avoid duplicates
      (async () => {
        const { data: existing } = await (supabase as any).from('cogs_items')
          .select('id').eq('product_id', id)
          .eq('component_name', 'Domestic Freight (External Sourcing)')
          .eq('is_auto_calculated', true).limit(1);
        if (existing && existing.length > 0) {
          // Already exists in DB, just refetch
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
        if (data) setCogsItems(prev => [...prev, data]);
        freightCreatingRef.current = false;
      })();
      return;
    }
    if (Math.abs((freightItem.components_per_product || 0) - prePackCbm) < 0.0001 &&
        Math.abs((freightItem.unit_cost_inr || 0) - transportRate) < 0.01) return;
    setCogsItems(prev => prev.map(i => i.id === freightItem.id ? { ...i, components_per_product: prePackCbm, unit_cost_inr: transportRate } : i));
    (supabase as any).from('cogs_items').update({ components_per_product: prePackCbm, unit_cost_inr: transportRate }).eq('id', freightItem.id);
  }, [dataLoaded, prePackCbm, product?.sourced_externally, globalSettings?.id, cogsItems.length]);

  const ohItems = overheadItems.map(item => ({
    include: item.include,
    labor_type: item.labor_type,
    man_hours_per_unit: item.man_hours_per_unit || 0,
    hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
  }));
  const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
  const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
  const indirectOhPerMh = globalSettings ? calc.calcIndirectOhPerManHour(globalSettings) : 0;
  const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

  // Step 10: Shipping
  const shipItem = shippingItems[0];
  const shipType = shippingTypes.find(s => s.id === shipItem?.shipping_type_id);
  const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
    cost_inr: shipType.cost_inr,
    per_unit: shipType.per_unit,
    final_unit_cbm: finalUnitCbm,
    weight_kg: product?.weight_kg || 0,
  }) : 0;

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

  // COGS calculations (Step 12)
  const cogsPerUnit = cogsItems
    .filter(i => i.include !== 'No')
    .reduce((sum, item) => {
      const c = calc.calcCogsItemCost({
        include: item.include,
        components_per_product: item.components_per_product || 0,
        unit_cost_inr: item.unit_cost_inr || 0,
        waste_factor: item.waste_factor || 0,
      });
      return sum + c.unit_cost;
    }, 0);

  const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
    nonUnitCogs.map(i => ({ include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr })),
    qty
  );

  // Step 12: Cost summary — apply project-level overrides
  const exchangeRate = (projectSettings && !projectSettings.use_global_exchange_rate && projectSettings.exchange_rate_override)
    ? projectSettings.exchange_rate_override
    : (globalSettings?.exchange_rate || 90);
  const markupPercent = (projectSettings && projectSettings.apply_uniform_markup && projectSettings.default_markup_override != null)
    ? projectSettings.default_markup_override
    : (product?.markup_percent || 0.2);
  const summary = calc.calcProductCostSummary(
    cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
    shippingPerUnit, markupPercent, exchangeRate, qty
  );

  // COGS item update helper
  const updateCogsItem = async (itemId: string, field: string, value: any) => {
    // If user edits an auto-calculated field, mark it as manual
    const updates: any = { [field]: value };
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

  return (
    <div className="space-y-2">
        {/* Project-level override banner */}
        {projectSettings && (
          (() => {
            const overrides: string[] = [];
            if (!projectSettings.use_global_exchange_rate && projectSettings.exchange_rate_override)
              overrides.push(`Custom exchange rate (₹${projectSettings.exchange_rate_override}/USD)`);
            if (projectSettings.apply_uniform_markup && projectSettings.default_markup_override != null)
              overrides.push(`Uniform markup of ${(projectSettings.default_markup_override * 100).toFixed(0)}%`);
            if (!projectSettings.use_global_shipping && projectSettings.shipping_type_override)
              overrides.push(`Custom shipping: ${projectSettings.shipping_type_override}`);
            if (overrides.length === 0) return null;
            return (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                <span>⚙️</span>
                <span>{overrides.join(' · ')}</span>
              </div>
            );
          })()
        )}

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
                <label className="text-[10px] text-muted-foreground">Difficulty</label>
                <Select value={product.finishing_difficulty || 'Medium'} onValueChange={v => updateProduct('finishing_difficulty', v)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIFFICULTIES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">% Wood: {((product.percent_wood || 1) * 100).toFixed(0)}%</label>
                <Slider
                  className="mt-1"
                  value={[(product.percent_wood || 1) * 100]}
                  min={0} max={100} step={5}
                  onValueChange={([v]) => updateProduct('percent_wood', v / 100)}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Target Price (USD)</label>
                <Input className="h-7 text-xs" type="number" defaultValue={product.target_price_usd || ''} onBlur={e => updateProduct('target_price_usd', Number(e.target.value) || null)} />
              </div>
              <div className="col-span-2 flex items-center gap-3 pt-2">
                <Switch
                  checked={product.sourced_externally || false}
                  onCheckedChange={async (checked) => {
                    updateProduct('sourced_externally', checked);
                    if (checked) {
                      // Check if freight row already exists before inserting
                      const existing = cogsItems.find(i => i.component_name === 'Domestic Freight (External Sourcing)' && i.is_auto_calculated);
                      if (!existing) {
                        const { data: dbExisting } = await (supabase as any).from('cogs_items')
                          .select('*').eq('product_id', id)
                          .eq('component_name', 'Domestic Freight (External Sourcing)')
                          .eq('is_auto_calculated', true).limit(1);
                        if (dbExisting && dbExisting.length > 0) {
                          setCogsItems(prev => [...prev, dbExisting[0]]);
                        } else {
                          const transportCost = globalSettings?.local_transport_cost_per_cbm || 3500;
                          const { data } = await (supabase as any).from('cogs_items').insert({
                            product_id: id,
                            cogs_type: 'Subcontracting',
                            component_name: 'Domestic Freight (External Sourcing)',
                            units: 'CBM',
                            components_per_product: prePackCbm,
                            unit_cost_inr: transportCost,
                            waste_factor: 0,
                            is_auto_calculated: true,
                            include: 'Yes',
                            sort_order: cogsItems.length,
                          }).select().single();
                          if (data) setCogsItems(prev => [...prev, data]);
                        }
                      }
                    } else {
                      // Remove ALL domestic freight COGS items (handles duplicates)
                      const freightItems = cogsItems.filter(i => i.component_name === 'Domestic Freight (External Sourcing)');
                      for (const fi of freightItems) {
                        await (supabase as any).from('cogs_items').delete().eq('id', fi.id);
                      }
                      setCogsItems(prev => prev.filter(i => i.component_name !== 'Domestic Freight (External Sourcing)'));
                    }
                  }}
                />
                <div>
                  <span className="text-xs font-medium">Sourced from outside Jodhpur?</span>
                  {product.sourced_externally && (
                    <p className="text-[10px] text-muted-foreground">Domestic freight ₹{(globalSettings?.local_transport_cost_per_cbm || 3500).toLocaleString()}/CBM × {prePackCbm.toFixed(4)} CBM added to COGS</p>
                  )}
                </div>
              </div>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section B: CBM Calculator */}
        <Collapsible open={sections.cbm} onOpenChange={() => toggle('cbm')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="B. CBM Calculator" open={sections.cbm} onToggle={() => {}} badge={`Unit: ${fmt.cbm(finalUnitCbm)} | Total: ${fmt.cbm(totalCbm)}`} done={product.cbm_done} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="py-2 px-1 space-y-3">
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

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox checked={includeMc} onCheckedChange={(v) => updateCbm('include_mc', !!v)} />
                  <span className="text-xs font-medium">Include Master Carton (MC)</span>
                </div>
                {includeMc && (
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
                )}
              </div>

              {includeMc && (
                <div className="grid grid-cols-5 gap-2">
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
                    <label className="text-[10px] text-muted-foreground">Buffer (in)</label>
                    <Input className="h-7 text-xs" type="number" defaultValue={cbm?.mc_buffer_inch || 1} onBlur={e => updateCbm('mc_buffer_inch', Number(e.target.value))} />
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

              {/* Carton Summary */}
              <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-border/50 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span>📦</span>
                  <span className="font-medium">Inner Carton:</span>
                  <span>{fmt.dim(icDims.ic_width, icDims.ic_depth, icDims.ic_height)}</span>
                  <span className="text-muted-foreground">({fmt.cbm(icVolume)})</span>
                  <span className="text-muted-foreground">— {icType}</span>
                  <span className="text-muted-foreground">— {fmt.inr(icCost)}/box</span>
                </div>
                {includeMc && (
                  <>
                    <div className="flex items-center gap-2 text-xs">
                      <span>📦</span>
                      <span className="font-medium">Master Carton:</span>
                      <span>{fmt.dim(mcResult.mc_width, mcResult.mc_depth, mcResult.mc_height)}</span>
                      <span className="text-muted-foreground">({fmt.cbm(mcResult.mc_volume_cbm)})</span>
                      <span className="text-muted-foreground">— {mcType}</span>
                      <span className="text-muted-foreground">— {fmt.inr(mcCost)}/box</span>
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
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="C. COGS (Bill of Materials)" open={sections.cogs} onToggle={() => {}} badge={`${fmt.inr(cogsPerUnit)}/unit`} done={product.cogs_done} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="overflow-auto">
              <Table className="dense-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Include</TableHead>
                    <TableHead className="w-28">Type</TableHead>
                    <TableHead>Component</TableHead>
                    <TableHead className="w-20">Vendor</TableHead>
                    <TableHead className="w-12">Units</TableHead>
                    <TableHead className="w-24 text-right">Qty/Prod</TableHead>
                    <TableHead className="w-20 text-right">Cost (₹)</TableHead>
                    <TableHead className="w-14 text-right">Waste%</TableHead>
                    <TableHead className="w-20 text-right">Unit Cost</TableHead>
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
                    return (
                      <TableRow key={item.id} className={`${item.include === 'No' ? 'opacity-40' : ''} ${isAuto ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}>
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
                          {item.cogs_type}
                          {isAuto && <Badge variant="secondary" className="ml-1 text-[7px] h-3 px-1">auto</Badge>}
                        </TableCell>
                        <TableCell>
                          {(item.cogs_type === 'Hardware' || item.cogs_type === 'Accessories') && !item.is_auto_calculated ? (
                            <Select
                              value={item.component_name || ''}
                              onValueChange={(v) => {
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
                              <SelectTrigger className="h-6 text-xs border-transparent hover:border-input">
                                <SelectValue placeholder="Select hardware..." />
                              </SelectTrigger>
                              <SelectContent>
                                {hardwarePrices.map(hp => (
                                  <SelectItem key={hp.id} value={hp.name}>
                                    {hp.name} — {fmt.inr(hp.unit_cost_inr)}/{hp.units || 'pc'}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input className={`h-6 text-xs border-transparent hover:border-input ${isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}`} defaultValue={item.component_name || ''}
                              onBlur={e => updateCogsItem(item.id, 'component_name', e.target.value)} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Input className="h-6 text-xs border-transparent hover:border-input" defaultValue={item.vendor_name || ''}
                            onBlur={e => updateCogsItem(item.id, 'vendor_name', e.target.value)} />
                        </TableCell>
                        <TableCell className="text-[10px]">{item.units || 'pc'}</TableCell>
                        <TableCell className="text-right">
                          <Input className={`h-6 text-xs text-right border-transparent hover:border-input w-20 ${isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}`} type="number" step="any"
                            value={item.components_per_product ?? 0}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setCogsItems(items => items.map(i => i.id === item.id ? { ...i, components_per_product: v, is_auto_calculated: false } : i));
                            }}
                            onBlur={e => updateCogsItem(item.id, 'components_per_product', Number(e.target.value))} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input className={`h-6 text-xs text-right border-transparent hover:border-input w-18 ${isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}`} type="number"
                            value={item.unit_cost_inr ?? 0}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setCogsItems(items => items.map(i => i.id === item.id ? { ...i, unit_cost_inr: v, is_auto_calculated: false } : i));
                            }}
                            onBlur={e => updateCogsItem(item.id, 'unit_cost_inr', Number(e.target.value))} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input className="h-6 text-xs text-right border-transparent hover:border-input w-12" type="number"
                            defaultValue={(item.waste_factor || 0) * 100}
                            onBlur={e => updateCogsItem(item.id, 'waste_factor', Number(e.target.value) / 100)} />
                        </TableCell>
                        <TableCell className="text-right calc-field font-mono text-xs">{fmt.inr(costCalc.unit_cost)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Button size="sm" variant="outline" className="mt-1 h-6 text-[10px] gap-1"
              onClick={async () => {
                const { data } = await (supabase as any).from('cogs_items').insert({
                  product_id: id, cogs_type: 'Raw Piece', component_name: 'New Item',
                  sort_order: cogsItems.length,
                }).select().single();
                if (data) setCogsItems([...cogsItems, data]);
              }}>
              <Plus className="h-3 w-3" /> Add Row
            </Button>
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
                  <TableHead className="w-16">Include</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-20 text-right">Total Qty</TableHead>
                  <TableHead className="w-20 text-right">Cost Each (₹)</TableHead>
                  <TableHead className="w-20 text-right">Unit Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonUnitCogs.map(item => {
                  const isAutoTransport = item.name === 'Auto Transport';
                  return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Select value={item.include || 'Yes'} onValueChange={v => {
                        setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, include: v } : i));
                        (supabase as any).from('non_unit_cogs').update({ include: v }).eq('id', item.id);
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
                        <span className="text-xs text-muted-foreground flex items-center gap-1">Auto Transport <span className="text-[9px] bg-muted px-1 rounded">auto</span></span>
                      ) : (
                        <Input className="h-6 text-xs border-transparent" defaultValue={item.name || ''}
                          onBlur={e => { setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i)); (supabase as any).from('non_unit_cogs').update({ name: e.target.value }).eq('id', item.id); }} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isAutoTransport ? (
                        <span className="text-xs text-muted-foreground">{(item.total_quantity || 0).toFixed(4)}</span>
                      ) : (
                        <Input className="h-6 text-xs text-right border-transparent w-18" type="number" defaultValue={item.total_quantity || 0}
                          onBlur={e => { const v = Number(e.target.value); setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, total_quantity: v } : i)); (supabase as any).from('non_unit_cogs').update({ total_quantity: v }).eq('id', item.id); }} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isAutoTransport ? (
                        <span className="text-xs text-muted-foreground">{item.cost_each_inr || 0}</span>
                      ) : (
                        <Input className="h-6 text-xs text-right border-transparent w-18" type="number" defaultValue={item.cost_each_inr || 0}
                          onBlur={e => { const v = Number(e.target.value); setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, cost_each_inr: v } : i)); (supabase as any).from('non_unit_cogs').update({ cost_each_inr: v }).eq('id', item.id); }} />
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
            <div><SectionHeader title="E. Direct Overhead (Labor)" open={sections.overhead} onToggle={() => {}} badge={`${fmt.inr(directOhPerUnit)}/unit`} done={product.overhead_done} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Table className="dense-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Include</TableHead>
                  <TableHead>Labor Type</TableHead>
                  <TableHead className="w-20 text-right">MH/Unit</TableHead>
                  <TableHead className="w-20 text-right">Total MH</TableHead>
                  <TableHead className="w-20 text-right">Rate (₹/hr)</TableHead>
                  <TableHead className="w-20 text-right">Unit Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overheadItems.map(item => {
                  const rate = calc.avgRateByDesignation(employees, item.labor_type);
                  const unitCost = (item.man_hours_per_unit || 0) * rate;
                  const isAuto = item.is_auto_estimated;
                  return (
                    <TableRow key={item.id} className={isAuto ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}>
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
                        <Input className={`h-6 text-xs text-right border-transparent hover:border-input w-16 ${isAuto ? 'italic text-blue-600 dark:text-blue-400' : ''}`} type="number"
                          value={item.man_hours_per_unit ?? 0}
                          onChange={e => {
                            const v = Number(e.target.value);
                            setOverheadItems(items => items.map(i => i.id === item.id ? { ...i, man_hours_per_unit: v, is_auto_estimated: false } : i));
                          }}
                          onBlur={e => updateOverheadItem(item.id, 'man_hours_per_unit', Number(e.target.value))} />
                      </TableCell>
                      <TableCell className="text-right calc-field">{fmt.hrs((item.man_hours_per_unit || 0) * qty)}</TableCell>
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
            <div><SectionHeader title="G. Shipping" open={sections.shipping} onToggle={() => {}} badge={`${fmt.inr(shippingPerUnit)}/unit`} done={product.shipping_done} /></div>
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
            <div><SectionHeader title="H. Cost & Revenue Summary" open={sections.summary} onToggle={() => {}} badge={`NPM: ${fmt.pct(summary.npm)}`} done={product.revenue_done} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="py-2 px-1 space-y-3">
              {/* Cost breakdown */}
              <Table className="dense-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Per Unit (₹)</TableHead>
                    <TableHead className="text-right">Per Unit ($)</TableHead>
                    <TableHead className="text-right">Total (₹)</TableHead>
                    <TableHead className="text-right">% of Cost</TableHead>
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
                  <label className="text-[10px] text-muted-foreground">Markup %</label>
                  <Input className="h-7 text-xs" type="number"
                    defaultValue={(markupPercent * 100).toFixed(0)}
                    onBlur={e => updateProduct('markup_percent', Number(e.target.value) / 100)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Unit Price (₹)</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.inr(summary.unit_price_inr)}</span>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Unit Price ($)</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.usd(summary.unit_price_usd)}</span>
                </div>
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

              {/* Variants */}
              <ProductVariants
                productId={id!}
                masterRawPieceCost={cogsItems
                  .filter(i => i.include !== 'No' && i.cogs_type === 'Raw Piece')
                  .reduce((sum, item) => sum + calc.calcCogsItemCost({ include: item.include, components_per_product: item.components_per_product || 0, unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0 }).unit_cost, 0)}
                otherCostsPerUnit={summary.product_cost_per_unit_inr - cogsItems
                  .filter(i => i.include !== 'No' && i.cogs_type === 'Raw Piece')
                  .reduce((sum, item) => sum + calc.calcCogsItemCost({ include: item.include, components_per_product: item.components_per_product || 0, unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0 }).unit_cost, 0)}
                markupPercent={markupPercent}
                exchangeRate={exchangeRate}
              />

              {/* Completion checklist */}
              <div className="flex items-center gap-4 border-t pt-3">
                {[
                  { key: 'cbm_done', label: 'CBM' },
                  { key: 'cogs_done', label: 'COGS' },
                  { key: 'overhead_done', label: 'Overhead' },
                  { key: 'shipping_done', label: 'Shipping' },
                  { key: 'revenue_done', label: 'Revenue' },
                ].map(c => (
                  <label key={c.key} className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={product[c.key] || false}
                      onCheckedChange={(v) => updateProduct(c.key, !!v)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
    </div>
  );
}

