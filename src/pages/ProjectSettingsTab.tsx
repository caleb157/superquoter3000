import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { Download, FileText, FileSpreadsheet, Loader2, Upload, Building2, History, RefreshCw, Link2, Copy } from 'lucide-react';
import * as calc from '@/lib/calculations';
import { exportToExcel, downloadSummaryPDF, generateCustomerQuotePDF, type ExportProduct, type ExportAggregates, type ExportContext, type QuotePDFResult } from '@/lib/exports';

interface ProjectSettingsTabProps {
  projectId: string;
}

const ProjectSettingsTab = ({ projectId }: ProjectSettingsTabProps) => {
  const [settings, setSettings] = useState<any>(null);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const customerLogoRef = useRef<HTMLInputElement>(null);
  const fetchSnapshots = async () => {
    const { data } = await (supabase as any).from('quote_snapshots')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    setSnapshots(data || []);
  };

  useEffect(() => {
    const fetchData = async () => {
      const [settingsRes, gsRes, stRes, projRes, entRes] = await Promise.all([
        supabase.from('project_settings').select('*').eq('project_id', projectId).maybeSingle(),
        supabase.from('global_settings').select('*').limit(1).single(),
        supabase.from('shipping_types').select('*').order('name'),
        supabase.from('projects').select('name, customer_name').eq('id', projectId).single(),
        (supabase as any).from('company_entities').select('*').order('name'),
      ]);

      setGlobalSettings(gsRes.data);
      setShippingTypes(stRes.data || []);
      setEntities(entRes.data || []);
      setProjectName(projRes.data?.name || 'Project');
      setCustomerName(projRes.data?.customer_name || '');

      if (settingsRes.data) {
        setSettings(settingsRes.data);
      } else {
        const { data } = await supabase.from('project_settings').insert({
          project_id: projectId,
        } as any).select().single();
        if (data) setSettings(data);
      }

      await fetchSnapshots();
      setLoading(false);
    };
    fetchData();
  }, [projectId]);

  const updateSetting = async (field: string, value: any) => {
    if (!settings) return;
    setSettings((s: any) => ({ ...s, [field]: value }));
    const { error } = await supabase.from('project_settings').update({ [field]: value } as any).eq('id', settings.id);
    if (error) toast.error('Failed to save setting');
  };

  // Fetch all product data for export
  const buildExportContext = async (): Promise<ExportContext | null> => {
    const [productsRes, gsRes, empRes, stRes, boxRes, ptRes] = await Promise.all([
      supabase.from('products').select('*').eq('project_id', projectId).order('sort_order'),
      supabase.from('global_settings').select('*').limit(1).single(),
      supabase.from('labor_employees').select('*'),
      supabase.from('shipping_types').select('*'),
      supabase.from('box_data').select('*'),
      supabase.from('product_types').select('*'),
    ]);

    const products = productsRes.data || [];
    const gs = gsRes.data;
    const employees = empRes.data || [];
    const shTypes = stRes.data || [];
    const productTypes = ptRes.data || [];

    // Use project-level exchange rate override if set
    const exchangeRate = (settings && !settings.use_global_exchange_rate && settings.exchange_rate_override)
      ? settings.exchange_rate_override : (gs?.exchange_rate || 90);

    const productIds = products.map((p: any) => p.id);
    if (productIds.length === 0) { toast.error('No products to export'); return null; }

    const [cogsRes, nucRes, ohRes, shipRes, cbmRes] = await Promise.all([
      supabase.from('cogs_items').select('*').in('product_id', productIds),
      supabase.from('non_unit_cogs').select('*').in('product_id', productIds),
      supabase.from('overhead_items').select('*').in('product_id', productIds),
      supabase.from('shipping_items').select('*').in('product_id', productIds),
      supabase.from('cbm_estimates').select('*').in('product_id', productIds),
    ]);

    const allCogs = cogsRes.data || [];
    const allNuc = nucRes.data || [];
    const allOh = ohRes.data || [];
    const allShip = shipRes.data || [];
    const allCbm = cbmRes.data || [];

    const exportProducts: ExportProduct[] = products.map((p: any) => {
      const cbmEst = allCbm.find((c: any) => c.product_id === p.id);
      const pCogs = allCogs.filter((c: any) => c.product_id === p.id);
      const pNuc = allNuc.filter((c: any) => c.product_id === p.id);
      const pOh = allOh.filter((c: any) => c.product_id === p.id);
      const pShip = allShip.filter((c: any) => c.product_id === p.id);
      const qty = p.quantity || 100;

      // Use persisted CBM, or compute on-the-fly as fallback
      let unit_cbm = cbmEst?.final_unit_cbm || 0;
      if (unit_cbm === 0 && p.width_inch && p.depth_inch && p.height_inch) {
        const ptType = productTypes.find((t: any) => t.id === p.product_type_id);
        const icAdd = ptType?.ic_addition_per_side_inch || 0.5;
        const icDims = calc.calcICDimensions(p.width_inch, p.depth_inch, p.height_inch, icAdd);
        const icVol = calc.calcICVolumeCbm(icDims.ic_width, icDims.ic_depth, icDims.ic_height);
        const productsPerIc = cbmEst?.products_per_ic || 1;
        const includeMc = cbmEst?.include_mc ?? true;
        if (includeMc) {
          const mcPack = calc.calcMCPacking({
            include_mc: true, mc_type: cbmEst?.mc_type || '7 ply',
            mc_max_width: cbmEst?.mc_max_width || 25, mc_max_depth: cbmEst?.mc_max_depth || 25,
            mc_max_height: cbmEst?.mc_max_height || 25, mc_buffer_inch: cbmEst?.mc_buffer_inch || 1,
            mc_weight_limit_kg: cbmEst?.mc_weight_limit_kg || 20, mc_empty_weight_kg: cbmEst?.mc_empty_weight_kg || 1.5,
            product_weight_kg: p.weight_kg || 0, quantity: qty, products_per_ic: productsPerIc,
            ic_width: icDims.ic_width, ic_depth: icDims.ic_depth, ic_height: icDims.ic_height,
          });
          unit_cbm = calc.calcFinalUnitCbm(true, icVol, productsPerIc, mcPack.mc_volume_cbm, mcPack.products_per_mc);
        } else {
          unit_cbm = calc.calcFinalUnitCbm(false, icVol, productsPerIc, 0, 0);
        }
      }
      const total_cbm = unit_cbm * qty;

      const cogsPerUnit = pCogs
        .filter((i: any) => i.include !== 'No')
        .reduce((sum: number, item: any) => {
          const c = calc.calcCogsItemCost({
            include: item.include, components_per_product: item.components_per_product || 0,
            unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0,
          });
          return sum + c.unit_cost;
        }, 0);

      const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
        pNuc.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr })), qty
      );

      const ohItems = pOh.map((item: any) => ({
        include: item.include, labor_type: item.labor_type,
        man_hours_per_unit: item.man_hours_per_unit || 0,
        hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
      }));
      const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
      const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
      const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs) : 0;
      const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

      const shipItem = pShip[0];
      const shipType = shTypes.find((s: any) => s.id === shipItem?.shipping_type_id);
      const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
        cost_inr: shipType.cost_inr, per_unit: shipType.per_unit as 'CBM' | 'KG',
        final_unit_cbm: unit_cbm, weight_kg: p.weight_kg || 0,
      }) : 0;

      const markupPercent = (settings?.apply_uniform_markup && settings.default_markup_override != null)
        ? settings.default_markup_override : (p.markup_percent || 0.2);

      const summary = calc.calcProductCostSummary(
        cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
        shippingPerUnit, markupPercent, exchangeRate, qty
      );

      const reviewCount = pCogs.filter((i: any) => i.include === 'Review').length +
        pOh.filter((i: any) => i.include === 'Review').length;

      let remaining_to_target_inr: number | null = null;
      if (p.target_price_usd && summary.unit_price_usd > 0) {
        const targetCostRatio = summary.product_cost_per_unit_inr / summary.unit_price_inr;
        remaining_to_target_inr = (p.target_price_usd * targetCostRatio - summary.product_cost_per_unit_usd) * exchangeRate;
      }

      return {
        name: p.name, sku: p.sku, quantity: qty,
        target_price_usd: p.target_price_usd, markup_percent: markupPercent,
        cbm_done: p.cbm_done, cogs_done: p.cogs_done,
        overhead_done: p.overhead_done, shipping_done: p.shipping_done, revenue_done: p.revenue_done,
        unit_cbm, total_cbm,
        unit_cost_inr: summary.product_cost_per_unit_inr,
        unit_cost_usd: summary.product_cost_per_unit_usd,
        unit_price_usd: summary.unit_price_usd,
        total_cost_usd: summary.product_cost_per_unit_usd * qty,
        total_revenue_usd: summary.unit_price_usd * qty,
        total_profit_usd: (summary.unit_price_usd - summary.product_cost_per_unit_usd) * qty,
        gpm: summary.gpm, npm: summary.npm,
        remaining_to_target_inr,
        total_direct_mh: totalDirectMhPerUnit * qty,
        total_cogs: (cogsPerUnit + nonUnitCogsPerUnit) * qty,
        total_direct_oh: directOhPerUnit * qty,
        total_indirect_oh: indirectOhPerUnit * qty,
        total_shipping: shippingPerUnit * qty,
        review_count: reviewCount,
        width_inch: p.width_inch, depth_inch: p.depth_inch, height_inch: p.height_inch,
        weight_kg: p.weight_kg, finishing_difficulty: p.finishing_difficulty,
      };
    });

    // Aggregates
    const totalQty = exportProducts.reduce((s, r) => s + r.quantity, 0);
    const totalCbm = exportProducts.reduce((s, r) => s + r.total_cbm, 0);
    const totalCost = exportProducts.reduce((s, r) => s + r.total_cost_usd, 0);
    const totalRevenue = exportProducts.reduce((s, r) => s + r.total_revenue_usd, 0);
    const totalProfit = exportProducts.reduce((s, r) => s + r.total_profit_usd, 0);
    const weightedGpm = totalRevenue > 0 ? exportProducts.reduce((s, r) => s + r.gpm * r.total_revenue_usd, 0) / totalRevenue : 0;
    const weightedNpm = totalRevenue > 0 ? exportProducts.reduce((s, r) => s + r.npm * r.total_revenue_usd, 0) / totalRevenue : 0;
    const totalMh = exportProducts.reduce((s, r) => s + r.total_direct_mh, 0);
    const totalReview = exportProducts.reduce((s, r) => s + r.review_count, 0);
    const fullyCosted = exportProducts.filter(r => r.cbm_done && r.cogs_done && r.overhead_done && r.shipping_done && r.revenue_done).length;
    const bCogs = exportProducts.reduce((s, r) => s + r.total_cogs, 0);
    const bDoh = exportProducts.reduce((s, r) => s + r.total_direct_oh, 0);
    const bIoh = exportProducts.reduce((s, r) => s + r.total_indirect_oh, 0);
    const bShip = exportProducts.reduce((s, r) => s + r.total_shipping, 0);
    const bTotal = bCogs + bDoh + bIoh + bShip;

    const aggregates: ExportAggregates = {
      skuCount: exportProducts.length, totalQty, totalCbm, totalCost, totalRevenue,
      totalProfit, weightedGpm, weightedNpm, totalMh, totalReview, fullyCosted,
      bCogs, bDoh, bIoh, bShip, bTotal,
    };

    // Find entity
    const selectedEntity = settings?.quoting_entity_id
      ? entities.find((e: any) => e.id === settings.quoting_entity_id)
      : entities[0] || null;

    return {
      projectName,
      customerName: customerName || undefined,
      customerLogoUrl: settings?.customer_logo_url || undefined,
      products: exportProducts,
      aggregates,
      exchangeRate,
      quoteTitle: settings?.quote_title,
      quoteNotes: settings?.quote_notes,
      quoteValidityDays: settings?.quote_validity_days,
      quoteCurrency: settings?.quote_currency,
      showCbm: settings?.show_cbm_on_quote ?? true,
      showDimensions: settings?.show_dimensions_on_quote ?? true,
      showWeight: settings?.show_weight_on_quote ?? false,
      showSku: settings?.show_sku_on_quote ?? true,
      showPhotos: settings?.show_photos_on_quote ?? true,
      entity: selectedEntity || undefined,
    };
  };

  const handleExport = async (type: 'excel' | 'pdf' | 'quote') => {
    setExporting(type);
    try {
      const ctx = await buildExportContext();
      if (!ctx) { setExporting(null); return; }

      switch (type) {
        case 'excel': exportToExcel(ctx); toast.success('Excel exported'); break;
        case 'pdf': downloadSummaryPDF(ctx); toast.success('Summary PDF downloaded'); break;
        case 'quote': {
          const result = await generateCustomerQuotePDF(ctx);
          // Save snapshot
          const snapshotProducts = ctx.products.map(p => ({
            name: p.name, sku: p.sku, quantity: p.quantity,
            unit_price_usd: p.unit_price_usd, total_usd: p.unit_price_usd * p.quantity,
            unit_cbm: p.unit_cbm,
          }));
          await (supabase as any).from('quote_snapshots').insert({
            project_id: projectId,
            entity_id: settings?.quoting_entity_id || null,
            quote_number: result.quoteNumber,
            currency: result.currency,
            valid_until: result.validUntil,
            status: 'draft',
            products: snapshotProducts,
            totals: {
              grand_total: result.grandTotal,
              total_qty: ctx.aggregates.totalQty,
              total_cbm: ctx.aggregates.totalCbm,
              sku_count: ctx.aggregates.skuCount,
            },
          });
          await fetchSnapshots();
          toast.success(`Quote ${result.quoteNumber} generated`);
          break;
        }
      }
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`);
    }
    setExporting(null);
  };

  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading settings...</div>;
  if (!settings) return <div className="py-12 text-center text-muted-foreground">Error loading settings.</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Pricing & Currency */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pricing & Currency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Exchange Rate</Label>
              <p className="text-[10px] text-muted-foreground">
                Global rate: ₹{globalSettings?.exchange_rate || 90}/USD
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={!settings.use_global_exchange_rate}
                onCheckedChange={(v) => updateSetting('use_global_exchange_rate', !v)}
              />
              <span className="text-xs">{settings.use_global_exchange_rate ? 'Using global' : 'Custom'}</span>
            </div>
          </div>
          {!settings.use_global_exchange_rate && (
            <Input
              className="h-8 text-sm w-32"
              type="number"
              value={settings.exchange_rate_override || ''}
              onChange={e => updateSetting('exchange_rate_override', Number(e.target.value) || null)}
              placeholder="₹/USD"
            />
          )}

          <div>
            <Label className="text-xs">Quote Currency</Label>
            <RadioGroup
              value={settings.quote_currency || 'USD'}
              onValueChange={v => updateSetting('quote_currency', v)}
              className="flex gap-4 mt-1"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="USD" id="usd" />
                <Label htmlFor="usd" className="text-xs">USD ($)</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="INR" id="inr" />
                <Label htmlFor="inr" className="text-xs">INR (₹)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Default Markup</Label>
              <p className="text-[10px] text-muted-foreground">Override per-product markups with a uniform value</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={settings.apply_uniform_markup || false}
                onCheckedChange={(v) => updateSetting('apply_uniform_markup', v)}
              />
              <span className="text-xs">{settings.apply_uniform_markup ? 'Uniform' : 'Per-product'}</span>
            </div>
          </div>
          {settings.apply_uniform_markup && (
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-sm w-24"
                type="number"
                value={settings.default_markup_override != null ? (settings.default_markup_override * 100) : ''}
                onChange={e => updateSetting('default_markup_override', Number(e.target.value) / 100 || null)}
                placeholder="%"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shipping */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Shipping</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Shipping Type</Label>
              <p className="text-[10px] text-muted-foreground">
                Global default: {globalSettings?.default_shipping_type || 'FOB Jodhpur'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={!settings.use_global_shipping}
                onCheckedChange={(v) => updateSetting('use_global_shipping', !v)}
              />
              <span className="text-xs">{settings.use_global_shipping ? 'Using global' : 'Custom'}</span>
            </div>
          </div>
          {!settings.use_global_shipping && (
            <Select value={settings.shipping_type_override || ''} onValueChange={v => updateSetting('shipping_type_override', v)}>
              <SelectTrigger className="h-8 text-sm w-64">
                <SelectValue placeholder="Select shipping type..." />
              </SelectTrigger>
              <SelectContent>
                {shippingTypes.map(st => (
                  <SelectItem key={st.id} value={st.name}>{st.name} — {fmt.inr(st.cost_inr)}/{st.per_unit}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* RFQ Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">RFQ Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">RFQ Discount %</Label>
            <p className="text-[10px] text-muted-foreground mb-1">
              When generating RFQs, target prices will be set this % below our cost estimate
            </p>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-sm w-24"
                type="number"
                value={((settings.rfq_discount_percent || 0.1) * 100).toFixed(0)}
                onChange={e => updateSetting('rfq_discount_percent', Number(e.target.value) / 100)}
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quote Appearance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Quote Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Quote Title</Label>
            <Input
              className="h-8 text-sm"
              value={settings.quote_title || ''}
              onChange={e => updateSetting('quote_title', e.target.value)}
              placeholder="e.g. Spring 2026 Collection"
            />
          </div>
          <div>
            <Label className="text-xs">Quote Notes / Terms</Label>
            <Textarea
              className="text-sm min-h-[80px]"
              value={settings.quote_notes || ''}
              onChange={e => updateSetting('quote_notes', e.target.value)}
              placeholder="Payment terms, shipping terms, validity..."
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Quote Validity (days)</Label>
            <Input
              className="h-8 text-sm w-20"
              type="number"
              value={settings.quote_validity_days || 30}
              onChange={e => updateSetting('quote_validity_days', parseInt(e.target.value) || 30)}
            />
          </div>
          <div>
            <Label className="text-xs mb-2 block">Show on Quote</Label>
            <div className="flex flex-wrap gap-4">
              {[
                { key: 'show_photos_on_quote', label: 'Photos' },
                { key: 'show_sku_on_quote', label: 'SKU' },
                { key: 'show_dimensions_on_quote', label: 'Dimensions' },
                { key: 'show_cbm_on_quote', label: 'CBM' },
                { key: 'show_weight_on_quote', label: 'Weight' },
              ].map(opt => (
                <label key={opt.key} className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={settings[opt.key] ?? true}
                    onCheckedChange={v => updateSetting(opt.key, !!v)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quoting Entity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Quoting Entity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Select company entity for this quote</Label>
            <Select
              value={settings.quoting_entity_id || ''}
              onValueChange={v => updateSetting('quoting_entity_id', v || null)}
            >
              <SelectTrigger className="h-8 text-sm w-72 mt-1">
                <SelectValue placeholder="Select entity..." />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>
                    <span className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5" />
                      {e.name} ({e.entity_type || '?'})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Customer Logo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Customer Logo</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          {settings.customer_logo_url ? (
            <img src={settings.customer_logo_url} alt="Customer logo" className="h-14 w-auto max-w-[180px] object-contain border rounded p-1" />
          ) : (
            <div className="h-14 w-28 border border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">No logo</div>
          )}
          <div>
            <input ref={customerLogoRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const ext = file.name.split('.').pop();
              const path = `${projectId}.${ext}`;
              const { error: uploadErr } = await supabase.storage.from('customer-logos').upload(path, file, { upsert: true });
              if (uploadErr) { toast.error(uploadErr.message); return; }
              const { data: urlData } = supabase.storage.from('customer-logos').getPublicUrl(path);
              updateSetting('customer_logo_url', urlData.publicUrl);
              toast.success('Customer logo uploaded');
            }} />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => customerLogoRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Upload Logo
            </Button>
            {settings.customer_logo_url && (
              <Button variant="ghost" size="sm" className="text-destructive ml-2" onClick={() => updateSetting('customer_logo_url', null)}>
                Remove
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quote History */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" /> Quote History
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchSnapshots}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-xs text-muted-foreground">No quotes generated yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Quote #</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Valid Until</TableHead>
                  <TableHead className="text-xs">Currency</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snap: any) => {
                  const totals = snap.totals as any;
                  const sym = snap.currency === 'INR' ? '₹' : '$';
                  const statusColor = snap.status === 'approved' ? 'default' : snap.status === 'sent' ? 'secondary' : 'outline';
                  return (
                    <TableRow key={snap.id}>
                      <TableCell className="text-xs font-mono">{snap.quote_number || '—'}</TableCell>
                      <TableCell className="text-xs">{new Date(snap.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs">{snap.valid_until ? new Date(snap.valid_until).toLocaleDateString() : '—'}</TableCell>
                      <TableCell className="text-xs">{snap.currency || 'USD'}</TableCell>
                      <TableCell className="text-xs text-right font-medium">
                        {totals?.grand_total != null ? `${sym}${Number(totals.grand_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusColor as any} className="text-[10px]">{snap.status || 'draft'}</Badge>
                      </TableCell>
                      <TableCell className="flex gap-1">
                        <Button
                          variant="ghost" size="sm" className="text-xs h-7 gap-1"
                          onClick={async () => {
                            const ctx = await buildExportContext();
                            if (!ctx) return;
                            ctx.quoteNumber = snap.quote_number;
                            await generateCustomerQuotePDF(ctx);
                            toast.success('Quote PDF regenerated');
                          }}
                        >
                          <FileText className="h-3 w-3" /> PDF
                        </Button>
                        {snap.share_token && (
                          <Button
                            variant="ghost" size="sm" className="text-xs h-7 gap-1"
                            onClick={() => {
                              const url = `${window.location.origin}/quote/${snap.share_token}`;
                              navigator.clipboard.writeText(url);
                              toast.success('Share link copied!');
                            }}
                          >
                            <Copy className="h-3 w-3" /> Link
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleExport('pdf')} disabled={!!exporting}>
            {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download Summary PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleExport('quote')} disabled={!!exporting}>
            {exporting === 'quote' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            Generate Customer Quote
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleExport('excel')} disabled={!!exporting}>
            {exporting === 'excel' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            Export to Excel
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectSettingsTab;
