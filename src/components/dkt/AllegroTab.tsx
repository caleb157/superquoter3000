import { Fragment } from 'react';
import { Plus } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { addMonths, allegroProjection, allegroSchedule, isAllegroScenario, monthLabel, type AllegroLaunch, type DktSettings, type Month } from '@/lib/dkt-cashflow';
import type { AmazonScenario } from '@/hooks/use-dkt-cashflow';
import { landedPerUnit, LONG_VIEW_MONTH, type AmazonSku } from '@/lib/dkt-amazon';
import { NumField, Stat, usd, usdK } from './fields';
import { LaunchOverride } from './LaunchOverride';
import { cn } from '@/lib/utils';

type Props = {
  settings: DktSettings;
  saveSettings: (p: Partial<DktSettings>) => void;
  thisMonth: Month;
  lookahead: number;
  skus: AmazonSku[];
  scenarios: AmazonScenario[];
  launches: AllegroLaunch[];
  addAllegroScenario: () => void;
  setFunding: (scenarioId: string, funding: 'dkt' | 'allegro') => void;
  openAmazon: () => void;
  updateSku: (id: string, p: Partial<AmazonSku>) => void;
};

export function AllegroTab({ settings, saveSettings, thisMonth, lookahead, skus, scenarios, launches, addAllegroScenario, setFunding, openAmazon, updateSku }: Props) {
  const proj = launches.length
    ? allegroSchedule(settings, thisMonth, lookahead, launches.map(l => ({ pin: l.sku.launch_month, paidBy: l.paidBy }))).months
    : allegroProjection(settings, thisMonth, lookahead, 1);
  const at = (i: number) => proj[Math.min(i, proj.length - 1)]?.balance ?? 0;
  const last = addMonths(thisMonth, lookahead - 1);
  const launch = proj.find(r => r.launch > 0);
  const inWindow = proj.reduce((t, r) => t + r.launches, 0);
  const budget = Number(settings.allegro_launch_usd) || 0;
  const pct = Math.min(1, Math.max(0, Number(settings.allegro_launch_cost_pct) || 0));
  const chart = proj.map(r => ({ month: monthLabel(r.month), balance: Math.round(r.balance) }));

  const skuNames = new Map<string, AmazonSku>();
  for (const x of skus) if (x.mode === 'inventory' && landedPerUnit(x) > 0 && !skuNames.has(x.name)) skuNames.set(x.name, x);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Allegro is the emergency fund. It's kept apart from DKT's cash and grows by its monthly top-up from outside.
        It isn't in DKT's forecast except for Amazon launches: each time Allegro reaches the launch amount, that amount goes into
        DKT's cash flow as money in from Allegro and launches the next new SKU of the Amazon scenario paid for by Allegro. Part of it pays the launch costs and the rest buys
        the first order. For anything else, move it into DKT's current cash by hand.
      </p>
      <div className="rounded-md border px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={settings.allegro_launch_on} onCheckedChange={v => saveSettings({ allegro_launch_on: !!v })} />
          <span>Fund {launches.length > 1 ? 'each' : 'an'} Amazon launch with</span>
        </label>
        <NumField className="w-24" label="Amazon launch amount" value={settings.allegro_launch_usd} onSave={v => saveSettings({ allegro_launch_usd: v ?? 0 })} />
        <label className="flex items-center gap-1.5">
          <NumField className="w-14" percent label="Launch costs share" value={settings.allegro_launch_cost_pct} onSave={v => saveSettings({ allegro_launch_cost_pct: Math.min(1, Math.max(0, v ?? 0)) })} />
          <span>for launch costs</span>
        </label>
        <span className="text-muted-foreground">({usd(budget * pct)} launch costs, {usd(budget * (1 - pct))} for the first order)</span>
        <span className={launch ? 'font-medium' : 'text-muted-foreground'}>
          {!settings.allegro_launch_on ? 'Off: not in the cash flow.'
            : launch ? (inWindow > 1 ? `${inWindow} launches by ${monthLabel(last)}, the first in ${monthLabel(launch.month)}.` : `Allegro has it in ${monthLabel(launch.month)}. It's in the cash flow that month.`)
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
        <Stat label={`By ${monthLabel(last)}`} value={usd(at(lookahead - 1))} sub={launch ? `After ${inWindow > 1 ? `${inWindow} Amazon launches` : 'the Amazon launch'}` : 'If nothing is taken out'} />
      </div>

      <LaunchQueue settings={settings} scenarios={scenarios} launches={launches} addAllegroScenario={addAllegroScenario} setFunding={setFunding} openAmazon={openAmazon} updateSku={updateSku} />

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

/** The new SKUs Allegro launches, in turn, and how each launch's budget is spent. */
function LaunchQueue({ settings, scenarios, launches, addAllegroScenario, setFunding, openAmazon, updateSku }: Pick<Props, 'settings' | 'scenarios' | 'launches' | 'addAllegroScenario' | 'setFunding' | 'openAmazon' | 'updateSku'>) {
  const funded = scenarios.filter(isAllegroScenario);
  const others = scenarios.filter(s => !isAllegroScenario(s));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Amazon launches Allegro pays for</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-xs">
        {!funded.length ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              No Amazon scenario is paid for by Allegro yet, so Allegro only moves its money into DKT's cash flow. Make one, add the new SKUs you'd launch to it
              (price, net margin, product cost, freight, units a month, make and ship months), and Allegro launches them in turn.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={addAllegroScenario}><Plus className="h-3.5 w-3.5 mr-1" /> Make an Allegro launch scenario</Button>
              {others.length > 0 && (
                <label className="flex items-center gap-1.5 text-muted-foreground">or use
                  <select aria-label="Scenario Allegro pays for" className="h-8 rounded-md border bg-background px-2 text-xs" value="" onChange={e => e.target.value && setFunding(e.target.value, 'allegro')}>
                    <option value="">pick a scenario…</option>
                    {others.map(s => <option key={s.id} value={s.id}>{s.name || 'Unnamed scenario'}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>
        ) : !launches.length ? (
          <p className="text-muted-foreground">
            {funded.map(s => s.name || 'Unnamed scenario').join(', ')} {funded.length === 1 ? 'is' : 'are'} paid for by Allegro but {funded.length === 1 ? 'has' : 'have'} no new SKUs counted yet.{' '}
            <button type="button" className="underline" onClick={openAmazon}>Add one on the Amazon tab</button>.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="font-medium py-1 pr-2">Launch</th>
                  <th className="font-medium px-2">PO month</th>
                  <th className="font-medium px-2 text-right">First order</th>
                  <th className="font-medium px-2 text-right" title="Launch costs + first order at landed cost">Cost</th>
                  <th className="font-medium px-2 text-right">Allegro pays</th>
                  <th className="font-medium px-2 text-right">DKT pays</th>
                  <th className="font-medium px-2">First sales</th>
                </tr>
              </thead>
              <tbody>
                {launches.map((l, i) => (
                  <Fragment key={l.sku.id}>
                    <tr className="border-t">
                      <td className="py-1.5 pr-2 font-medium">{i + 1}. {l.sku.name || 'Unnamed SKU'}</td>
                      <td className="py-1.5 px-2">
                        {l.month ? monthLabel(l.month) : <span className="text-muted-foreground">{settings.allegro_launch_on ? `Not by ${monthLabel(LONG_VIEW_MONTH)}` : 'Off'}</span>}
                        <span className="text-muted-foreground">{l.pinned ? ' · pinned' : l.month ? ' · Allegro has it' : ''}</span>
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{l.landed > 0 ? `${l.units.toLocaleString('en-US')} units` : <span className="text-warning">no cost yet</span>}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{usd(l.cost)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{l.past ? '—' : usd(l.fromAllegro)}</td>
                      <td className={cn('py-1.5 px-2 text-right tabular-nums', l.fromDkt > 0.5 && 'text-warning font-medium')}>{l.past ? 'already paid' : usd(l.fromDkt)}</td>
                      <td className="py-1.5 px-2">{l.launched.start_month ? monthLabel(l.launched.start_month) : '—'}</td>
                    </tr>
                    <tr>
                      <td colSpan={7} className="pb-2 pt-0">
                        <div className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                          <LaunchOverride launch={l} updateSku={updateSku} />
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {launches.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            A launch's first PO goes out the month Allegro has the money, unless you pin a PO month. A pinned launch is paid by Allegro if it has the full amount then (or as you choose), and DKT's cash pays
            whatever Allegro doesn't; Allegro's next launch then waits until it has saved up again. A PO month before this month counts as already paid.
            First sales follow after the SKU's make + ship months. Launch costs are paid with the PO and count as a cost in the profit card.
            First order = (launch amount − launch costs) ÷ (product cost + freight per unit), unless typed. Reorders after that come out of DKT's Amazon payouts, at the SKU's order quantity.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
