import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { addMonths, allegroProjection, monthLabel, type DktSettings, type Month } from '@/lib/dkt-cashflow';
import { landedPerUnit, type AmazonSku } from '@/lib/dkt-amazon';
import { NumField, Stat, usd, usdK } from './fields';

type Props = {
  settings: DktSettings;
  saveSettings: (p: Partial<DktSettings>) => void;
  thisMonth: Month;
  lookahead: number;
  skus: AmazonSku[];
};

export function AllegroTab({ settings, saveSettings, thisMonth, lookahead, skus }: Props) {
  const proj = allegroProjection(settings, thisMonth, lookahead);
  const at = (i: number) => proj[Math.min(i, proj.length - 1)]?.balance ?? 0;
  const last = addMonths(thisMonth, lookahead - 1);
  const launch = proj.find(r => r.launch > 0);
  const chart = proj.map(r => ({ month: monthLabel(r.month), balance: Math.round(r.balance) }));

  const skuNames = new Map<string, AmazonSku>();
  for (const x of skus) if (x.mode === 'inventory' && landedPerUnit(x) > 0 && !skuNames.has(x.name)) skuNames.set(x.name, x);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Allegro is the emergency fund. It's kept apart from DKT's cash and grows by its monthly top-up from outside.
        It isn't in DKT's forecast except for the Amazon launch below: the month Allegro reaches the launch amount, that amount goes into
        DKT's cash flow as money in from Allegro; the launch's costs are the new SKUs on the Amazon tab. For anything else, move it into DKT's current cash by hand.
      </p>
      <div className="rounded-md border px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={settings.allegro_launch_on} onCheckedChange={v => saveSettings({ allegro_launch_on: !!v })} />
          <span>Fund an Amazon launch of</span>
        </label>
        <NumField className="w-24" label="Amazon launch amount" value={settings.allegro_launch_usd} onSave={v => saveSettings({ allegro_launch_usd: v ?? 0 })} />
        <span className={launch ? 'font-medium' : 'text-muted-foreground'}>
          {!settings.allegro_launch_on ? 'Off: not in the cash flow.'
            : launch ? `Allegro has it in ${monthLabel(launch.month)}. It's in the cash flow that month.`
            : `Allegro doesn't reach it by ${monthLabel(last)}.`}
        </span>
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border px-3 py-2 space-y-1">
          <div className="text-[11px] text-muted-foreground">Balance now</div>
          <NumField label="Allegro balance" value={settings.allegro_balance_usd} onSave={v => saveSettings({ allegro_balance_usd: v ?? 0, allegro_as_of: new Date().toISOString().slice(0, 10) })} />
          <div className="text-[11px] text-muted-foreground">{settings.allegro_as_of ? `As of ${settings.allegro_as_of}` : ''}</div>
        </div>
        <div className="rounded-md border px-3 py-2 space-y-1">
          <div className="text-[11px] text-muted-foreground">Added each month</div>
          <NumField label="Monthly top-up" value={settings.allegro_monthly_usd} onSave={v => saveSettings({ allegro_monthly_usd: v ?? 0 })} />
          <div className="text-[11px] text-muted-foreground">From outside DKT</div>
        </div>
        <Stat label={`In 6 months (${monthLabel(proj[Math.min(6, proj.length - 1)].month)})`} value={usd(at(6))} />
        <Stat label={`By ${monthLabel(last)}`} value={usd(at(lookahead - 1))} sub={launch ? 'After the Amazon launch' : 'If nothing is taken out'} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Allegro balance</CardTitle></CardHeader>
        <CardContent>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={usdK} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v: number) => [usd(v), 'Allegro balance']} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
                <Area type="monotone" dataKey="balance" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.12)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">How much stock Allegro could buy</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {!skuNames.size ? <p className="text-xs text-muted-foreground">Add a new SKU with its product cost and freight on the Amazon tab to see how many units Allegro could buy.</p> : (
            <table className="text-xs w-full">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="font-medium py-1 pr-2">SKU</th><th className="font-medium px-2 text-right">Landed / unit</th>
                  {[0, 3, 6, 12].filter(i => i < lookahead).map(i => <th key={i} className="font-medium px-2 text-right">{i === 0 ? 'Now' : monthLabel(proj[i].month)}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...skuNames.values()].map(x => (
                  <tr key={x.id} className="border-t">
                    <td className="py-1.5 pr-2">{x.name || 'Unnamed SKU'}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{usd(landedPerUnit(x))}</td>
                    {[0, 3, 6, 12].filter(i => i < lookahead).map(i => (
                      <td key={i} className="py-1.5 px-2 text-right tabular-nums">{Math.max(0, Math.floor(at(i) / landedPerUnit(x))).toLocaleString('en-US')} units</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">Units = Allegro balance ÷ (product cost + freight per unit).</p>
        </CardContent>
      </Card>
    </div>
  );
}
