import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, FileText, DollarSign, Package2, ListChecks, Layers } from 'lucide-react';
import { ProductSummaryTab } from '@/components/ProductSummaryTab';
import { ProductCostingTab } from '@/components/ProductCostingTab';
import { ProductSampleLogTab } from '@/components/ProductSampleLogTab';
import { ProductTasksTab } from '@/components/ProductTasksTab';
import { ProductVariantsTab } from '@/components/ProductVariantsTab';
import { ProductStagePills, type StageTrack } from '@/components/ProductStagePills';
import { Input } from '@/components/ui/input';
import { Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';

type ProductHeader = {
  id: string;
  name: string;
  sku: string | null;
  customer_rfq_id: string | null;
  design_stage: string | null;
  quote_stage: string | null;
  sample_stage: string | null;
  quantity: number;
  markup_percent: number | null;
};

const VALID_TABS = ['costing', 'variants', 'sample-log', 'tasks', 'summary'] as const;
type TabKey = typeof VALID_TABS[number];

const ProductDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get('tab') || 'costing') as TabKey;
  const activeTab: TabKey = (VALID_TABS as readonly string[]).includes(tabParam) ? tabParam : 'costing';

  const [product, setProduct] = useState<ProductHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSku, setDraftSku] = useState('');
  const [savingName, setSavingName] = useState(false);
  
  // Costing summary state
  const [costingSummary, setCostingSummary] = useState<{
    unitPriceInr: number;
    unitPriceUsd: number;
    unitCostInr: number;
    unitCostUsd: number;
    exchangeRate: number;
  } | null>(null);

  const startEdit = () => {
    if (!product) return;
    setDraftName(product.name);
    setDraftSku(product.sku ?? '');
    setEditing(true);
  };
  const saveName = async () => {
    if (!product) return;
    const name = draftName.trim();
    if (!name) { toast.error('Name is required'); return; }
    setSavingName(true);
    const sku = draftSku.trim() || null;
    const { error } = await (supabase as any).from('products').update({ name, sku }).eq('id', product.id);
    setSavingName(false);
    if (error) { toast.error(error.message); return; }
    setProduct({ ...product, name, sku });
    setEditing(false);
    toast.success('Product updated');
  };

  const fetchProduct = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, customer_rfq_id, design_stage, quote_stage, sample_stage, quantity, markup_percent')
      .eq('id', id)
      .maybeSingle();
    if (error) toast.error(error.message);
    setProduct(data as any);
    setLoading(false);
  }, [id]);

  // Fetch costing summary data
  const fetchCostingSummary = useCallback(async () => {
    if (!id) return;
    
    // Fetch all data needed for costing calculations
    const [
      { data: productData },
      { data: cogsItemsData },
      { data: nonUnitCogsData },
      { data: overheadItemsData },
      { data: shippingItemsData },
      { data: shippingTypesData },
      { data: employeesData },
      { data: globalSettingsData },
      { data: inquiryData },
    ] = await Promise.all([
      supabase.from('products').select('*').eq('id', id).maybeSingle(),
      supabase.from('cogs_items').select('*').eq('product_id', id),
      supabase.from('non_unit_cogs').select('*').eq('product_id', id),
      supabase.from('overhead_items').select('*').eq('product_id', id),
      supabase.from('shipping_items').select('*').eq('product_id', id),
      supabase.from('shipping_types').select('*'),
      supabase.from('labor_employees').select('*'),
      supabase.from('global_settings').select('*').maybeSingle(),
      supabase.from('customer_rfqs').select('*').eq('id', (await supabase.from('products').select('customer_rfq_id').eq('id', id).maybeSingle()).data?.customer_rfq_id).maybeSingle(),
    ]);

    if (!productData || !globalSettingsData) return;

    const { mergeSettingsWithInquiry } = await import('@/lib/inquiry-overrides');
    const settings = mergeSettingsWithInquiry(globalSettingsData as any, inquiryData as any);

    const qty = productData.quantity || 100;
    const exchangeRate = settings.exchange_rate ?? 90;
    const markupPercent = (inquiryData as any)?.markup_percent_override ?? productData.markup_percent ?? 0.2;

    // Calculate COGS per unit
    const cogsPerUnit = (cogsItemsData || []).reduce((sum: number, item: any) => {
      if (item.include === 'No') return sum;
      const c = calc.calcCogsItemCost({
        include: item.include,
        components_per_product: item.components_per_product || 0,
        unit_cost_inr: item.unit_cost_inr || 0,
        waste_factor: item.waste_factor || 0,
      });
      return sum + c.unit_cost;
    }, 0);

    // Calculate non-unit COGS per unit
    const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
      (nonUnitCogsData || []).map((i: any) => ({ include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr })),
      qty
    );

    // Calculate overhead
    const ohItems = (overheadItemsData || []).map((item: any) => ({
      include: item.include,
      labor_type: item.labor_type,
      man_hours_per_unit: item.man_hours_per_unit || 0,
      hourly_rate: calc.avgRateByDesignation(employeesData || [], item.labor_type),
    }));
    const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
    const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
    const indirectOhPerMh = calc.calcIndirectOhPerManHour(globalSettingsData);
    const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

    // Calculate shipping
    const shipItem = (shippingItemsData || [])[0];
    const overrideShipType = inquiryData?.shipping_type_id_override
      ? (shippingTypesData || []).find((s: any) => s.id === inquiryData.shipping_type_id_override)
      : null;
    const shipType = overrideShipType || (shippingTypesData || []).find((s: any) => s.id === shipItem?.shipping_type_id);
    const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
      cost_inr: shipType.cost_inr,
      per_unit: (shipType.per_unit as 'CBM' | 'KG') || 'CBM',
      final_unit_cbm: 0,
      weight_kg: productData.weight_kg || 0,
    }) : 0;

    // Calculate summary
    const summary = calc.calcProductCostSummary(
      cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
      shippingPerUnit, markupPercent, exchangeRate, qty
    );

    setCostingSummary({
      unitPriceInr: summary.unit_price_inr,
      unitPriceUsd: summary.unit_price_usd,
      unitCostInr: summary.product_cost_per_unit_inr,
      unitCostUsd: summary.product_cost_per_unit_usd,
      exchangeRate,
    });
  }, [id]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);
  useEffect(() => { fetchCostingSummary(); }, [fetchCostingSummary]);

  const handleStageChange = async (track: StageTrack, stage: string | null) => {
    if (!product) return;
    const col = track === 'design' ? 'design_stage' : track === 'quote' ? 'quote_stage' : 'sample_stage';
    setProduct({ ...product, [col]: stage });
    const { error } = await (supabase as any).from('products').update({ [col]: stage }).eq('id', product.id);
    if (error) { toast.error(error.message); fetchProduct(); }
  };

  const setTab = (t: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    setSearchParams(next, { replace: true });
  };

  if (loading) {
    return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading product...</div></AppLayout>;
  }
  if (!product) {
    return <AppLayout><div className="text-center py-12 text-muted-foreground">Product not found</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-3">
        {/* Header */}
        <div className="flex items-start sm:items-center gap-2 sm:gap-3 flex-wrap">
          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            onClick={() => navigate(product.customer_rfq_id ? `/inquiry/${product.customer_rfq_id}` : '/inquiries')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex flex-col sm:flex-row gap-1.5 sm:items-center">
                <Input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Product name"
                  className="h-8 text-sm font-semibold"
                  autoFocus
                />
                <Input
                  value={draftSku}
                  onChange={(e) => setDraftSku(e.target.value)}
                  placeholder="SKU (optional)"
                  className="h-8 text-xs sm:max-w-[180px]"
                />
                <div className="flex gap-1">
                  <Button size="icon" variant="default" className="h-8 w-8" onClick={saveName} disabled={savingName}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(false)} disabled={savingName}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group">
                <div className="min-w-0">
                  <h1 className="text-base sm:text-lg font-bold truncate">{product.name}</h1>
                  {product.sku && <div className="text-xs text-muted-foreground truncate">SKU: {product.sku}</div>}
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100" onClick={startEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          
          {/* Price/Cost Summary */}
          {costingSummary && (
            <div className="hidden sm:flex items-center gap-4 px-3 py-1.5 bg-muted/50 rounded-md">
              <div className="text-xs">
                <span className="text-muted-foreground block text-[10px]">Unit Cost</span>
                <span className="font-mono font-semibold">{fmt.inr(costingSummary.unitCostInr)}</span>
                <span className="text-muted-foreground ml-1">({fmt.usd(costingSummary.unitCostUsd)})</span>
              </div>
              <div className="w-px h-6 bg-border" />
              <div className="text-xs">
                <span className="text-muted-foreground block text-[10px]">Unit Price</span>
                <span className="font-mono font-semibold text-primary">{fmt.inr(costingSummary.unitPriceInr)}</span>
                <span className="text-muted-foreground ml-1">({fmt.usd(costingSummary.unitPriceUsd)})</span>
              </div>
            </div>
          )}
          
          <div className="w-full sm:w-auto sm:ml-auto overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <ProductStagePills product={product} onChange={handleStageChange} />
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setTab}>
          <div className="-mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto">
            <TabsList className="w-max">
              <TabsTrigger value="costing"><DollarSign className="h-3.5 w-3.5 mr-1.5" />Costing</TabsTrigger>
              <TabsTrigger value="variants"><Layers className="h-3.5 w-3.5 mr-1.5" />Variants</TabsTrigger>
              <TabsTrigger value="sample-log"><Package2 className="h-3.5 w-3.5 mr-1.5" />Sample Log</TabsTrigger>
              <TabsTrigger value="tasks"><ListChecks className="h-3.5 w-3.5 mr-1.5" />Tasks</TabsTrigger>
              <TabsTrigger value="summary"><FileText className="h-3.5 w-3.5 mr-1.5" />Summary</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="summary">
            {activeTab === 'summary' && <ProductSummaryTab productId={product.id} onProductUpdated={fetchProduct} />}
          </TabsContent>
          <TabsContent value="costing">
            {activeTab === 'costing' && <ProductCostingTab productId={product.id} onProductUpdated={fetchProduct} onSummaryChange={setCostingSummary} />}
          </TabsContent>
          <TabsContent value="variants">
            {activeTab === 'variants' && <ProductVariantsTab productId={product.id} />}
          </TabsContent>
          <TabsContent value="sample-log">
            {activeTab === 'sample-log' && <ProductSampleLogTab productId={product.id} />}
          </TabsContent>
          <TabsContent value="tasks">
            {activeTab === 'tasks' && <ProductTasksTab productId={product.id} inquiryId={product.customer_rfq_id} />}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default ProductDetail;
