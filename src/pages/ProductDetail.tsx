import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ResponsiveTabs } from '@/components/ResponsiveTabs';
import { ArrowLeft, FileText, DollarSign, Package2, ListChecks, History, RefreshCw, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ProductSummaryTab } from '@/components/ProductSummaryTab';
import { ProductCostingTab } from '@/components/ProductCostingTab';
import { ProductSampleLogTab } from '@/components/ProductSampleLogTab';
import { ProductTasksTab } from '@/components/ProductTasksTab';

import { ProductStagePills, type StageTrack } from '@/components/ProductStagePills';
import { Input } from '@/components/ui/input';
import { Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { EditHistoryDialog, type HistoryConfig } from '@/components/EditHistoryDialog';
import { PageBreadcrumbs, type Crumb } from '@/components/PageBreadcrumbs';
import { useDocumentTitle } from '@/hooks/use-document-title';

type ProductHeader = {
  id: string;
  name: string;
  sku: string | null;
  customer_rfq_id: string | null;
  customer_rfq?: { rfq_number: string; title: string | null } | null;
  design_stage: string | null;
  quote_stage: string | null;
  sample_stage: string | null;
  quantity: number;
  markup_percent: number | null;
  calculated_unit_price_usd: number | null;
  calculated_unit_cost_usd: number | null;
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
  useDocumentTitle(product?.name || null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSku, setDraftSku] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [historyTrack, setHistoryTrack] = useState<StageTrack | null>(null);
  
  // Costing summary state
  const [costingSummary, setCostingSummary] = useState<{
    unitPriceInr: number;
    unitPriceUsd: number;
    unitCostInr: number;
    unitCostUsd: number;
    exchangeRate: number;
  } | null>(null);
  const [refreshingPrice, setRefreshingPrice] = useState(false);

  // Stale-cache detection: live engine vs. value persisted on products row.
  const cachedPriceUsd = product?.calculated_unit_price_usd ?? null;
  const cachedCostUsd = product?.calculated_unit_cost_usd ?? null;
  const livePriceUsd = costingSummary?.unitPriceUsd ?? null;
  const liveCostUsd = costingSummary?.unitCostUsd ?? null;
  const priceStale =
    livePriceUsd != null &&
    cachedPriceUsd != null &&
    Math.abs(cachedPriceUsd - livePriceUsd) > 0.01;
  const costStale =
    liveCostUsd != null &&
    cachedCostUsd != null &&
    Math.abs(cachedCostUsd - liveCostUsd) > 0.01;
  const isStale = priceStale || costStale;

  const refreshCachedPrice = useCallback(async () => {
    if (!product?.id || livePriceUsd == null) return;
    setRefreshingPrice(true);
    const priceUsd = +Number(livePriceUsd).toFixed(4);
    const costUsd = liveCostUsd != null ? +Number(liveCostUsd).toFixed(4) : null;
    const { error } = await (supabase as any)
      .from('products')
      .update({ calculated_unit_price_usd: priceUsd, calculated_unit_cost_usd: costUsd })
      .eq('id', product.id);
    setRefreshingPrice(false);
    if (error) { toast.error('Refresh failed: ' + error.message); return; }
    toast.success('Cached price refreshed');
    fetchProduct();
  }, [product?.id, livePriceUsd, liveCostUsd]);

  // Surface the stale state once per detection so it's not just a silent badge.
  useEffect(() => {
    if (!isStale || !product?.id) return;
    const key = `staleNoticeShown:${product.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    toast.warning('Showing a stale cached price for this product.', {
      description: 'Other screens may still show the old number until you refresh.',
      action: { label: 'Refresh', onClick: () => refreshCachedPrice() },
      duration: 8000,
    });
  }, [isStale, product?.id, refreshCachedPrice]);

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
      .select('id, name, sku, customer_rfq_id, design_stage, quote_stage, sample_stage, quantity, markup_percent, calculated_unit_price_usd, calculated_unit_cost_usd, customer_rfq:customer_rfqs(rfq_number, title)')
      .eq('id', id)
      .maybeSingle();
    if (error) toast.error(error.message);
    setProduct(data as any);
    setLoading(false);
  }, [id]);

  // Fetch costing summary data — routes through the unified engine.
  const fetchCostingSummary = useCallback(async () => {
    if (!id) return;

    // First, fetch the product so we can resolve its inquiry id.
    const { data: productData } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
    if (!productData) return;
    const inquiryId = (productData as any).customer_rfq_id || null;

    const [
      cogsRes, nuRes, ohRes, shipRes, shipTypesRes, empRes, gsRes, cbmRes,
      ptRes, inqRes, chemRes, boxRes, diffRes, locRes, rawRes,
    ] = await Promise.all([
      supabase.from('cogs_items').select('*').eq('product_id', id),
      supabase.from('non_unit_cogs').select('*').eq('product_id', id),
      supabase.from('overhead_items').select('*').eq('product_id', id),
      supabase.from('shipping_items').select('*').eq('product_id', id),
      supabase.from('shipping_types').select('*'),
      supabase.from('labor_employees').select('*'),
      supabase.from('global_settings').select('*').limit(1).maybeSingle(),
      supabase.from('cbm_estimates').select('*').eq('product_id', id).maybeSingle(),
      supabase.from('product_types').select('*'),
      inquiryId
        ? (supabase as any).from('customer_rfqs').select('*').eq('id', inquiryId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('chemical_prices').select('*'),
      supabase.from('box_data').select('*'),
      (supabase as any).from('finishing_difficulty').select('name, adjustment_factor'),
      (supabase as any).from('local_transport_locations').select('id, cost_per_cbm_inr'),
      (supabase as any).from('raw_material_costs').select('id, name, cost, unit_type, active'),
    ]);

    const gs = gsRes.data;
    if (!gs) return;

    const productType = (ptRes.data || []).find((pt: any) => pt.id === (productData as any).product_type_id) || null;
    const { computeProductCosting } = await import('@/lib/costing-engine');
    const engineResult = computeProductCosting({
      product: productData,
      cogsItems: cogsRes.data || [],
      nonUnitCogs: nuRes.data || [],
      overheadItems: ohRes.data || [],
      shippingItems: shipRes.data || [],
      cbmRow: cbmRes.data || null,
      productType,
      boxData: boxRes.data || [],
      chemicalPrices: chemRes.data || [],
      shippingTypes: shipTypesRes.data || [],
      laborEmployees: empRes.data || [],
      globalSettings: gs,
      inquiryOverrides: (inqRes as any).data || null,
      locations: (locRes as any).data || [],
      difficulties: (diffRes as any).data || [],
      rawMaterialCosts: (rawRes as any).data || [],
    });

    setCostingSummary({
      unitPriceInr: engineResult.summary.unit_price_inr,
      unitPriceUsd: engineResult.summary.unit_price_usd,
      unitCostInr: engineResult.summary.product_cost_per_unit_inr,
      unitCostUsd: engineResult.summary.product_cost_per_unit_usd,
      exchangeRate: engineResult.exchangeRate,
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

  const canonicalCrumbs: Crumb[] = [
    { label: 'Inquiries', to: '/inquiries' },
    ...(product.customer_rfq_id
      ? [{
          label: product.customer_rfq?.title || product.customer_rfq?.rfq_number || 'Inquiry',
          to: `/inquiry/${product.customer_rfq_id}`,
        } as Crumb]
      : []),
  ];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-3">
        <PageBreadcrumbs canonical={canonicalCrumbs} current={product.name} />
        {/* Header */}
        <div className="flex items-start sm:items-center gap-2 sm:gap-3 flex-wrap">
          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            onClick={() => {
              const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
              if (idx > 0) navigate(-1);
              else navigate(product.customer_rfq_id ? `/inquiry/${product.customer_rfq_id}` : '/inquiries');
            }}
            aria-label="Back"
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
                  <h1 className="text-base sm:text-lg font-serif font-medium tracking-tight truncate">{product.name}</h1>
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
              {isStale && (
                <>
                  <div className="w-px h-6 bg-border" />
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-700 dark:text-amber-400 text-[10px] py-0 px-1.5 h-5" title={`Cached: ${cachedPriceUsd != null ? fmt.usd(cachedPriceUsd) : '—'} · Live: ${livePriceUsd != null ? fmt.usd(livePriceUsd) : '—'}`}>
                      <AlertTriangle className="h-3 w-3" />
                      Stale
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={refreshCachedPrice}
                      disabled={refreshingPrice}
                    >
                      <RefreshCw className={`h-3 w-3 ${refreshingPrice ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          
          <div className="w-full sm:w-auto sm:ml-auto overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 flex items-center gap-1.5">
            <ProductStagePills product={product} onChange={handleStageChange} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Edit stage history (backdate)">
                  <History className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Edit history of…</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setHistoryTrack('design')}>Design stage</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setHistoryTrack('quote')}>Quote stage</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setHistoryTrack('sample')}>Sample stage</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setTab}>
          <ResponsiveTabs
            value={activeTab}
            onValueChange={setTab}
            options={[
              { value: 'costing', label: 'Costing', icon: DollarSign },
              { value: 'sample-log', label: 'Sample Log', icon: Package2 },
              { value: 'tasks', label: 'Tasks', icon: ListChecks },
              { value: 'summary', label: 'Summary', icon: FileText },
            ]}
          />

          <TabsContent value="summary">
            {activeTab === 'summary' && <ProductSummaryTab productId={product.id} onProductUpdated={fetchProduct} />}
          </TabsContent>
          <TabsContent value="costing">
            {activeTab === 'costing' && <ProductCostingTab productId={product.id} onProductUpdated={fetchProduct} onSummaryChange={setCostingSummary} />}
          </TabsContent>
          <TabsContent value="sample-log">
            {activeTab === 'sample-log' && <ProductSampleLogTab productId={product.id} />}
          </TabsContent>
          <TabsContent value="tasks">
            {activeTab === 'tasks' && <ProductTasksTab productId={product.id} inquiryId={product.customer_rfq_id} />}
          </TabsContent>
        </Tabs>
      </div>

      {historyTrack && (() => {
        const optionsByTrack: Record<StageTrack, string[]> = {
          design: ['need_design', 'designed'],
          quote: ['quoting', 'ready_for_quote', 'quoted'],
          sample: ['sampling', 'sampled'],
        };
        const cfg: HistoryConfig = {
          table: 'product_stage_events',
          parentColumn: 'product_id',
          parentId: product.id,
          options: optionsByTrack[historyTrack],
          valueColumn: 'to_stage',
          fromColumn: 'from_stage',
          extraInsert: { track: historyTrack },
          filter: { track: historyTrack },
          label: `${product.name} — ${historyTrack} stage`,
        };
        return (
          <EditHistoryDialog
            open={!!historyTrack}
            onOpenChange={(v) => !v && setHistoryTrack(null)}
            config={cfg}
          />
        );
      })()}
    </AppLayout>
  );
};

export default ProductDetail;
