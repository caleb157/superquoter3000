import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { creditBalances, monthLabel, monthRange, type CreditDraw, type CreditLine, type Forecast, type Month } from '@/lib/dkt-cashflow';
import { MonthField, NumField, SelectField, Stat, TextField, usd } from './fields';

type LineRow = CreditLine & { notes: string | null };
type Props = {
  lines: LineRow[];
  draws: CreditDraw[];
  forecast: Forecast;
  thisMonth: Month;
  horizon: number;
  addLine: () => void;
  updateLine: (id: string, p: Partial<LineRow>) => void;
  removeLine: (id: string) => void;
  addDraw: (row: Partial<CreditDraw>) => void;
  updateDraw: (id: string, p: Partial<CreditDraw>) => void;
  removeDraw: (id: string) => void;
};

export function CreditTab(p: Props) {
  const { lines, draws, forecast, thisMonth, horizon } = p;
  const months = monthRange(thisMonth, horizon);
  const bal = creditBalances(lines, draws, months);
  const limit = lines.reduce((s, l) => s + l.limit_usd, 0);
  const drawn = lines.reduce((s, l) => s + l.drawn_usd, 0);
  const cheapest = [...lines].filter(l => l.limit_usd > l.drawn_usd).sort((a, b) => a.rate_pct - b.rate_pct)[0];
  const need = forecast.need;
  const monthlyInterest = lines.reduce((s, l) => s + l.drawn_usd * l.rate_pct / 100 / 12, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Total limits" value={usd(limit)} />
        <Stat label="Drawn today" value={usd(drawn)} sub={`${limit ? Math.round(drawn / limit * 100) : 0}% used`} />
        <Stat label="Available today" value={usd(limit - drawn)} tone="success" />
        <Stat label="Interest per month today" value={usd(monthlyInterest)} />
      </div>

      {need && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm flex flex-wrap items-center gap-3 justify-between">
          <span>
            The forecast is short <b>{usd(need.amount)}</b> by {monthLabel(need.firstMonth)}.
            {cheapest ? ` Cheapest line with room: ${cheapest.name} at ${cheapest.rate_pct}% (${usd(cheapest.limit_usd - cheapest.drawn_usd)} available).` : ' Add a credit line to plan a draw.'}
          </span>
          {cheapest && (
            <Button size="sm" variant="outline" onClick={() => p.addDraw({ line_id: cheapest.id, month: need.firstMonth, amount_usd: Math.ceil(Math.min(need.amount, cheapest.limit_usd - cheapest.drawn_usd) / 100) * 100 })}>
              Try a draw on {cheapest.name}
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Lines of credit</CardTitle>
          <Button size="sm" variant="outline" onClick={p.addLine}><Plus className="h-3.5 w-3.5 mr-1" /> Add line</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!lines.length ? <p className="text-xs text-muted-foreground">No credit lines yet.</p> : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="font-medium py-1 pr-2">Name</th>
                  <th className="font-medium px-1 text-right">Limit</th>
                  <th className="font-medium px-1 text-right">Drawn today</th>
                  <th className="font-medium px-1 text-right">Rate (yearly %)</th>
                  <th className="font-medium px-1" title="Everything drawn is repaid in full this month">Due in full</th>
                  <th className="font-medium px-1 text-right" title="Each draw is repaid in this many equal monthly payments, starting the month after. Leave blank for a revolving line.">Repay over (months)</th>
                  <th className="font-medium px-1 text-right" title="Fee each month as a % of the draw, while it's being repaid (used instead of the yearly rate)">Monthly fee %</th>
                  <th className="font-medium px-1 text-right">Available</th>
                  <th className="font-medium px-1 text-right">Drawn at end of forecast</th>
                  <th className="font-medium px-1">Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const endBal = bal[l.id]?.[bal[l.id].length - 1] ?? l.drawn_usd;
                  return (
                    <tr key={l.id} className="border-t">
                      <td className="py-1.5 pr-2 min-w-[10rem]"><TextField label="Name" value={l.name} placeholder="e.g. Chase LOC" onSave={v => p.updateLine(l.id, { name: v })} /></td>
                      <td className="py-1.5 px-1 w-28"><NumField label="Limit" value={l.limit_usd} onSave={v => p.updateLine(l.id, { limit_usd: v ?? 0 })} /></td>
                      <td className="py-1.5 px-1 w-28"><NumField label="Drawn" value={l.drawn_usd} onSave={v => p.updateLine(l.id, { drawn_usd: v ?? 0 })} /></td>
                      <td className="py-1.5 px-1 w-20"><NumField label="Rate" value={l.rate_pct} onSave={v => p.updateLine(l.id, { rate_pct: v ?? 0 })} /></td>
                      <td className="py-1.5 px-1"><MonthField label="Due in full" allowEmpty value={l.maturity_month ?? null} onSave={v => p.updateLine(l.id, { maturity_month: v })} /></td>
                      <td className="py-1.5 px-1 w-20"><NumField integer allowEmpty label="Repay over (months)" value={l.term_months ?? null} onSave={v => p.updateLine(l.id, { term_months: v })} /></td>
                      <td className="py-1.5 px-1 w-20"><NumField allowEmpty label="Monthly fee %" value={l.monthly_fee_pct ?? null} onSave={v => p.updateLine(l.id, { monthly_fee_pct: v })} /></td>
                      <td className="py-1.5 px-1 text-right tabular-nums">{usd(l.limit_usd - l.drawn_usd)}</td>
                      <td className={cn('py-1.5 px-1 text-right tabular-nums', endBal > l.limit_usd && 'text-destructive font-medium')}>{usd(endBal)}{endBal > l.limit_usd ? ' (over limit)' : ''}</td>
                      <td className="py-1.5 px-1 min-w-[10rem]"><TextField label="Notes" value={l.notes} onSave={v => p.updateLine(l.id, { notes: v || null })} /></td>
                      <td className="py-1.5 pl-1"><Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete line" onClick={() => { if (confirm(`Delete ${l.name || 'this line'}?`)) p.removeLine(l.id); }}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0 gap-2">
          <div>
            <CardTitle className="text-sm">Planned draws and repayments</CardTitle>
            <p className="text-xs text-muted-foreground">Try draws here to see how they change the forecast. A negative amount is a repayment. Interest is charged monthly on what's drawn, and a line with a "due in full" month is repaid in full that month.</p>
          </div>
          <Button size="sm" variant="outline" disabled={!lines.length} onClick={() => p.addDraw({ line_id: lines[0]?.id, month: thisMonth, amount_usd: 0 })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add draw
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!draws.length ? <p className="text-xs text-muted-foreground">No draws planned.</p> : (
            <table className="text-xs">
              <thead className="text-muted-foreground text-left">
                <tr><th className="font-medium py-1 pr-2">Line</th><th className="font-medium px-1">Month</th><th className="font-medium px-1 text-right">Amount</th><th /></tr>
              </thead>
              <tbody>
                {draws.map(d => (
                  <tr key={d.id} className={cn('border-t', d.month < thisMonth && 'text-muted-foreground')}>
                    <td className="py-1.5 pr-2">
                      <SelectField label="Line" value={d.line_id} options={lines.map(l => ({ value: l.id, label: l.name || 'Unnamed line' }))} onSave={v => p.updateDraw(d.id, { line_id: v })} />
                    </td>
                    <td className="py-1.5 px-1"><MonthField label="Month" value={d.month} onSave={v => v && p.updateDraw(d.id, { month: v })} /></td>
                    <td className="py-1.5 px-1 w-32"><NumField label="Amount" value={d.amount_usd} onSave={v => p.updateDraw(d.id, { amount_usd: v ?? 0 })} /></td>
                    <td className="py-1.5 pl-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete draw" onClick={() => p.removeDraw(d.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      {d.month < thisMonth && <span className="ml-1">past: update "Drawn today" instead</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
