import { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { loadCostHistory, PART_LABELS, type CostHistoryRow, type CostParts } from '@/lib/cost-history';

const usd = (n: number) => `$${n.toFixed(2)}`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** How a product's cost and FOB moved over time, with the reason for each change (newest first). */
export function ProductCostHistoryTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<CostHistoryRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    loadCostHistory(productId).then(r => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [productId]);

  if (rows == null) return <p className="py-8 text-center text-sm text-muted-foreground">Loading cost history…</p>;
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No cost history yet. A line is added each time this product's costing changes.
        </CardContent>
      </Card>
    );
  }

  const series = rows.map(r => ({ t: Date.parse(r.recorded_at), cost: r.unit_cost_usd, fob: r.unit_price_usd }));
  const newestFirst = rows.slice().reverse();

  return (
    <div className="space-y-3">
      {rows.length > 1 && (
        <Card>
          <CardContent className="pt-4">
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={series} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} tickFormatter={v => format(new Date(v), 'd MMM')} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} width={48} />
                  <Tooltip labelFormatter={v => format(new Date(v as number), 'd MMM yyyy, HH:mm')} formatter={(v: any) => usd(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="fob" name="FOB price" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} type="stepAfter" />
                  <Line dataKey="cost" name="Unit cost" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={{ r: 2 }} type="stepAfter" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {newestFirst.map(r => (
              <div key={r.id} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-xs text-muted-foreground">{format(new Date(r.recorded_at), 'd MMM yyyy, HH:mm')}</span>
                  <span className="tabular-nums">
                    Cost <span className="font-medium">{usd(r.unit_cost_usd)}</span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    FOB <span className="font-semibold">{usd(r.unit_price_usd)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">@ {r.exchange_rate.toFixed(2)}</span>
                  </span>
                </div>
                {r.reason && <p className="mt-0.5">{r.reason}</p>}
                <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {(Object.keys(PART_LABELS) as (keyof CostParts)[])
                    .filter(k => r.parts[k] > 0)
                    .map(k => `${PART_LABELS[k]} ${inr(r.parts[k])}`)
                    .join(' · ')}
                  {r.raw_vendor ? ` · raw piece from ${r.raw_vendor}` : ''}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
