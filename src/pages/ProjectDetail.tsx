import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, ArrowLeft, Package, Download, FileText, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { UploadParseDialog } from '@/components/UploadParseDialog';
import { SortableHeader } from '@/components/SortableHeader';
import { ProductStatusIndicator, getStatusLevel } from '@/components/ProductStatusIndicator';
import { useTableSort } from '@/hooks/use-table-sort';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';
import { exportToExcel, downloadSummaryPDF, generateCustomerQuotePDF, type ExportProduct, type ExportAggregates, type ExportContext } from '@/lib/exports';
import ProjectSummary from './ProjectSummary';
import ProjectSettingsTab from './ProjectSettingsTab';

const STATUS_OPTIONS = ['draft', 'costing', 'quoted', 'po_confirmed', 'archived'];

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductTypeId, setNewProductTypeId] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [showUploadParse, setShowUploadParse] = useState(false);
  const activeTab = searchParams.get('tab') || 'products';
  const setActiveTab = (tab: string) => setSearchParams({ tab });

  const fetchProject = async () => {
    if (!id) return;
    const { data } = await supabase.from('projects').select('*').eq('id', id).single();
    if (data) setProject(data);
  };

  const fetchProducts = async () => {
    if (!id) return;
    const { data } = await supabase.from('products').select('*').eq('project_id', id).order('sort_order');
    if (data) setProducts(data);
  };

  const fetchProductTypes = async () => {
    const { data } = await supabase.from('product_types').select('*').order('name');
    if (data) setProductTypes(data);
  };

  useEffect(() => {
    fetchProject();
    fetchProducts();
    fetchProductTypes();
  }, [id]);

  const updateProject = async (field: string, value: any) => {
    if (!id) return;
    const { error } = await supabase.from('projects').update({ [field]: value } as any).eq('id', id);
    if (error) toast.error(error.message);
    else setProject({ ...project, [field]: value });
  };

  const addProduct = async () => {
    if (!newProductName.trim() || !id) return;
    const { data, error } = await supabase.from('products').insert({
      project_id: id,
      name: newProductName.trim(),
      product_type_id: newProductTypeId || null,
      sort_order: products.length,
    }).select().single();

    if (error) { toast.error(error.message); return; }

    if (data) {
      const defaultCogs = [
        { product_id: data.id, cogs_type: 'Raw Piece', component_name: 'Raw Piece 1', sort_order: 0 },
        { product_id: data.id, cogs_type: 'Raw Piece', component_name: 'Raw Piece 2', sort_order: 1 },
        { product_id: data.id, cogs_type: 'Subcontracting', component_name: 'Subcontracting 1', sort_order: 2 },
        { product_id: data.id, cogs_type: 'Subcontracting', component_name: 'Subcontracting 2', sort_order: 3 },
        { product_id: data.id, cogs_type: 'Finishing Materials', component_name: 'Color', is_auto_calculated: true, sort_order: 4 },
        { product_id: data.id, cogs_type: 'Finishing Materials', component_name: 'Sealer', is_auto_calculated: true, sort_order: 5 },
        { product_id: data.id, cogs_type: 'Finishing Materials', component_name: 'Lacquer', is_auto_calculated: true, sort_order: 6 },
        { product_id: data.id, cogs_type: 'Packaging', component_name: 'IC Box', is_auto_calculated: true, waste_factor: 0.05, sort_order: 7 },
        { product_id: data.id, cogs_type: 'Packaging', component_name: 'MC Box', is_auto_calculated: true, sort_order: 8 },
        { product_id: data.id, cogs_type: 'Packaging', component_name: 'Other Packaging', sort_order: 9 },
        { product_id: data.id, cogs_type: 'Hardware', component_name: 'Hardware 1', waste_factor: 0.05, sort_order: 10 },
        { product_id: data.id, cogs_type: 'Hardware', component_name: 'Hardware 2', waste_factor: 0.05, sort_order: 11 },
        { product_id: data.id, cogs_type: 'Accessories', component_name: 'Accessory 1', waste_factor: 0.05, sort_order: 12 },
        { product_id: data.id, cogs_type: 'Accessories', component_name: 'Accessory 2', waste_factor: 0.05, sort_order: 13 },
      ];
      await supabase.from('cogs_items').insert(defaultCogs as any);

      const defaultOverhead = [
        { product_id: data.id, labor_type: 'Manufacturing', sort_order: 0 },
        { product_id: data.id, labor_type: 'QC', man_hours_per_unit: 0.05, sort_order: 1 },
        { product_id: data.id, labor_type: 'Sanding', sort_order: 2 },
        { product_id: data.id, labor_type: 'Finishing', is_auto_estimated: true, sort_order: 3 },
        { product_id: data.id, labor_type: 'Assembly', sort_order: 4 },
        { product_id: data.id, labor_type: 'Packaging', is_auto_estimated: true, sort_order: 5 },
        { product_id: data.id, labor_type: 'Market', sort_order: 6 },
      ];
      await supabase.from('overhead_items').insert(defaultOverhead as any);

      await supabase.from('cbm_estimates').insert({ product_id: data.id } as any);

      // Auto-add "Auto Transport" non-unit COGS
      const { data: gs } = await supabase.from('global_settings').select('auto_transport_cost_per_cbm').limit(1).single();
      const autoTransportRate = (gs as any)?.auto_transport_cost_per_cbm || 500;
      await (supabase as any).from('non_unit_cogs').insert({
        product_id: data.id,
        name: 'Auto Transport',
        total_quantity: 1,
        cost_each_inr: 0,
        include: 'Yes',
        sort_order: 0,
      });
    }

    toast.success('Product created with default BOM');
    setNewProductName(''); setNewProductTypeId(''); setShowAddProduct(false);
    fetchProducts();
  };

  // Export functionality
  const buildExportContext = async (): Promise<ExportContext | null> => {
    const [productsRes, gsRes, empRes, stRes, settingsRes, entRes] = await Promise.all([
      supabase.from('products').select('*').eq('project_id', id!).order('sort_order'),
      supabase.from('global_settings').select('*').limit(1).single(),
      supabase.from('labor_employees').select('*'),
      supabase.from('shipping_types').select('*'),
      supabase.from('project_settings').select('*').eq('project_id', id!).maybeSingle(),
      (supabase as any).from('company_entities').select('*').order('name'),
    ]);

    const prods = productsRes.data || [];
    const gs = gsRes.data;
    const employees = empRes.data || [];
    const shTypes = stRes.data || [];
    const ps = settingsRes.data as any;

    const exchangeRate = (ps && !ps.use_global_exchange_rate && ps.exchange_rate_override)
      ? ps.exchange_rate_override : (gs?.exchange_rate || 90);

    const productIds = prods.map((p: any) => p.id);
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

    const exportProducts: ExportProduct[] = prods.map((p: any) => {
      const cbmEst = allCbm.find((c: any) => c.product_id === p.id);
      const pCogs = allCogs.filter((c: any) => c.product_id === p.id);
      const pNuc = allNuc.filter((c: any) => c.product_id === p.id);
      const pOh = allOh.filter((c: any) => c.product_id === p.id);
      const pShip = allShip.filter((c: any) => c.product_id === p.id);
      const pQty = p.quantity || 100;
      const unit_cbm = cbmEst?.final_unit_cbm || 0;
      const total_cbm = unit_cbm * pQty;

      const cogsPerUnit = pCogs.filter((i: any) => i.include !== 'No').reduce((sum: number, item: any) => {
        const c = calc.calcCogsItemCost({ include: item.include, components_per_product: item.components_per_product || 0, unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0 });
        return sum + c.unit_cost;
      }, 0);
      const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(pNuc.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr })), pQty);
      const ohItems = pOh.map((item: any) => ({ include: item.include, labor_type: item.labor_type, man_hours_per_unit: item.man_hours_per_unit || 0, hourly_rate: calc.avgRateByDesignation(employees, item.labor_type) }));
      const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, pQty);
      const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
      const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs) : 0;
      const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);
      const shipItem = pShip[0];
      const shipType = shTypes.find((s: any) => s.id === shipItem?.shipping_type_id);
      const shippingPerUnit = shipType ? calc.calcShippingPerUnit({ cost_inr: shipType.cost_inr, per_unit: shipType.per_unit as 'CBM' | 'KG', final_unit_cbm: unit_cbm, weight_kg: p.weight_kg || 0 }) : 0;
      const markupPercent = (ps?.apply_uniform_markup && ps.default_markup_override != null) ? ps.default_markup_override : (p.markup_percent || 0.2);
      const summary = calc.calcProductCostSummary(cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit, shippingPerUnit, markupPercent, exchangeRate, pQty);
      const reviewCount = pCogs.filter((i: any) => i.include === 'Review').length + pOh.filter((i: any) => i.include === 'Review').length;
      let remaining_to_target_inr: number | null = null;
      if (p.target_price_usd && summary.unit_price_usd > 0) {
        const targetCostRatio = summary.product_cost_per_unit_inr / summary.unit_price_inr;
        remaining_to_target_inr = (p.target_price_usd * targetCostRatio - summary.product_cost_per_unit_usd) * exchangeRate;
      }
      return {
        name: p.name, sku: p.sku, quantity: pQty, target_price_usd: p.target_price_usd, markup_percent: markupPercent,
        cbm_done: p.cbm_done, cogs_done: p.cogs_done, overhead_done: p.overhead_done, shipping_done: p.shipping_done, revenue_done: p.revenue_done,
        unit_cbm, total_cbm, unit_cost_inr: summary.product_cost_per_unit_inr, unit_cost_usd: summary.product_cost_per_unit_usd,
        unit_price_usd: summary.unit_price_usd, total_cost_usd: summary.product_cost_per_unit_usd * pQty,
        total_revenue_usd: summary.unit_price_usd * pQty, total_profit_usd: (summary.unit_price_usd - summary.product_cost_per_unit_usd) * pQty,
        gpm: summary.gpm, npm: summary.npm, remaining_to_target_inr,
        total_direct_mh: totalDirectMhPerUnit * pQty, total_cogs: (cogsPerUnit + nonUnitCogsPerUnit) * pQty,
        total_direct_oh: directOhPerUnit * pQty, total_indirect_oh: indirectOhPerUnit * pQty,
        total_shipping: shippingPerUnit * pQty, review_count: reviewCount,
        width_inch: p.width_inch, depth_inch: p.depth_inch, height_inch: p.height_inch, weight_kg: p.weight_kg, finishing_difficulty: p.finishing_difficulty,
      };
    });

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

    const allEntities = entRes.data || [];
    const selectedEntity = ps?.quoting_entity_id
      ? allEntities.find((e: any) => e.id === ps.quoting_entity_id)
      : allEntities[0] || null;

    return {
      projectName: project.name, customerName: project.customer_name || undefined,
      customerEmail: project.customer_email || undefined,
      customerLogoUrl: ps?.customer_logo_url || undefined,
      products: exportProducts,
      aggregates: { skuCount: exportProducts.length, totalQty, totalCbm, totalCost, totalRevenue, totalProfit, weightedGpm, weightedNpm, totalMh, totalReview, fullyCosted, bCogs, bDoh, bIoh, bShip, bTotal },
      exchangeRate,
      quoteTitle: ps?.quote_title, quoteNotes: ps?.quote_notes, quoteValidityDays: ps?.quote_validity_days,
      quoteCurrency: ps?.quote_currency, showCbm: ps?.show_cbm_on_quote ?? true,
      showDimensions: ps?.show_dimensions_on_quote ?? true, showWeight: ps?.show_weight_on_quote ?? false,
      showSku: ps?.show_sku_on_quote ?? true, showPhotos: ps?.show_photos_on_quote ?? true,
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
        case 'quote': await generateCustomerQuotePDF(ctx); toast.success('Customer quote generated'); break;
      }
    } catch (err: any) { toast.error(`Export failed: ${err.message}`); }
    setExporting(null);
  };

  if (!project) return <AppLayout><div className="text-center py-12">Loading...</div></AppLayout>;

  const statusDot = (done: boolean | null) => (
    <span className={`status-dot ${done ? 'status-done' : 'status-pending'}`} />
  );

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <Input
              className="text-lg font-bold border-transparent hover:border-input h-9 px-2"
              defaultValue={project.name}
              onBlur={(e) => updateProject('name', e.target.value)}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" disabled={!!exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('pdf')} className="gap-2 text-xs">
                <Download className="h-3.5 w-3.5" /> Summary PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('quote')} className="gap-2 text-xs">
                <FileText className="h-3.5 w-3.5" /> Customer Quote
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('excel')} className="gap-2 text-xs">
                <FileSpreadsheet className="h-3.5 w-3.5" /> Export to Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Select value={project.status} onValueChange={(v) => updateProject('status', v)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Customer info */}
        <div className="flex gap-3">
          <Input
            className="h-8 text-sm"
            placeholder="Customer name"
            defaultValue={project.customer_name || ''}
            onBlur={(e) => updateProject('customer_name', e.target.value)}
          />
          <Input
            className="h-8 text-sm"
            placeholder="Customer email"
            defaultValue={project.customer_email || ''}
            onBlur={(e) => updateProject('customer_email', e.target.value)}
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="products">Products ({products.length})</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            {/* Add product buttons */}
            <div className="flex items-center justify-between mb-2">
              <div />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => setShowUploadParse(true)}>
                  <Upload className="h-3 w-3" /> Upload & Parse
                </Button>
                <Dialog open={showAddProduct} onOpenChange={setShowAddProduct}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-1.5 h-7 text-xs">
                      <Plus className="h-3 w-3" /> Add Product
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Product</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <Input placeholder="Product name" value={newProductName} onChange={e => setNewProductName(e.target.value)} autoFocus />
                      <Select value={newProductTypeId} onValueChange={setNewProductTypeId}>
                        <SelectTrigger><SelectValue placeholder="Product type" /></SelectTrigger>
                        <SelectContent>
                          {productTypes.map(pt => (
                            <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={addProduct} className="w-full">Create Product</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <UploadParseDialog
              open={showUploadParse}
              onOpenChange={setShowUploadParse}
              projectId={id!}
              productTypes={productTypes}
              onProductsCreated={fetchProducts}
            />

            {products.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No products yet. Add your first product to start costing.</p>
              </CardContent></Card>
            ) : (
              <div className="border rounded-md overflow-auto">
                <Table className="dense-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Dims (in)</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit CBM</TableHead>
                      <TableHead className="text-right">Cost (USD)</TableHead>
                      <TableHead className="text-right">Price (USD)</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map(p => (
                      <TableRow key={p.id} className="cursor-pointer hover:bg-accent/50"
                        onClick={() => navigate(`/product/${p.id}`)}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-muted-foreground">{p.sku || '—'}</TableCell>
                        <TableCell>{fmt.dim(p.width_inch, p.depth_inch, p.height_inch)}</TableCell>
                        <TableCell className="text-right">{fmt.qty(p.quantity)}</TableCell>
                        <TableCell className="text-right calc-field">—</TableCell>
                        <TableCell className="text-right calc-field">—</TableCell>
                        <TableCell className="text-right calc-field">—</TableCell>
                        <TableCell className="text-center space-x-1">
                          {statusDot(p.cbm_done)}
                          {statusDot(p.cogs_done)}
                          {statusDot(p.overhead_done)}
                          {statusDot(p.shipping_done)}
                          {statusDot(p.revenue_done)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="summary">
            {id && <ProjectSummary projectId={id} />}
          </TabsContent>

          <TabsContent value="settings">
            {id && <ProjectSettingsTab projectId={id} />}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default ProjectDetail;
