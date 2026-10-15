import { Copy, Plus, Trash2 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { addMonths, monthLabel, type Month } from '@/lib/dkt-cashflow';
import { firstPoMonth, landedPerUnit, payoutPerUnit, scenarioSummary, type AmazonSku } from '@/lib/dkt-amazon';
import type { AmazonScenario } from '@/hooks/use-dkt-cashflow';
import { MonthField, NumField, SelectField, Stat, TextField, usd, usdK } from './fields';

type Props = {
  scenarios: AmazonScenario[];
  skus: AmazonSku[];
  thisMonth: Month;
  lookahead: number;
  addScenario: () => void;
  duplicateScenario: (s: AmazonScenario) => void;
  updateScenario: (id: string, p: Partial<AmazonScenario>) => void;
  removeScenario: (id: string) => void;
  addSku: (scenarioId: string, mode: AmazonSku['mode']) => void;
  updateSku: (id: string, p: Partial<AmazonSku>) => void;
  removeSku: (id: string) => void;
};

export function AmazonTab(p: Props) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start gap-3">
        <p className="text-xs text-muted-foreground max-w-3xl">
          Each scenario is a saved set of SKUs. Switch "In DKT forecast" on to put it in DKT's cash flow.
          A <b>simple</b> SKU is an existing line: monthly sales × price × net margin, from its start month.
          A <b>new SKU</b> runs the full cycle: 100% of product cost at PO, freight when it ships (after the make months), first sales after the ship months,
          and a reorder whenever stock on hand plus on the way covers your reorder months or less. Net margin is what's left after Amazon fees and landed cost,
          so Amazon pays out price × net margin + landed cost per unit sold.
        </p>
        <Button size="sm" variant="outline" onClick={p.addScenario}><Plus className="h-3.5 w-3.5 mr-1" /> New scenario</Button>
      </div>
      {p.scenarios.map(s => <ScenarioCard key={s.id} scenario={s} {...p} />)}
    </div>
  );
}

function ScenarioCard({ scenario: s, skus, thisMonth, lookahead, duplicateScenario, updateScenario, removeScenario, addSku, updateSku, removeSku }: Props & { scenario: AmazonScenario }) {
  const mine = skus.filter(x => x.scenario_id === s.id);
  const last = addMonths(thisMonth, lookahead - 1);
  const sum = scenarioSummary(mine, last);
  const chart = sum.months.map(m => ({ month: monthLabel(m.month), cumulative: Math.round(m.cumulative) }));
  const hasInventory = mine.some(x => x.mode === 'inventory');
  return (
    <Card className={cn(s.in_forecast && 'border-primary/40')}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <TextField className="font-medium max-w-xs" label="Scenario name" value={s.name} onSave={v => updateScenario(s.id, { name: v })} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={s.in_forecast} onCheckedChange={v => updateScenario(s.id, { in_forecast: v })} />
            In DKT forecast
          </label>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => duplicateScenario(s)}><Copy className="h-3.5 w-3.5 mr-1" /> Duplicate</Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Delete scenario" onClick={() => { if (confirm(`Delete scenario ${s.name || ''} and its SKUs?`)) removeScenario(s.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        <TextField className="text-xs" label="Notes" placeholder="Notes" value={s.notes} onSave={v => updateScenario(s.id, { notes: v || null })} />
      </CardHeader>
      <CardContent className="space-y-3">
        {mine.length > 0 && (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            {hasInventory && <Stat label="Most cash tied up" value={usd(sum.peakNeed)} sub={sum.peakMonth ? `in ${monthLabel(sum.peakMonth)}` : undefined} tone={sum.peakNeed > 0 ? 'warning' : undefined} />}
            {hasInventory && <Stat label="Paid back by" value={sum.paybackMonth ? monthLabel(sum.paybackMonth) : sum.peakNeed > 0 ? `after ${monthLabel(last)}` : '—'} />}
            <Stat label={`Net cash by ${monthLabel(last)}`} value={usd(sum.profit)} tone={sum.profit >= 0 ? 'success' : 'destructive'} />
            {hasInventory && <Stat label="Stock left (at cost)" value={usd(sum.stockValue)} sub={`Worth ${usd(sum.profit + sum.stockValue)} with cash`} />}
            {hasInventory && <Stat label="Months out of stock" value={sum.stockoutMonths} tone={sum.stockoutMonths ? 'destructive' : undefined} sub={sum.stockoutMonths ? 'Reorder earlier or order more' : 'None'} />}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="font-medium py-1 pr-2">SKU</th>
                <th className="font-medium px-1">Type</th>
                <th className="font-medium px-1 text-right">Price</th>
                <th className="font-medium px-1 text-right">Net margin</th>
                <th className="font-medium px-1 text-right">Units / mo</th>
                <th className="font-medium px-1">First sales</th>
                <th className="font-medium px-1 text-right">Product cost / unit</th>
                <th className="font-medium px-1 text-right">Freight / unit</th>
                <th className="font-medium px-1 text-right">Order qty</th>
                <th className="font-medium px-1 text-right" title="Reorder when stock on hand + on the way covers this many months">Reorder at (mo)</th>
                <th className="font-medium px-1 text-right" title="Months from PO to shipping, then shipping to first sale">Make / ship (mo)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mine.map(x => {
                const inv = x.mode === 'inventory';
                const po = firstPoMonth(x);
                return (
                  <tr key={x.id} className="border-t align-top">
                    <td className="py-1.5 pr-2 min-w-[9rem]">
                      <TextField label="SKU" value={x.name} placeholder="SKU name" onSave={v => updateSku(x.id, { name: v })} />
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Payout {usd(payoutPerUnit(x))}/unit{inv && po ? ` · first PO ${monthLabel(po)}` : ''}
                      </div>
                      {!x.start_month && <div className="text-[10px] text-warning mt-0.5">Set a first sales month to count it</div>}
                    </td>
                    <td className="py-1.5 px-1"><SelectField label="Type" value={x.mode} options={[{ value: 'simple', label: 'Simple' }, { value: 'inventory', label: 'New SKU' }]} onSave={v => updateSku(x.id, { mode: v })} /></td>
                    <td className="py-1.5 px-1 w-20"><NumField label="Price" value={x.price_usd} onSave={v => updateSku(x.id, { price_usd: v ?? 0 })} /></td>
                    <td className="py-1.5 px-1 w-20"><NumField percent label="Net margin" value={x.net_margin_pct} onSave={v => updateSku(x.id, { net_margin_pct: v ?? 0 })} /></td>
                    <td className="py-1.5 px-1 w-20"><NumField label="Units per month" value={x.units_per_month} onSave={v => updateSku(x.id, { units_per_month: v ?? 0 })} /></td>
                    <td className="py-1.5 px-1"><MonthField label="First sales month" allowEmpty value={x.start_month} onSave={v => updateSku(x.id, { start_month: v })} /></td>
                    {inv ? (
                      <>
                        <td className="py-1.5 px-1 w-20"><NumField label="Product cost per unit" value={x.unit_cost_usd} onSave={v => updateSku(x.id, { unit_cost_usd: v ?? 0 })} /></td>
                        <td className="py-1.5 px-1 w-20">
                          <NumField label="Freight per unit" value={x.freight_per_unit_usd} onSave={v => updateSku(x.id, { freight_per_unit_usd: v ?? 0 })} />
                          <div className="text-[10px] text-muted-foreground text-right mt-0.5">landed {usd(landedPerUnit(x))}</div>
                        </td>
                        <td className="py-1.5 px-1 w-20">
                          <NumField integer label="Order quantity" value={x.order_qty} onSave={v => updateSku(x.id, { order_qty: v ?? 0 })} />
                          <div className="text-[10px] text-muted-foreground text-right mt-0.5">{usd(x.order_qty * landedPerUnit(x))}</div>
                        </td>
                        <td className="py-1.5 px-1 w-16"><NumField label="Reorder at months of stock" value={x.reorder_months} onSave={v => updateSku(x.id, { reorder_months: v ?? 0 })} /></td>
                        <td className="py-1.5 px-1">
                          <div className="flex gap-1">
                            <NumField className="w-12" integer label="Make months" value={x.make_months} onSave={v => updateSku(x.id, { make_months: v ?? 0 })} />
                            <NumField className="w-12" integer label="Ship months" value={x.ship_months} onSave={v => updateSku(x.id, { ship_months: v ?? 0 })} />
                          </div>
                        </td>
                      </>
                    ) : <td colSpan={5} className="py-1.5 px-1 text-muted-foreground pt-3">Existing line: no stock purchases modelled.</td>}
                    <td className="py-1.5 pl-1"><Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete SKU" onClick={() => removeSku(x.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => addSku(s.id, 'inventory')}><Plus className="h-3.5 w-3.5 mr-1" /> New SKU</Button>
          <Button size="sm" variant="ghost" onClick={() => addSku(s.id, 'simple')}><Plus className="h-3.5 w-3.5 mr-1" /> Simple line</Button>
        </div>
        {hasInventory && chart.length > 1 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Cumulative cash from this scenario</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={usdK} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={52} />
                  <Tooltip formatter={(v: number) => [usd(v), 'Cumulative cash']} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                  <Line type="monotone" dataKey="cumulative" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
