// Pull as needed on the DKT Cash Flow forecast: one switch that draws from the credit lines in their pull
// order (Credit lines tab) whenever a month would end under "Keep at least", and pays them back when the
// cash ahead allows. Math: src/lib/dkt-pull-as-needed.ts. A what-if: nothing is saved; the switch is
// kept in this browser.
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { monthLabel } from '@/lib/dkt-cashflow';
import type { PullPlan } from '@/lib/dkt-pull-as-needed';
import { Stat, usd } from './fields';

export type PullPrefs = { on: boolean };

export function PullAsNeededCard({ prefs, setPrefs, plan, minCash, queueSize, openCredit }: {
  prefs: PullPrefs; setPrefs: (p: PullPrefs) => void; plan: PullPlan | null; minCash: number;
  /** Credit lines with a pull order. */
  queueSize: number;
  openCredit: () => void;
}) {
  const p = plan;
  const months = p?.forecast.months.map(m => m.month) ?? [];
  const byMonth = p ? months.map(m => ({ m, rows: p.moves.filter(x => x.month === m) })).filter(x => x.rows.length) : [];
  const last = months[months.length - 1];
  return (
    <Card className={cn(prefs.on && 'border-primary/40')}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2">
            <Switch checked={prefs.on} onCheckedChange={on => setPrefs({ on })} aria-label="Pull credit as needed" />
            <CardTitle className="text-sm">Pull credit as needed</CardTitle>
          </label>
          <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={openCredit}>Set pull order</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Whenever a month would end under {usd(minCash)} (Keep at least), it draws what's missing, in $500 steps ($500, $1,000, $1,500…), from your credit lines in their pull order: the first line until it's full, then the next.
          It pays revolving lines back, last in the order first, in $500 steps (or the whole balance) as soon as the cash ahead allows, and never pays back money it would have to pull again within the forecast.
          Installment lines (Amex) repay on their own schedule. Planned draws typed on the Credit lines tab are set aside while this is on; real draws stay.
          A what-if only: nothing is saved. {prefs.on ? 'The chart, profit and table below show it.' : 'Switch it on to see the forecast with it.'}
        </p>
      </CardHeader>
      {prefs.on && (
        <CardContent className="space-y-3">
          {!queueSize && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0" aria-hidden />
              <span>No credit line has a pull order yet, so nothing is pulled. Give them one on the Credit lines tab (1 first, then 2…).</span>
            </div>
          )}
          {p && p.short.length > 0 && queueSize > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" aria-hidden />
              <span>
                Even with every line in the pull order drawn to its limit, cash ends under {usd(minCash)} in {p.short.map(s => monthLabel(s.month)).join(', ')}
                {' '}(short by up to {usd(Math.max(...p.short.map(s => s.amount)))}). Add a line to the order, raise a limit, or plan other money in.
              </span>
            </div>
          )}
          {p && p.setAside > 0 && (
            <p className="text-[11px] text-muted-foreground">{p.setAside} planned draw{p.setAside === 1 ? '' : 's'} on the Credit lines tab {p.setAside === 1 ? 'is' : 'are'} set aside while this is on.</p>
          )}
          {p && (
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Stat label="Pulled in total" value={usd(p.pulledTotal)} sub={months.length ? `${monthLabel(months[0])} to ${monthLabel(last)}` : undefined} />
              <Stat label="Most owed on these lines" value={usd(p.lines.reduce((s, l) => s + l.peak, 0))} sub="Real draws + pulls, highest month per line" />
              <Stat label="Interest and fees, all debt" value={usd(p.interestPull)} sub={`${usd(p.interestBase)} without pulls`} />
              <Stat label={last ? `Still owed on these lines, end of ${monthLabel(last)}` : 'Still owed at the end'} value={usd(p.lines.reduce((s, l) => s + l.endOwed, 0))}
                sub={`Net profit ${usd(p.profitPull)}`} tone={p.short.length ? 'destructive' : undefined} />
            </div>
          )}
          {p && p.lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium py-1.5 pr-3">Order</th>
                    <th className="text-left font-medium py-1.5 pr-3">Line</th>
                    <th className="text-right font-medium py-1.5 px-2">Limit</th>
                    <th className="text-right font-medium py-1.5 px-2">Pulled</th>
                    <th className="text-right font-medium py-1.5 px-2">Paid back</th>
                    <th className="text-right font-medium py-1.5 px-2">Most owed</th>
                    <th className="text-right font-medium py-1.5 pl-2">Owed at end</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lines.map(l => (
                    <tr key={l.id} className="border-t border-border/50">
                      <td className="py-1.5 pr-3 text-muted-foreground">{l.order}</td>
                      <td className="py-1.5 pr-3">{l.name}{l.installment && <span className="text-muted-foreground"> · installments</span>}</td>
                      <td className="text-right py-1.5 px-2 text-muted-foreground">{usd(l.limit)}</td>
                      <td className="text-right py-1.5 px-2">{l.pulled > 0.5 ? usd(l.pulled) : <span className="text-muted-foreground/50">–</span>}</td>
                      <td className="text-right py-1.5 px-2">{l.paidBack > 0.5 ? usd(l.paidBack) : <span className="text-muted-foreground/50">–</span>}</td>
                      <td className={cn('text-right py-1.5 px-2', l.peak >= l.limit - 0.5 && l.limit > 0 && 'text-warning font-medium')}>{usd(l.peak)}</td>
                      <td className="text-right py-1.5 pl-2">{usd(l.endOwed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted-foreground mt-1">Most owed includes draws you've already taken. Orange: the line reaches its limit.</p>
            </div>
          )}
          {p && (byMonth.length > 0 ? (
            <div className="rounded-md border px-3 py-2 text-xs">
              <div className="font-medium mb-1">Pulls and pay-backs</div>
              <div className="divide-y">
                {byMonth.map(({ m, rows }) => (
                  <div key={m} className="flex flex-wrap justify-between gap-x-3 py-1">
                    <span className="font-medium">{monthLabel(m)}</span>
                    <span className="text-muted-foreground">
                      {rows.map(r => (r.amount > 0 ? `Pull ${usd(r.amount)} from ${r.name}` : `Pay back ${usd(-r.amount)} to ${r.name}`)).join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : queueSize > 0 ? (
            <p className="text-xs text-muted-foreground">Cash stays at or above {usd(minCash)} every month without pulling anything.</p>
          ) : null)}
        </CardContent>
      )}
    </Card>
  );
}
