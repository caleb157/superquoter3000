import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { toast } from 'sonner';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Target } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { TargetPriceSolverPanel } from '@/components/TargetPriceSolverDialog';
import { InquiryTargetSolverTable } from '@/components/InquiryTargetSolverTable';
import { Button } from '@/components/ui/button';

const BUCKET_FIELDS = [
  { key: 'cogs', label: 'COGS' },
  { key: 'directOh', label: 'Direct Overhead' },
  { key: 'indirectOh', label: 'Indirect Overhead' },
  { key: 'shipping', label: 'Shipping / Packaging' },
] as const;

export default function TargetPriceSolverPage() {
  useDocumentTitle('Target Price Solver');
  const [exchangeRate, setExchangeRate] = useState('90');
  const [markupPct, setMarkupPct] = useState('20');
  const [values, setValues] = useState<Record<string, string>>({
    cogs: '', directOh: '', indirectOh: '', shipping: '',
  });
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [inquiryId, setInquiryId] = useState<string>('');
  const [productId, setProductId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadedTargetUsd, setLoadedTargetUsd] = useState<number | null>(null);
  const [mode, setMode] = useState<'single' | 'inquiry'>('single');

  useEffect(() => {
    (supabase as any)
      .from('customer_rfqs')
      .select('id, title, status')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data }: any) => setInquiries(data || []));
  }, []);

  useEffect(() => {
    setProductId('');
    setProducts([]);
    if (!inquiryId) return;
    (supabase as any)
      .from('products')
      .select('id, name, target_price_usd, archived_at')
      .eq('customer_rfq_id', inquiryId)
      .order('name')
      .limit(500)
      .then(({ data }: any) => setProducts((data || []).filter((p: any) => !p.archived_at)));
  }, [inquiryId]);

  const loadProduct = async (pid: string) => {
    setProductId(pid);
    if (!pid) return;
    setLoading(true);
    try {
      const map = await computeProductPriceAndCost([pid]);
      const row = map[pid];
      if (!row) { toast.error('Could not compute costing for that product'); return; }
      setValues({
        cogs: String(+row.buckets_inr.cogs.toFixed(2)),
        directOh: String(+row.buckets_inr.directOh.toFixed(2)),
        indirectOh: String(+row.buckets_inr.indirectOh.toFixed(2)),
        shipping: String(+row.buckets_inr.shipping.toFixed(2)),
      });
      setMarkupPct(String(+(row.markup_percent * 100).toFixed(2)));
      setExchangeRate(String(row.exchange_rate));
      const prod = products.find(p => p.id === pid);
      setLoadedTargetUsd(prod?.target_price_usd ?? null);
    } finally {
      setLoading(false);
    }
  };

  const rate = Number(exchangeRate) || 0;
  const markupPercent = (Number(markupPct) || 0) / 100;

  const buckets = useMemo(
    () => BUCKET_FIELDS.map(f => ({ label: f.label, valueInr: Number(values[f.key]) || 0 })),
    [values],
  );
  const currentCostInr = buckets.reduce((s, b) => s + b.valueInr, 0);
  const currentUnitPriceUsd = rate > 0 ? (currentCostInr * (1 + markupPercent)) / rate : 0;

  return (
    <AppLayout>
      <div className={mode === 'inquiry' ? 'p-4 sm:p-6 max-w-[1500px] mx-auto space-y-4' : 'p-4 sm:p-6 max-w-3xl mx-auto space-y-4'}>
        <PageBreadcrumbs canonical={[{ label: 'Tools', to: '/tools' }]} current="Target Price Solver" />
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Target className="h-4 w-4" /> Target Price Solver
        </h1>

        <div className="inline-flex rounded-md border p-0.5">
          {(['single', 'inquiry'] as const).map(m => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setMode(m)}
            >
              {m === 'single' ? 'Single product' : 'Whole inquiry'}
            </Button>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {mode === 'inquiry' ? 'Inquiry' : 'Load from an inquiry (optional)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Inquiry</label>
                <Select value={inquiryId} onValueChange={setInquiryId}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select inquiry" /></SelectTrigger>
                  <SelectContent>
                    {inquiries.map(i => (
                      <SelectItem key={i.id} value={i.id}>{i.title || 'Untitled'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {mode === 'single' && (
              <div>
                <label className="text-xs text-muted-foreground">Product</label>
                <Select value={productId} onValueChange={loadProduct} disabled={!inquiryId || loading}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder={loading ? 'Loading…' : 'Select product'} />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name || 'Unnamed'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
            </div>
            {mode === 'single' && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Picking a product fills the costs, markup and exchange rate below from its live costing sheet.
              You can still edit any value to run what-ifs.
            </p>
            )}
          </CardContent>
        </Card>

        {mode === 'inquiry' && <InquiryTargetSolverTable inquiryId={inquiryId} />}

        {mode === 'single' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cost inputs (₹ per unit)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              {BUCKET_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="text-xs text-muted-foreground">{f.label}</label>
                  <Input
                    className="h-8 text-sm" type="number" inputMode="decimal" step="0.01"
                    value={values[f.key]}
                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Markup %</label>
                <Input className="h-8 text-sm" type="number" step="0.1" value={markupPct}
                  onChange={e => setMarkupPct(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Exchange rate (₹ / $)</label>
                <Input className="h-8 text-sm" type="number" step="0.01" value={exchangeRate}
                  onChange={e => setExchangeRate(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {mode === 'single' && (
        <Card>
          <CardContent className="pt-4">
            <TargetPriceSolverPanel
              key={productId || 'manual'}
              defaultTargetUsd={loadedTargetUsd}
              inputs={{
                currentCostInr,
                buckets,
                markupPercent,
                exchangeRate: rate,
                currentUnitPriceUsd,
              }}
            />
          </CardContent>
        </Card>
        )}
      </div>
    </AppLayout>
  );
}
