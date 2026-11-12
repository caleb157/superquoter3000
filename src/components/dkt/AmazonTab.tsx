import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Plus, Telescope, Trash2 } from 'lucide-react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { addMonths, isAllegroScenario, monthLabel, type AllegroLaunch, type DktSettings, type Month } from '@/lib/dkt-cashflow';
import { countedSkus, demandFor, firstPoMonth, landedPerUnit, LONG_VIEW_MONTH, longView, payoutPerUnit, scenarioSummary, type AmazonSku, type ScenarioSummary } from '@/lib/dkt-amazon';
import type { AmazonScenario } from '@/hooks/use-dkt-cashflow';
import { MonthField, NumField, SelectField, Stat, TextField, usd, usdK } from './fields';
import { LaunchOverride } from './LaunchOverride';

const pctLabel = (r: number) => `${(r * 100).toFixed(Math.abs(r) < 0.1 ? 1 : 0)}%`;

type Props = {
  scenarios: AmazonScenario[];
  skus: AmazonSku[]; // as typed
  /** SKUs as the projections see them: Allegro launches carry their worked-out dates and first order. */
  viewSkus: AmazonSku[];
  launches: AllegroLaunch[];
  settings: DktSettings;
  saveSettings: (p: Partial<DktSettings>) => void;
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
          The eye next to a SKU leaves it out of the scenario's numbers and the forecast without deleting it.
          A <b>simple</b> SKU is an existing line: monthly sales × price × net margin, from its start month.
          A <b>new SKU</b> runs the full cycle: 100% of product cost at PO, freight when it ships (after the make months), first sales after the ship months,
          and a reorder placed automatically so it arrives before stock runs out (make + ship months of sales at units per month). Net margin is what's left after Amazon fees and landed cost,
          so Amazon pays out price × net margin + landed cost per unit sold.
          A scenario <b>paid for by Allegro</b> launches its new SKUs in turn as Allegro saves up the launch amount: the first PO and first sales month and the first order are worked out from Allegro. Pin a launch's PO month to launch it sooner or later; DKT's cash pays whatever Allegro doesn't.
        </p>
        <Button size="sm" variant="outline" onClick={p.addScenario}><Plus className="h-3.5 w-3.5 mr-1" /> New scenario</Button>
      </div>
      {p.scenarios.map(s => <ScenarioCard key={s.id} scenario={s} {...p} />)}
    </div>
  );
}

/** Launch terms for a new SKU: smaller first order, lower first-batch margin, sales ramping up. Blank = same as the rest. */
function LaunchRow({ sku: x, updateSku, className, launch }: { sku: AmazonSku; updateSku: Props['updateSku']; className?: string; launch?: AllegroLaunch }) {
  const ramp = x.launch_units_per_month != null && (x.ramp_months ?? 0) > 0;
  const start = launch ? launch.firstSales : x.start_month;
  return (
    <tr className={cn('align-top', className)}>
      <td colSpan={11} className="pb-2 pt-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Launch</span>
          {launch ? <LaunchOverride launch={launch} updateSku={updateSku} /> : (
          <label className="flex items-center gap-1">First order
            <NumField className="w-16" integer allowEmpty label="First order quantity" placeholder={String(x.order_qty)} value={x.first_order_qty ?? null} onSave={v => updateSku(x.id, { first_order_qty: v })} />
            units</label>
          )}
          <label className="flex items-center gap-1">at
            <NumField className="w-14" percent allowEmpty label="First batch net margin" placeholder={`${Math.round(x.net_margin_pct * 100)}`} value={x.launch_margin_pct ?? null} onSave={v => updateSku(x.id, { launch_margin_pct: v })} />
            net margin</label>
          <label className="flex items-center gap-1">Sales start at
            <NumField className="w-14" allowEmpty label="Launch units per month" placeholder={String(x.units_per_month)} value={x.launch_units_per_month ?? null} onSave={v => updateSku(x.id, { launch_units_per_month: v })} />
            / mo, reaching {x.units_per_month} / mo after
            <NumField className="w-12" integer allowEmpty label="Ramp-up months" placeholder="0" value={x.ramp_months ?? null} onSave={v => updateSku(x.id, { ramp_months: v })} />
            months</label>
          {ramp && start && (
            <span>· {[0, 1, 2, 3, 4, 5].map(k => Math.round(demandFor({ ...x, start_month: start }, addMonths(start, k)))).join(', ')}…</span>
          )}
        </div>
      </td>
    </tr>
  );
}

type InvRow = { month: string; stock: number; onOrder: number; sold: number; ordered: number; stockout: boolean };
/** Units on the shelf and on the way at each month end, with units sold, across the scenario's new SKUs. */
function InventoryChart({ months }: { months: ScenarioSummary['months'] }) {
  const data: InvRow[] = months.map(m => ({
    month: monthLabel(m.month), stock: Math.round(m.stock), onOrder: Math.round(m.onOrder), sold: Math.round(m.sold), ordered: Math.round(m.ordered), stockout: m.stockout,
  }));
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">Inventory, month by month (units)</div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={52} allowDecimals={false} />
            <Tooltip content={<InventoryTip />} />
            <Bar dataKey="stock" stackId="inv" maxBarSize={24}>
              {data.map((r, i) => <Cell key={i} fill={r.stockout ? 'hsl(var(--destructive) / 0.55)' : 'hsl(var(--primary) / 0.45)'} />)}
            </Bar>
            <Bar dataKey="onOrder" stackId="inv" fill="hsl(var(--muted-foreground) / 0.25)" maxBarSize={24} />
            <Line type="monotone" dataKey="sold" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        Solid bars: units on the shelf at month end (red if a month ran out). Light bars: units ordered and still being made or shipped. Line: units sold that month.
      </p>
    </div>
  );
}

function InventoryTip({ active, payload }: { active?: boolean; payload?: { payload: InvRow }[] }) {
  const r = active && payload?.[0]?.payload;
  if (!r) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs space-y-0.5 tabular-nums">
      <div className="font-medium">{r.month}</div>
      <div>Sold: {r.sold}</div>
      <div>On the shelf at month end: {r.stock}</div>
      <div>On the way: {r.onOrder}</div>
      {r.ordered > 0 && <div>Ordered this month: {r.ordered}</div>}
      {r.stockout && <div className="text-destructive">Ran out this month</div>}
    </div>
  );
}

const longViewKey = (id: string) => `dkt-amazon-longview-${id}`;
function readOpen(id: string): boolean {
  try { return localStorage.getItem(longViewKey(id)) === '1'; } catch { return false; }
}

/** Long View: bottom-line net profit through May 2030 for the scenario's counted SKUs, with a long chart on a toggle. */
function LongViewPanel({ scenarioId, skus }: { scenarioId: string; skus: AmazonSku[] }) {
  const hasLaunchCosts = skus.some(x => (x.launch_cost_usd ?? 0) > 0 && x.start_month);
  const [open, setOpen] = useState(() => readOpen(scenarioId));
  const toggle = () => {
    const v = !open;
    setOpen(v);
    try { localStorage.setItem(longViewKey(scenarioId), v ? '1' : '0'); } catch { /* per-viewer convenience only */ }
  };
  const lv = longView(skus);
  const until = new Date(`${lv.until}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (!lv.summary.months.length) return null;
  const hasInventory = skus.some(x => x.mode === 'inventory');
  const chart = lv.summary.months.map(m => ({
    month: monthLabel(m.month), earned: Math.round(m.earned), profit: Math.round(m.earnedCumulative), cash: Math.round(m.cumulative),
  }));
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Telescope className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Long View to {until}</span>
        <span className="text-[11px] text-muted-foreground">Amazon is a long play: net profit (price × net margin on units sold{hasLaunchCosts ? ', less launch costs' : ''}, before tax) if this scenario runs as set up.</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={toggle} aria-expanded={open}>
          {open ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
          {open ? 'Hide long chart' : 'Show long chart'}
        </Button>
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Stat label={`Total net profit by ${until}`} value={usd(lv.totalProfit)} tone={lv.totalProfit >= 0 ? 'success' : 'destructive'} sub={`Over ${lv.summary.spanMonths} months`} />
        <Stat label={`Net profit in ${until}`} value={usd(lv.monthProfit)} tone={lv.monthProfit >= 0 ? 'success' : 'destructive'} sub={`${usd(lv.runRate)} a year at that pace`} />
        <Stat label={`Running cash in ${until}`} value={usd(lv.cash)} tone={lv.cash >= 0 ? 'success' : 'destructive'} sub={hasInventory ? `Plus ${usd(lv.stockValue)} of stock at cost` : 'Payouts received'} />
      </div>
      {lv.byYear.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Net profit by year:</span>
          {lv.byYear.map(y => (
            <span key={y.year} className="rounded border bg-background px-1.5 py-0.5 tabular-nums" title={y.months < 12 ? `${y.months} months counted` : undefined}>
              {y.year}{y.months < 12 ? ` (${y.months} mo)` : ''}: <b className={cn(y.profit < 0 && 'text-destructive')}>{usd(y.profit)}</b>
            </span>
          ))}
        </div>
      )}
      {open && chart.length > 1 && (
        <div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tickFormatter={usdK} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={52} />
                <Tooltip content={<LongViewTip />} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Line type="monotone" dataKey="profit" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                {hasInventory && <Line type="monotone" dataKey="cash" stroke="hsl(var(--warning))" strokeWidth={2} strokeDasharray="4 3" dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Solid line: total net profit so far.{hasInventory ? ' Dashed line: running cash (payouts minus stock and freight), which trails profit while money sits in stock.' : ''} Hover a month to see that month's profit.
          </p>
        </div>
      )}
    </div>
  );
}

type LvRow = { month: string; earned: number; profit: number; cash: number };
function LongViewTip({ active, payload }: { active?: boolean; payload?: { payload: LvRow }[] }) {
  const r = active && payload?.[0]?.payload;
  if (!r) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs space-y-0.5 tabular-nums">
      <div className="font-medium">{r.month}</div>
      <div>Net profit that month: {usd(r.earned)}</div>
      <div>Total net profit so far: {usd(r.profit)}</div>
      <div>Running cash: {usd(r.cash)}</div>
    </div>
  );
}

function ScenarioCard({ scenario: s, skus, viewSkus, launches, settings, saveSettings, thisMonth, lookahead, duplicateScenario, updateScenario, removeScenario, addSku, updateSku, removeSku }: Props & { scenario: AmazonScenario }) {
  const mine = skus.filter(x => x.scenario_id === s.id);
  const allegro = isAllegroScenario(s);
  const launchOf = new Map(launches.map(l => [l.sku.id, l]));
  // Projections use the SKUs as Allegro launches them (dates and first order worked out).
  const counted = countedSkus(viewSkus.filter(x => x.scenario_id === s.id));
  const on = allegro ? settings.allegro_launch_on : s.in_forecast;
  const pct = Math.round((Number(settings.allegro_launch_cost_pct) || 0) * 100);
  const leftOut = mine.length - counted.length;
  const last = addMonths(thisMonth, lookahead - 1);
  const sum = scenarioSummary(counted, last);
  const chart = sum.months.map(m => ({ month: monthLabel(m.month), in: Math.round(m.cashIn), out: -Math.round(m.cashOut), cumulative: Math.round(m.cumulative) }));
  const seriesName: Record<string, string> = { in: 'Money in', out: 'Money out', cumulative: 'Running total' };
  const hasInventory = counted.some(x => x.mode === 'inventory');
  return (
    <Card className={cn(on && 'border-primary/40')}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <TextField className="font-medium max-w-xs" label="Scenario name" value={s.name} onSave={v => updateScenario(s.id, { name: v })} />
          {allegro ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Same switch as on the Allegro tab">
              <Switch checked={settings.allegro_launch_on} onCheckedChange={v => saveSettings({ allegro_launch_on: v })} />
              Allegro launches on
            </label>
          ) : (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={s.in_forecast} onCheckedChange={v => updateScenario(s.id, { in_forecast: v })} />
            In DKT forecast
          </label>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Paid for by
            <SelectField className="w-36" label="Paid for by" value={allegro ? 'allegro' : 'dkt'}
              options={[{ value: 'dkt', label: 'DKT cash' }, { value: 'allegro', label: 'Allegro fund' }]}
              onSave={v => updateScenario(s.id, { funding: v })} />
          </label>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => duplicateScenario(s)}><Copy className="h-3.5 w-3.5 mr-1" /> Duplicate</Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Delete scenario" onClick={() => { if (confirm(`Delete scenario ${s.name || ''} and its SKUs?`)) removeScenario(s.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        <TextField className="text-xs" label="Notes" placeholder="Notes" value={s.notes} onSave={v => updateScenario(s.id, { notes: v || null })} />
      </CardHeader>
      <CardContent className="space-y-3">
        {allegro && (
          <p className="text-[11px] rounded-md bg-primary/5 border border-primary/20 px-2 py-1.5">
            Each new SKU here launches in turn as Allegro reaches its {usd(settings.allegro_launch_usd)} launch amount
            {settings.allegro_launch_on ? '' : ' (launches are off right now)'}. {pct}% goes to launch costs and the rest buys the first order;
            the first PO goes out that month and sales start after the make + ship months. Set the amount and split on the Allegro tab.
            Reorders after that are paid from DKT's Amazon payouts. To launch one sooner or later, pin its PO month on its Launch line; DKT's cash pays whatever Allegro can't.
          </p>
        )}
        {leftOut > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {leftOut} SKU{leftOut === 1 ? ' is' : 's are'} left out of this projection (greyed out below). Click the eye to count {leftOut === 1 ? 'it' : 'them'} again.
          </p>
        )}
        {counted.length > 0 && (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
            {hasInventory && <Stat label="Most cash tied up" value={usd(sum.peakNeed)} sub={sum.peakMonth ? `in ${monthLabel(sum.peakMonth)}` : undefined} tone={sum.peakNeed > 0 ? 'warning' : undefined} />}
            {hasInventory && <Stat label="Paid back by" value={sum.paybackMonth ? monthLabel(sum.paybackMonth) : sum.peakNeed > 0 ? `after ${monthLabel(last)}` : '—'} />}
            <Stat label={`Net cash by ${monthLabel(last)}`} value={usd(sum.profit)} tone={sum.profit >= 0 ? 'success' : 'destructive'} />
            {hasInventory && <Stat label="Stock left (at cost)" value={usd(sum.stockValue)} sub={`Worth ${usd(sum.profit + sum.stockValue)} with cash`} />}
            {hasInventory && <Stat label="Months out of stock" value={sum.stockoutMonths} tone={sum.stockoutMonths ? 'destructive' : undefined} sub={sum.stockoutMonths ? 'Order more per PO' : 'None'} />}
            <Stat label={`Net earnings by ${monthLabel(last)}`} value={usd(sum.earnings)} tone={sum.earnings >= 0 ? 'success' : 'destructive'} sub="Price × net margin on units sold" />
            {sum.launchCosts > 0 && <Stat label="Launch costs" value={usd(sum.launchCosts)} sub="Part of each launch budget" />}
            {hasInventory && <Stat label="Cash ROI (annualized)" value={sum.annualRoi == null ? '—' : pctLabel(sum.annualRoi)} tone={sum.annualRoi == null ? undefined : sum.annualRoi >= 0 ? 'success' : 'destructive'} sub={sum.roi == null ? 'No cash tied up' : `${pctLabel(sum.roi)} on ${usd(sum.peakNeed)} over ${sum.spanMonths} mo`} />}
          </div>
        )}
        {counted.length > 0 && <LongViewPanel scenarioId={s.id} skus={counted} />}
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
                <th className="font-medium px-1 text-right" title="Months from PO to shipping, then shipping to first sale">Make / ship (mo)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mine.map(x => {
                const inv = x.mode === 'inventory';
                const launch = allegro && inv ? launchOf.get(x.id) : undefined;
                const po = launch ? (launch.launched.start_month ? launch.month : null) : firstPoMonth(x);
                const off = !!x.excluded;
                const dim = off ? 'opacity-40' : undefined;
                return (
                  <Fragment key={x.id}>
                  <tr className={cn('border-t align-top', off && 'bg-muted/30')}>
                    <td className="py-1.5 pr-2 min-w-[9rem]">
                      <div className={dim}>
                      <TextField label="SKU" value={x.name} placeholder="SKU name" onSave={v => updateSku(x.id, { name: v })} />
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Payout {usd(payoutPerUnit(x))}/unit{inv && po ? ` · first PO ${monthLabel(po)}` : ''}
                      </div>
                      {!off && !allegro && !x.start_month && <div className="text-[10px] text-warning mt-0.5">Set a first sales month to count it</div>}
                      {!off && allegro && !inv && <div className="text-[10px] text-warning mt-0.5">Allegro only launches new SKUs, so this line isn't counted</div>}
                      {!off && launch && !(launch.landed > 0) && <div className="text-[10px] text-warning mt-0.5">Add product cost and freight to size the first order</div>}
                      {!off && launch && launch.landed > 0 && !launch.units && <div className="text-[10px] text-warning mt-0.5">The launch budget doesn't buy one unit</div>}
                      {!off && launch && launch.landed > 0 && launch.units > 0 && !launch.month && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">{settings.allegro_launch_on ? `Allegro doesn't reach this launch by ${monthLabel(LONG_VIEW_MONTH)}` : 'Allegro launches are off'}</div>
                      )}
                      </div>
                      {off && <div className="text-[10px] font-medium text-muted-foreground mt-0.5">Left out of the projection</div>}
                    </td>
                    <td className={cn('py-1.5 px-1', dim)}><SelectField label="Type" value={x.mode} options={[{ value: 'simple', label: 'Simple' }, { value: 'inventory', label: 'New SKU' }]} onSave={v => updateSku(x.id, { mode: v })} /></td>
                    <td className={cn('py-1.5 px-1 w-20', dim)}><NumField label="Price" value={x.price_usd} onSave={v => updateSku(x.id, { price_usd: v ?? 0 })} /></td>
                    <td className={cn('py-1.5 px-1 w-20', dim)}><NumField percent label="Net margin" value={x.net_margin_pct} onSave={v => updateSku(x.id, { net_margin_pct: v ?? 0 })} /></td>
                    <td className={cn('py-1.5 px-1 w-20', dim)}><NumField label="Units per month" value={x.units_per_month} onSave={v => updateSku(x.id, { units_per_month: v ?? 0 })} /></td>
                    <td className={cn('py-1.5 px-1', dim)}>
                      {allegro && inv ? (
                        <div className="pt-1.5 whitespace-nowrap" title="Worked out from when Allegro reaches the launch amount, plus make + ship months">
                          {launch?.launched.start_month ? monthLabel(launch.launched.start_month) : '—'}
                          <div className="text-[10px] text-muted-foreground">{launch?.pinned ? 'pinned PO' : 'from Allegro'}</div>
                        </div>
                      ) : <MonthField label="First sales month" allowEmpty value={x.start_month} onSave={v => updateSku(x.id, { start_month: v })} />}
                    </td>
                    {inv ? (
                      <>
                        <td className={cn('py-1.5 px-1 w-20', dim)}><NumField label="Product cost per unit" value={x.unit_cost_usd} onSave={v => updateSku(x.id, { unit_cost_usd: v ?? 0 })} /></td>
                        <td className={cn('py-1.5 px-1 w-20', dim)}>
                          <NumField label="Freight per unit" value={x.freight_per_unit_usd} onSave={v => updateSku(x.id, { freight_per_unit_usd: v ?? 0 })} />
                          <div className="text-[10px] text-muted-foreground text-right mt-0.5">landed {usd(landedPerUnit(x))}</div>
                        </td>
                        <td className={cn('py-1.5 px-1 w-20', dim)}>
                          <NumField integer label="Order quantity" value={x.order_qty} onSave={v => updateSku(x.id, { order_qty: v ?? 0 })} />
                          <div className="text-[10px] text-muted-foreground text-right mt-0.5">{launch ? (x.order_qty > 0 ? `reorders · ${usd(x.order_qty * landedPerUnit(x))}` : 'reorders = first order') : usd(x.order_qty * landedPerUnit(x))}</div>
                        </td>
                        <td className={cn('py-1.5 px-1', dim)}>
                          <div className="flex gap-1">
                            <NumField className="w-12" integer label="Make months" value={x.make_months} onSave={v => updateSku(x.id, { make_months: v ?? 0 })} />
                            <NumField className="w-12" integer label="Ship months" value={x.ship_months} onSave={v => updateSku(x.id, { ship_months: v ?? 0 })} />
                          </div>
                        </td>
                      </>
                    ) : <td colSpan={4} className={cn('py-1.5 px-1 text-muted-foreground pt-3', dim)}>Existing line: no stock purchases modelled.</td>}
                    <td className="py-1.5 pl-1">
                      <div className="flex">
                        <Button size="icon" variant="ghost" className={cn('h-7 w-7', off && 'text-muted-foreground')}
                          aria-label={off ? 'Count this SKU in the projection' : 'Leave this SKU out of the projection'}
                          title={off ? 'Left out: click to count it again' : 'Leave out of the projection (keeps the SKU)'}
                          aria-pressed={off}
                          onClick={() => updateSku(x.id, { excluded: !off })}>
                          {off ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete SKU" onClick={() => removeSku(x.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                  {inv && <LaunchRow sku={x} updateSku={updateSku} className={dim} launch={launch} />}
                  </Fragment>
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
            <div className="text-xs text-muted-foreground mb-1">Cash from this scenario, month by month</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={usdK} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={52} />
                  <Tooltip formatter={(v: number, k: string) => [usd(v), seriesName[k] ?? k]} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="in" stackId="cash" fill="hsl(var(--success) / 0.55)" maxBarSize={24} />
                  <Bar dataKey="out" stackId="cash" fill="hsl(var(--destructive) / 0.55)" maxBarSize={24} />
                  <Line type="monotone" dataKey="cumulative" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Green bars: Amazon payouts that month. Red bars: stock and freight paid that month. Line: running total since the first PO.</p>
          </div>
        )}
        {hasInventory && sum.months.length > 1 && <InventoryChart months={sum.months} />}
      </CardContent>
    </Card>
  );
}
