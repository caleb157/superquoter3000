// Max payoff on the DKT Cash Flow forecast: a switch, the buffer to keep, and the plan-vs-max
// comparison. Math: src/lib/dkt-max-payoff.ts. Nothing here is saved to the database; the switch
// and buffer are kept in this browser only.
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { monthLabel } from '@/lib/dkt-cashflow';
import { payoffLabel, type MaxPayoff } from '@/lib/dkt-max-payoff';
import { NumField, Stat, usd } from './fields';

export type PayoffPrefs = { on: boolean; buffer: number };

export function MaxPayoffCard({ prefs, setPrefs, payoff }: { prefs: PayoffPrefs; setPrefs: (p: PayoffPrefs) => void; payoff: MaxPayoff | null }) {
  const months = payoff?.months.map(m => m.month) ?? [];
  const p = payoff;
  const debtEndBase = p?.months[p.months.length - 1]?.debtBase ?? 0;
  const debtEndMax = p?.months[p.months.length - 1]?.debtMax ?? 0;
  const byMonth = p ? months.map(m => ({ m, rows: p.payments.filter(x => x.month === m && x.amount >= 0.5) })).filter(x => x.rows.length) : [];
  return (
    <Card className={cn(prefs.on && 'border-primary/40')}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2">
            <Switch checked={prefs.on} onCheckedChange={on => setPrefs({ ...prefs, on })} aria-label="Max loan payoff" />
            <CardTitle className="text-sm">Max loan payoff</CardTitle>
          </label>
          <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
            Keep at least
            <NumField className="w-24" label="Payoff buffer" value={prefs.buffer} onSave={v => setPrefs({ ...prefs, buffer: Math.max(0, v ?? 0) })} />
            in the bank
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Each month, every dollar above {usd(prefs.buffer)} goes to paying debt early, on top of the normal plan. It only pays what
          the lowest cash ahead of it allows, so no later month (with its known bills) drops under {usd(prefs.buffer)}.
          Dearest debt first, then the smallest. Scheduled payments, fees and due dates stay as they are; planned credit draws stay
          planned. A what-if only: nothing is saved. {prefs.on ? 'The chart, profit and table below show it.' : 'Switch it on to see the forecast with it.'}
        </p>
      </CardHeader>
      {prefs.on && p && (
        <CardContent className="space-y-3">
          {p.belowBufferMonths.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0" aria-hidden />
              <span>
                The plan alone leaves cash under {usd(p.buffer)} in {p.belowBufferMonths.map(m => monthLabel(m)).join(', ')}, so the buffer
                can't be held there and nothing extra is paid before {monthLabel(p.belowBufferMonths[p.belowBufferMonths.length - 1])}.
              </span>
            </div>
          )}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Paid early, on top of the plan" value={usd(p.extraTotal)} sub={`${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}`} />
            <Stat label="Interest and fees saved" value={usd(p.interestSaved)} sub={`${usd(p.interestMax)} vs ${usd(p.interestBase)} on the plan`} tone={p.interestSaved > 0.5 ? 'success' : undefined} />
            <Stat label="Net profit" value={usd(p.profitMax)} sub={`${usd(p.profitBase)} on the plan`} />
            <Stat label={`Debt left at end of ${monthLabel(months[months.length - 1])}`} value={usd(debtEndMax)}
              sub={p.debtFreeMax ? `Debt-free in ${monthLabel(p.debtFreeMax)}` : `${usd(debtEndBase)} on the plan`} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium py-1.5 pr-3">Debt</th>
                  <th className="text-right font-medium py-1.5 px-2">Rate</th>
                  <th className="text-right font-medium py-1.5 px-2">Owed now</th>
                  <th className="text-right font-medium py-1.5 px-2">Paid off (plan)</th>
                  <th className="text-right font-medium py-1.5 px-2">Paid off (max)</th>
                  <th className="text-right font-medium py-1.5 px-2">Extra paid</th>
                  <th className="text-right font-medium py-1.5 pl-2">Left at end</th>
                </tr>
              </thead>
              <tbody>
                {[...p.debts].sort((a, b) => b.apr - a.apr || b.today - a.today).map(d => {
                  const sooner = d.maxPaidOff && (!d.basePaidOff || d.maxPaidOff < d.basePaidOff);
                  return (
                    <tr key={d.key} className="border-t border-border/50">
                      <td className="py-1.5 pr-3">{d.name}</td>
                      <td className="text-right py-1.5 px-2 text-muted-foreground">{d.apr ? `${d.apr.toFixed(1)}%` : '0%'}</td>
                      <td className="text-right py-1.5 px-2">{usd(d.today)}</td>
                      <td className="text-right py-1.5 px-2 text-muted-foreground">{payoffLabel(d.basePaidOff, months)}</td>
                      <td className={cn('text-right py-1.5 px-2', sooner && 'text-success font-medium')}>{payoffLabel(d.maxPaidOff, months)}</td>
                      <td className="text-right py-1.5 px-2">{d.extra > 0.5 ? usd(d.extra) : <span className="text-muted-foreground/50">–</span>}</td>
                      <td className="text-right py-1.5 pl-2">{usd(d.maxEnd)}{Math.abs(d.baseEnd - d.maxEnd) > 0.5 && <span className="text-muted-foreground"> (plan {usd(d.baseEnd)})</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground mt-1">
              Rate is a yearly rate on what's owed now. An installment line's monthly fee is charged on the original draw, so its real rate is higher than its fee.
            </p>
          </div>
          {byMonth.length > 0 ? (
            <div className="rounded-md border px-3 py-2 text-xs">
              <div className="font-medium mb-1">Extra payments</div>
              <div className="divide-y">
                {byMonth.map(({ m, rows }) => (
                  <div key={m} className="flex flex-wrap justify-between gap-x-3 py-1">
                    <span className="font-medium">{monthLabel(m)}</span>
                    <span className="text-muted-foreground">{rows.map(r => `${r.name} ${usd(r.amount)}`).join(' · ')}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No month has cash above {usd(p.buffer)} to spare, so nothing extra is paid.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
