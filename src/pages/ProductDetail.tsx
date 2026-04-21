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

const VALID_TABS = ['summary', 'costing', 'variants', 'sample-log', 'tasks'] as const;
type TabKey = typeof VALID_TABS[number];

const ProductDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get('tab') || 'summary') as TabKey;
  const activeTab: TabKey = (VALID_TABS as readonly string[]).includes(tabParam) ? tabParam : 'summary';

  const [product, setProduct] = useState<ProductHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSku, setDraftSku] = useState('');
  const [savingName, setSavingName] = useState(false);

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
      .select('id, name, sku, customer_rfq_id, design_stage, quote_stage, sample_stage')
      .eq('id', id)
      .maybeSingle();
    if (error) toast.error(error.message);
    setProduct(data as any);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);

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
          <div className="w-full sm:w-auto sm:ml-auto overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <ProductStagePills product={product} onChange={handleStageChange} />
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setTab}>
          <div className="-mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto">
            <TabsList className="w-max">
              <TabsTrigger value="summary"><FileText className="h-3.5 w-3.5 mr-1.5" />Summary</TabsTrigger>
              <TabsTrigger value="costing"><DollarSign className="h-3.5 w-3.5 mr-1.5" />Costing</TabsTrigger>
              <TabsTrigger value="variants"><Layers className="h-3.5 w-3.5 mr-1.5" />Variants</TabsTrigger>
              <TabsTrigger value="sample-log"><Package2 className="h-3.5 w-3.5 mr-1.5" />Sample Log</TabsTrigger>
              <TabsTrigger value="tasks"><ListChecks className="h-3.5 w-3.5 mr-1.5" />Tasks</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="summary">
            {activeTab === 'summary' && <ProductSummaryTab productId={product.id} onProductUpdated={fetchProduct} />}
          </TabsContent>
          <TabsContent value="costing">
            {activeTab === 'costing' && <ProductCostingTab productId={product.id} onProductUpdated={fetchProduct} />}
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
