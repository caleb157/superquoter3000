import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Plus, Trash2, Camera, X, Package } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';
import { PageBreadcrumbs, type Crumb } from '@/components/PageBreadcrumbs';

const AssemblyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [refetchKey, setRefetchKey] = useState(0);
  const navigate = useNavigate();

  const [assembly, setAssembly] = useState<any>(null);
  const [components, setComponents] = useState<any[]>([]);
  const [inquiryProducts, setInquiryProducts] = useState<any[]>([]);
  const [componentCostData, setComponentCostData] = useState<Record<string, any>>({});
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [showAddComponent, setShowAddComponent] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');

  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const saveAssembly = useCallback((updates: any) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      if (!id) return;
      const { error } = await (supabase as any).from('product_assemblies').update(updates).eq('id', id);
      if (error) toast.error('Save failed: ' + error.message);
    }, 500);
  }, [id]);

  const updateAssembly = (field: string, value: any) => {
    setAssembly((a: any) => ({ ...a, [field]: value }));
    saveAssembly({ [field]: value });
  };

  useEffect(() => {
    if (!id) return;
    const fetchAll = async () => {
      const { data: asmData } = await (supabase as any).from('product_assemblies').select('*, customer_rfq:customer_rfqs(rfq_number, title)').eq('id', id).single();
      if (!asmData) return;
      setAssembly(asmData);

      const [compRes, gsRes] = await Promise.all([
        (supabase as any).from('assembly_components').select('*, products(*)').eq('assembly_id', id).order('sort_order'),
        (supabase as any).from('global_settings').select('*').limit(1).single(),
      ]);
      if (compRes.data) setComponents(compRes.data);
      if (gsRes.data) setGlobalSettings(gsRes.data);

      // Fetch inquiry products for add-component dialog
      const { data: prods } = await (supabase as any).from('products').select('*').eq('customer_rfq_id', asmData.customer_rfq_id).order('name');
      if (prods) setInquiryProducts(prods);

      // Phase 7: inquiry-level settings TBD — using global settings only.

      // Fetch cost data for each component product
      if (compRes.data && compRes.data.length > 0) {
        const productIds = compRes.data.map((c: any) => c.product_id);
        const [cbmRes, cogsRes, nucRes, ohRes, shipRes, empRes, stRes] = await Promise.all([
          (supabase as any).from('cbm_estimates').select('*').in('product_id', productIds),
          (supabase as any).from('cogs_items').select('*').in('product_id', productIds),
          (supabase as any).from('non_unit_cogs').select('*').in('product_id', productIds),
          (supabase as any).from('overhead_items').select('*').in('product_id', productIds),
          (supabase as any).from('shipping_items').select('*').in('product_id', productIds),
          (supabase as any).from('labor_employees').select('*'),
          (supabase as any).from('shipping_types').select('*'),
        ]);

        const employees = empRes.data || [];
        const shTypes = stRes.data || [];
        const gs = gsRes.data;
        const exchangeRate = gs?.exchange_rate || 90;

        const costMap: Record<string, any> = {};
        productIds.forEach((pid: string) => {
          const prod = prods?.find((p: any) => p.id === pid);
          if (!prod) return;
          const cbmEst = (cbmRes.data || []).find((c: any) => c.product_id === pid);
          const pCogs = (cogsRes.data || []).filter((c: any) => c.product_id === pid);
          const pNuc = (nucRes.data || []).filter((c: any) => c.product_id === pid);
          const pOh = (ohRes.data || []).filter((c: any) => c.product_id === pid);
          const pShip = (shipRes.data || []).filter((c: any) => c.product_id === pid);
          const qty = prod.quantity || 100;
          const unit_cbm = cbmEst?.final_unit_cbm || calc.prePackagedCbm(prod.width_inch || 0, prod.depth_inch || 0, prod.height_inch || 0);

          const cogsPerUnit = pCogs.filter((i: any) => i.include !== 'No').reduce((sum: number, item: any) =>
            sum + calc.calcCogsItemCost({ include: item.include, components_per_product: item.components_per_product || 0, unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0 }).unit_cost, 0);
          const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(pNuc.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr })), qty);
          const ohItems = pOh.map((item: any) => ({ include: item.include, labor_type: item.labor_type, man_hours_per_unit: item.man_hours_per_unit || 0, hourly_rate: calc.avgRateByDesignation(employees, item.labor_type) }));
          const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
          const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
          const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs) : 0;
          const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);
          const shipItem = pShip[0];
          const shipType = shTypes.find((s: any) => s.id === shipItem?.shipping_type_id);
          const shippingPerUnit = shipType ? calc.calcShippingPerUnit({ cost_inr: shipType.cost_inr, per_unit: shipType.per_unit, final_unit_cbm: unit_cbm, weight_kg: prod.weight_kg || 0 }) : 0;
          const markupPercent = prod.markup_percent || 0.2;
          const summary = calc.calcProductCostSummary(cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit, shippingPerUnit, markupPercent, exchangeRate, qty);

          costMap[pid] = {
            product_cost_per_unit: summary.product_cost_per_unit_inr,
            final_unit_cbm: unit_cbm,
            weight_kg: prod.weight_kg || 0,
            total_man_hours_per_unit: totalDirectMhPerUnit,
            unit_cost_usd: summary.product_cost_per_unit_usd,
            ic_width: cbmEst?.ic_width, ic_depth: cbmEst?.ic_depth, ic_height: cbmEst?.ic_height,
            ic_type: cbmEst?.ic_type,
          };
        });
        setComponentCostData(costMap);
      }
    };
    fetchAll();
  }, [id, refetchKey]);

  const exchangeRate = globalSettings?.exchange_rate || 90;
  const markupPercent = assembly?.markup_percent ?? 0.2;

  // Assembly cost calculation
  const assemblyComponents: calc.AssemblyComponent[] = components.map(c => ({
    product_cost_per_unit: componentCostData[c.product_id]?.product_cost_per_unit || 0,
    final_unit_cbm: componentCostData[c.product_id]?.final_unit_cbm || 0,
    weight_kg: componentCostData[c.product_id]?.weight_kg || 0,
    total_man_hours_per_unit: componentCostData[c.product_id]?.total_man_hours_per_unit || 0,
    quantity_per_assembly: c.quantity_per_assembly || 1,
  }));
  const assemblyCost = calc.calcAssemblyCost(assemblyComponents, markupPercent, exchangeRate);

  const addComponent = async () => {
    if (!selectedProductId || !id) return;
    const { data, error } = await (supabase as any).from('assembly_components').insert({
      assembly_id: id,
      product_id: selectedProductId,
      quantity_per_assembly: 1,
      sort_order: components.length,
    }).select('*, products(*)').single();
    if (error) { toast.error(error.message); return; }
    if (data) {
      setComponents(prev => [...prev, data]);
      // Sync component product quantity to assembly quantity
      await (supabase as any).from('products').update({ quantity: assembly.quantity }).eq('id', selectedProductId);
    }
    setSelectedProductId('');
    setShowAddComponent(false);
    setRefetchKey(k => k + 1);
    toast.success('Component added');
  };

  const removeComponent = async (compId: string) => {
    await (supabase as any).from('assembly_components').delete().eq('id', compId);
    setComponents(prev => prev.filter(c => c.id !== compId));
    setRefetchKey(k => k + 1);
    toast.success('Component removed');
  };

  const updateComponentQty = async (compId: string, qty: number) => {
    setComponents(prev => prev.map(c => c.id === compId ? { ...c, quantity_per_assembly: qty } : c));
    await (supabase as any).from('assembly_components').update({ quantity_per_assembly: qty }).eq('id', compId);
  };

  // Sync assembly quantity to component products
  const syncQuantity = async (newQty: number) => {
    updateAssembly('quantity', newQty);
    for (const comp of components) {
      const compQty = newQty * (comp.quantity_per_assembly || 1);
      await (supabase as any).from('products').update({ quantity: compQty }).eq('id', comp.product_id);
    }
  };

  if (!assembly) return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading assembly...</div></AppLayout>;

  // Available products = inquiry products not already in this assembly
  const usedProductIds = new Set(components.map(c => c.product_id));
  const availableProducts = inquiryProducts.filter(p => !usedProductIds.has(p.id));

  const canonicalCrumbs: Crumb[] = [
    { label: 'Inquiries', to: '/inquiries' },
    ...(assembly.customer_rfq_id
      ? [{
          label: assembly.customer_rfq?.title || assembly.customer_rfq?.rfq_number || 'Inquiry',
          to: `/inquiry/${assembly.customer_rfq_id}`,
        } as Crumb]
      : []),
  ];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <PageBreadcrumbs canonical={canonicalCrumbs} current={assembly.name} />
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Back" onClick={() => {
            const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
            if (idx > 0) navigate(-1);
            else navigate(assembly.customer_rfq_id ? `/inquiry/${assembly.customer_rfq_id}` : '/inquiries');
          }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Package className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <h1 className="text-base font-bold truncate">{assembly.name}</h1>
            <div className="text-[10px] text-muted-foreground">
              Assembly • {components.length} components • {assemblyCost.num_cartons} cartons
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            Cost: {fmt.usd(assemblyCost.unit_cost_usd)} | Price: {fmt.usd(assemblyCost.unit_price_usd)}
          </span>
        </div>

        {/* Assembly Info */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start gap-3">
              {/* Photo */}
              <div className="relative group">
                {assembly.photo_url ? (
                  <div className="relative">
                    <img src={assembly.photo_url} alt={assembly.name} className="h-20 w-20 object-cover rounded-md border" />
                    <button
                      onClick={() => updateAssembly('photo_url', null)}
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
                        const path = `assembly-${id}.${ext}`;
                        const { error: uploadErr } = await supabase.storage.from('product-photos').upload(path, file, { contentType: file.type, upsert: true });
                        if (uploadErr) { toast.error('Upload failed: ' + uploadErr.message); return; }
                        const { data: urlData } = supabase.storage.from('product-photos').getPublicUrl(path);
                        updateAssembly('photo_url', urlData.publicUrl);
                        toast.success('Photo uploaded');
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="flex-1 grid grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Name</label>
                  <Input className="h-7 text-xs" defaultValue={assembly.name} onBlur={e => updateAssembly('name', e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">SKU</label>
                  <Input className="h-7 text-xs" defaultValue={assembly.sku || ''} onBlur={e => updateAssembly('sku', e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Quantity</label>
                  <Input className="h-7 text-xs" type="number" defaultValue={assembly.quantity} onBlur={e => syncQuantity(parseInt(e.target.value) || 100)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">MOQ</label>
                  <Input className="h-7 text-xs" type="number" defaultValue={assembly.moq || 50} onBlur={e => updateAssembly('moq', parseInt(e.target.value))} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground" title="Absolute floor — customer cannot order less. Between Hard MOQ and MOQ the below-MOQ surcharge applies.">Hard MOQ</label>
                  <Input className="h-7 text-xs" type="number" defaultValue={(assembly as any).hard_moq ?? ''} placeholder={String(assembly.moq || 50)}
                    onBlur={e => updateAssembly('hard_moq', e.target.value === '' ? null : parseInt(e.target.value))} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Net Profit Margin % <span className="text-primary">(overrides components)</span></label>
                  <Input className="h-7 text-xs" type="number" step="0.1"
                    defaultValue={(calc.markupToNpm(markupPercent) * 100).toFixed(1)}
                    key={`npm-asm-${markupPercent}`}
                    onBlur={e => {
                      const npmPct = parseFloat(e.target.value);
                      if (!isFinite(npmPct) || npmPct < 0 || npmPct >= 100) {
                        e.target.value = (calc.markupToNpm(markupPercent) * 100).toFixed(1);
                        return;
                      }
                      updateAssembly('markup_percent', calc.npmToMarkup(npmPct / 100));
                    }} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Target Price (USD)</label>
                  <Input className="h-7 text-xs" type="number" defaultValue={assembly.target_price_usd || ''} onBlur={e => updateAssembly('target_price_usd', Number(e.target.value) || null)} />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-muted-foreground">Notes</label>
                  <Input className="h-7 text-xs" defaultValue={assembly.notes || ''} onBlur={e => updateAssembly('notes', e.target.value)} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Components Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Components</h2>
            <Dialog open={showAddComponent} onOpenChange={setShowAddComponent}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-7 text-xs">
                  <Plus className="h-3 w-3" /> Add Component
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Component Product</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger><SelectValue placeholder="Select a product..." /></SelectTrigger>
                    <SelectContent>
                      {availableProducts.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={addComponent} className="w-full" disabled={!selectedProductId}>Add to Assembly</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {components.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
              No components yet. Add products from this inquiry as components.
            </CardContent></Card>
          ) : (
            <div className="border rounded-md overflow-auto">
              <Table className="dense-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    <TableHead>Dims (in)</TableHead>
                    <TableHead>Carton Dims</TableHead>
                    <TableHead className="text-right">Qty/Asm</TableHead>
                    <TableHead className="text-right">Unit CBM</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Unit Cost (USD)</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {components.map(comp => {
                    const prod = comp.products;
                    const cost = componentCostData[comp.product_id];
                    return (
                      <TableRow key={comp.id}>
                        <TableCell>
                          <Link to={`/product/${comp.product_id}`} className="text-primary hover:underline font-medium text-xs">
                            {prod?.name || 'Unknown'}
                          </Link>
                          {prod?.sku && <span className="text-[10px] text-muted-foreground ml-1">({prod.sku})</span>}
                        </TableCell>
                        <TableCell className="text-xs">{fmt.dim(prod?.width_inch, prod?.depth_inch, prod?.height_inch)}</TableCell>
                        <TableCell className="text-xs">
                          {cost?.ic_width ? `${cost.ic_width}" × ${cost.ic_depth}" × ${cost.ic_height}"` : '—'}
                          {cost?.ic_type && <span className="text-[10px] text-muted-foreground ml-1">({cost.ic_type})</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input className="h-6 w-14 text-xs text-right inline-block" type="number" min={1}
                            defaultValue={comp.quantity_per_assembly || 1}
                            onBlur={e => updateComponentQty(comp.id, parseInt(e.target.value) || 1)} />
                        </TableCell>
                        <TableCell className="text-right text-xs calc-field">{cost ? fmt.cbm(cost.final_unit_cbm) : '—'}</TableCell>
                        <TableCell className="text-right text-xs calc-field">{cost ? fmt.inr(cost.product_cost_per_unit) : '—'}</TableCell>
                        <TableCell className="text-right text-xs calc-field">{cost ? fmt.usd(cost.unit_cost_usd) : '—'}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeComponent(comp.id)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell colSpan={4} className="text-xs">TOTAL per assembly ({assemblyCost.num_cartons} cartons)</TableCell>
                    <TableCell className="text-right text-xs">{fmt.cbm(assemblyCost.unit_cbm)}</TableCell>
                    <TableCell className="text-right text-xs">{fmt.inr(assemblyCost.unit_cost_inr)}</TableCell>
                    <TableCell className="text-right text-xs">{fmt.usd(assemblyCost.unit_cost_usd)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Pricing Summary */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-2">Assembly Pricing</h3>
            <div className="grid grid-cols-6 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px]">Combined Cost (INR)</span>
                <span className="font-mono font-semibold">{fmt.inr(assemblyCost.unit_cost_inr)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Combined Cost (USD)</span>
                <span className="font-mono font-semibold">{fmt.usd(assemblyCost.unit_cost_usd)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Margin ({(calc.markupToNpm(markupPercent) * 100).toFixed(1)}% NPM)</span>
                <span className="font-mono font-semibold">{fmt.usd(assemblyCost.unit_price_usd - assemblyCost.unit_cost_usd)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Unit Price (USD)</span>
                <span className="font-mono font-semibold text-primary">{fmt.usd(assemblyCost.unit_price_usd)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Total CBM</span>
                <span className="font-mono">{fmt.cbm(assemblyCost.unit_cbm)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Total Weight</span>
                <span className="font-mono">{assemblyCost.unit_weight_kg.toFixed(1)} kg</span>
              </div>
            </div>
            {assembly.target_price_usd && (
              <div className="mt-2 text-xs">
                {assemblyCost.unit_price_usd <= assembly.target_price_usd ? (
                  <span className="text-green-600 font-semibold">✓ Under target by {fmt.usd(assembly.target_price_usd - assemblyCost.unit_price_usd)}</span>
                ) : (
                  <span className="text-red-600 font-semibold">✗ Over target by {fmt.usd(assemblyCost.unit_price_usd - assembly.target_price_usd)}</span>
                )}
              </div>
            )}
            {/* Revenue summary */}
            <div className="mt-3 pt-3 border-t grid grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px]">Total Revenue ({assembly.quantity} units)</span>
                <span className="font-mono font-semibold">{fmt.usd(assemblyCost.unit_price_usd * (assembly.quantity || 0))}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Total Cost</span>
                <span className="font-mono">{fmt.usd(assemblyCost.unit_cost_usd * (assembly.quantity || 0))}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Total Profit</span>
                <span className="font-mono font-semibold">{fmt.usd((assemblyCost.unit_price_usd - assemblyCost.unit_cost_usd) * (assembly.quantity || 0))}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Total CBM</span>
                <span className="font-mono">{fmt.cbm(assemblyCost.unit_cbm * (assembly.quantity || 0))}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AssemblyDetail;
