import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';

const DIFFICULTIES = ['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'];

const SectionHeader = ({ title, open, onToggle, badge }: { title: string; open: boolean; onToggle: () => void; badge?: string }) => (
  <button onClick={onToggle} className="w-full flex items-center gap-2 py-2 px-3 bg-muted/50 rounded-md hover:bg-muted transition-colors text-left">
    <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
    <span className="text-sm font-semibold flex-1">{title}</span>
    {badge && <span className="text-xs calc-field px-2 py-0.5 rounded">{badge}</span>}
  </button>
);

const ProductCosting = () => {
  const { id } = useParams<{ id: string }>();
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
      const [prodRes, typesRes, cbmRes, cogsRes, nucRes, ohRes, shipRes, stRes, empRes, gsRes, bdRes] = await Promise.all([
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
    };
    fetchAll();
  }, [id]);

  // Derived calculations
  const productType = productTypes.find(t => t.id === product?.product_type_id);
  const w = product?.width_inch || 0;
  const d = product?.depth_inch || 0;
  const h = product?.height_inch || 0;
  const qty = product?.quantity || 100;
  const ri = calc.runningInches(w, d, h);
  const prePackCbm = calc.prePackagedCbm(w, d, h);

  // IC calcs
  const icAdd = productType?.ic_addition_per_side_inch || 0.5;
  const icDims = calc.calcICDimensions(w, d, h, icAdd);
  const avgBoxCostPerSqIn = boxData.length > 0
    ? boxData.filter(b => b.cost_per_sq_in > 0).reduce((s: number, b: any) => s + b.cost_per_sq_in, 0) /
      Math.max(1, boxData.filter(b => b.cost_per_sq_in > 0).length)
    : 0;
  const icCost = calc.calcICCostEstimate(icDims.ic_width, icDims.ic_depth, icDims.ic_height, avgBoxCostPerSqIn);
  const icVolume = calc.calcICVolumeCbm(icDims.ic_width, icDims.ic_depth, icDims.ic_height);
  const productsPerIc = cbm?.products_per_ic || 1;

  // MC calcs
  const includeMc = cbm?.include_mc ?? true;
  const mcResult = calc.calcMCPacking({
    include_mc: includeMc,
    mc_type: cbm?.mc_type || '7 ply',
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
  const finalUnitCbm = calc.calcFinalUnitCbm(includeMc, icVolume, productsPerIc, mcResult.mc_volume_cbm, mcResult.products_per_mc);
  const totalCbm = calc.calcTotalCbm(finalUnitCbm, qty);

  // COGS calculations
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

  // Overhead calculations
  const ohItems = overheadItems.map(item => ({
    include: item.include,
    labor_type: item.labor_type,
    man_hours_per_unit: item.man_hours_per_unit || 0,
    hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
  }));
  const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
  const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);

  // Indirect overhead
  const indirectOhPerMh = globalSettings ? calc.calcIndirectOhPerManHour(globalSettings) : 0;
  const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

  // Shipping
  const shipItem = shippingItems[0];
  const shipType = shippingTypes.find(s => s.id === shipItem?.shipping_type_id);
  const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
    cost_inr: shipType.cost_inr,
    per_unit: shipType.per_unit,
    final_unit_cbm: finalUnitCbm,
    weight_kg: product?.weight_kg || 0,
  }) : 0;

  // Cost summary
  const exchangeRate = globalSettings?.exchange_rate || 90;
  const markupPercent = product?.markup_percent || 0.2;
  const summary = calc.calcProductCostSummary(
    cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
    shippingPerUnit, markupPercent, exchangeRate, qty
  );

  // COGS item update helper
  const updateCogsItem = async (itemId: string, field: string, value: any) => {
    setCogsItems(items => items.map(i => i.id === itemId ? { ...i, [field]: value } : i));
    await (supabase as any).from('cogs_items').update({ [field]: value }).eq('id', itemId);
  };

  // Overhead item update helper
  const updateOverheadItem = async (itemId: string, field: string, value: any) => {
    setOverheadItems(items => items.map(i => i.id === itemId ? { ...i, [field]: value } : i));
    await (supabase as any).from('overhead_items').update({ [field]: value }).eq('id', itemId);
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

  if (!product) return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading product...</div></AppLayout>;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/project/${product.project_id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-bold flex-1 truncate">{product.name}</h1>
          <span className="text-xs text-muted-foreground">
            Cost: {fmt.usd(summary.product_cost_per_unit_usd)} | Price: {fmt.usd(summary.unit_price_usd)}
          </span>
        </div>

        {/* Section A: Product Info */}
        <Collapsible open={sections.info} onOpenChange={() => toggle('info')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="A. Product Info" open={sections.info} onToggle={() => {}} badge={`RI: ${ri.toFixed(1)}″ | Pre-pkg: ${fmt.cbm(prePackCbm)}`} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-4 gap-2 py-2 px-1">
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
                <Input className="h-7 text-xs" type="number" defaultValue={w} onBlur={e => updateProduct('width_inch', Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Depth (in)</label>
                <Input className="h-7 text-xs" type="number" defaultValue={d} onBlur={e => updateProduct('depth_inch', Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Height (in)</label>
                <Input className="h-7 text-xs" type="number" defaultValue={h} onBlur={e => updateProduct('height_inch', Number(e.target.value))} />
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
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section B: CBM Calculator */}
        <Collapsible open={sections.cbm} onOpenChange={() => toggle('cbm')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="B. CBM Calculator" open={sections.cbm} onToggle={() => {}} badge={`Unit: ${fmt.cbm(finalUnitCbm)} | Total: ${fmt.cbm(totalCbm)}`} /></div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="py-2 px-1 space-y-3">
              <div className="grid grid-cols-5 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Products/IC</label>
                  <Input className="h-7 text-xs" type="number" defaultValue={productsPerIc} onBlur={e => updateCbm('products_per_ic', parseInt(e.target.value))} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Width</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.inch(icDims.ic_width)}</span>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Depth</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.inch(icDims.ic_depth)}</span>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Height</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.inch(icDims.ic_height)}</span>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">IC Cost</label>
                  <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{fmt.inr(icCost)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox checked={includeMc} onCheckedChange={(v) => updateCbm('include_mc', !!v)} />
                <span className="text-xs font-medium">Include Master Carton (MC)</span>
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
                <div className="grid grid-cols-5 gap-2">
                  <div><label className="text-[10px] text-muted-foreground">Layout (W×D×H)</label>
                    <span className="calc-field block h-7 px-2 py-1 rounded text-xs">{mcResult.mc_ics_along_w}×{mcResult.mc_ics_along_d}×{mcResult.mc_ics_along_h}</span>
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
                  <div><label className="text-[10px] text-muted-foreground">Final Unit CBM</label>
                    <span className="calc-field block h-7 px-2 py-1 rounded text-xs font-semibold">{fmt.cbm(finalUnitCbm)}</span>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section C: COGS */}
        <Collapsible open={sections.cogs} onOpenChange={() => toggle('cogs')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="C. COGS (Bill of Materials)" open={sections.cogs} onToggle={() => {}} badge={`${fmt.inr(cogsPerUnit)}/unit`} /></div>
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
                    <TableHead className="w-16 text-right">Qty/Prod</TableHead>
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
                    return (
                      <TableRow key={item.id} className={item.include === 'No' ? 'opacity-40' : ''}>
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
                        <TableCell className="text-[10px] text-muted-foreground">{item.cogs_type}</TableCell>
                        <TableCell>
                          <Input className="h-6 text-xs border-transparent hover:border-input" defaultValue={item.component_name || ''}
                            onBlur={e => updateCogsItem(item.id, 'component_name', e.target.value)} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-6 text-xs border-transparent hover:border-input" defaultValue={item.vendor_name || ''}
                            onBlur={e => updateCogsItem(item.id, 'vendor_name', e.target.value)} />
                        </TableCell>
                        <TableCell className="text-[10px]">{item.units || 'pc'}</TableCell>
                        <TableCell className="text-right">
                          <Input className="h-6 text-xs text-right border-transparent hover:border-input w-14" type="number"
                            defaultValue={item.components_per_product || 0}
                            onBlur={e => updateCogsItem(item.id, 'components_per_product', Number(e.target.value))} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input className="h-6 text-xs text-right border-transparent hover:border-input w-18" type="number"
                            defaultValue={item.unit_cost_inr || 0}
                            onBlur={e => updateCogsItem(item.id, 'unit_cost_inr', Number(e.target.value))} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input className="h-6 text-xs text-right border-transparent hover:border-input w-12" type="number"
                            defaultValue={(item.waste_factor || 0) * 100}
                            onBlur={e => updateCogsItem(item.id, 'waste_factor', Number(e.target.value) / 100)} />
                        </TableCell>
                        <TableCell className="text-right calc-field">{fmt.inr(costCalc.unit_cost)}</TableCell>
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
            <div><SectionHeader title="D. Non-Unit COGS" open={sections.nonUnitCogs} onToggle={() => {}} badge={`${fmt.inr(nonUnitCogsPerUnit)}/unit`} /></div>
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
                {nonUnitCogs.map(item => (
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
                    <TableCell><Input className="h-6 text-xs border-transparent" defaultValue={item.name || ''}
                      onBlur={e => { setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i)); (supabase as any).from('non_unit_cogs').update({ name: e.target.value }).eq('id', item.id); }} /></TableCell>
                    <TableCell className="text-right"><Input className="h-6 text-xs text-right border-transparent w-18" type="number" defaultValue={item.total_quantity || 0}
                      onBlur={e => { const v = Number(e.target.value); setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, total_quantity: v } : i)); (supabase as any).from('non_unit_cogs').update({ total_quantity: v }).eq('id', item.id); }} /></TableCell>
                    <TableCell className="text-right"><Input className="h-6 text-xs text-right border-transparent w-18" type="number" defaultValue={item.cost_each_inr || 0}
                      onBlur={e => { const v = Number(e.target.value); setNonUnitCogs(items => items.map(i => i.id === item.id ? { ...i, cost_each_inr: v } : i)); (supabase as any).from('non_unit_cogs').update({ cost_each_inr: v }).eq('id', item.id); }} /></TableCell>
                    <TableCell className="text-right calc-field">{qty > 0 ? fmt.inr((item.total_quantity * item.cost_each_inr) / qty) : '—'}</TableCell>
                  </TableRow>
                ))}
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
            <div><SectionHeader title="E. Direct Overhead (Labor)" open={sections.overhead} onToggle={() => {}} badge={`${fmt.inr(directOhPerUnit)}/unit`} /></div>
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
                  return (
                    <TableRow key={item.id}>
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
                        {item.is_auto_estimated && <Badge variant="secondary" className="ml-1 text-[8px] h-4">Auto</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input className="h-6 text-xs text-right border-transparent hover:border-input w-16" type="number"
                          defaultValue={item.man_hours_per_unit || 0}
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
            <div><SectionHeader title="F. Indirect Overhead" open={sections.indirectOh} onToggle={() => {}} badge={`${fmt.inr(indirectOhPerUnit)}/unit`} /></div>
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
            <div><SectionHeader title="G. Shipping" open={sections.shipping} onToggle={() => {}} badge={`${fmt.inr(shippingPerUnit)}/unit`} /></div>
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
                <span className="text-muted-foreground">Unit Cost:</span>{' '}
                <span className="font-mono font-semibold">{fmt.inr(shippingPerUnit)}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Section H: Cost & Revenue Summary */}
        <Collapsible open={sections.summary} onOpenChange={() => toggle('summary')}>
          <CollapsibleTrigger asChild>
            <div><SectionHeader title="H. Cost & Revenue Summary" open={sections.summary} onToggle={() => {}} badge={`NPM: ${fmt.pct(summary.npm)}`} /></div>
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
    </AppLayout>
  );
};

export default ProductCosting;
