import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Target } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { TargetPriceSolverPanel } from '@/components/TargetPriceSolverDialog';

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
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        <PageBreadcrumbs canonical={[{ label: 'Tools', to: '/tools' }]} current="Target Price Solver" />
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Target className="h-4 w-4" /> Target Price Solver
        </h1>

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

        <Card>
          <CardContent className="pt-4">
            <TargetPriceSolverPanel
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
      </div>
    </AppLayout>
  );
}
