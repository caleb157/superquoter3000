import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  creditBalances, creditDrawnToday, drawTerms, monthDiff, monthLabel, monthRange, realDrawStatus, toMonth,
  type CreditDraw, type CreditLine, type Forecast, type Month,
} from '@/lib/dkt-cashflow';
import { fieldCls, MonthField, NumField, SelectField, Stat, TextField, usd } from './fields';

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
  const today = creditDrawnToday(lines, draws, thisMonth);
  const owed = (l: CreditLine) => today[l.id] ?? 0;
  const limit = lines.reduce((s, l) => s + l.limit_usd, 0);
  const drawn = lines.reduce((s, l) => s + owed(l), 0);
  const cheapest = [...lines].filter(l => l.limit_usd > owed(l)).sort((a, b) => a.rate_pct - b.rate_pct)[0];
  const need = forecast.need;
  // This month's interest and fees, from the forecast.
  const monthlyInterest = -forecast.flows.filter(f => f.kind === 'credit_interest' && f.month === thisMonth).reduce((s, f) => s + f.amount, 0);
  const real = realDrawStatus(lines, draws, months);
  const planned = draws.filter(d => !d.actual);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Total limits" value={usd(limit)} />
        <Stat label="Drawn today" value={usd(drawn)} sub={`${limit ? Math.round(drawn / limit * 100) : 0}% used`} />
        <Stat label="Available today" value={usd(limit - drawn)} tone="success" />
        <Stat label="Interest and fees this month" value={usd(monthlyInterest)} />
      </div>

      {need && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm flex flex-wrap items-center gap-3 justify-between">
          <span>
            The forecast is short <b>{usd(need.amount)}</b> by {monthLabel(need.firstMonth)}.
            {cheapest ? ` Cheapest line with room: ${cheapest.name} at ${cheapest.rate_pct}% (${usd(cheapest.limit_usd - owed(cheapest))} available).` : ' Add a credit line to plan a draw.'}
          </span>
          {cheapest && (
            <Button size="sm" variant="outline" onClick={() => p.addDraw({ line_id: cheapest.id, month: need.firstMonth, amount_usd: Math.ceil(Math.min(need.amount, cheapest.limit_usd - owed(cheapest)) / 100) * 100 })}>
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
                  <th className="font-medium px-1 text-right" title="Real draws not yet repaid, worked out from Draws taken below">Drawn today</th>
                  <th className="font-medium px-1 text-right">Rate (yearly %)</th>
                  <th className="font-medium px-1" title="Everything drawn is repaid in full this month">Due in full</th>
                  <th className="font-medium px-1 text-right" title="Each draw is repaid in this many equal monthly payments, starting the month after. Leave blank for a revolving line.">Repay over (months)</th>
                  <th className="font-medium px-1 text-right" title="Fee each month as a % of the draw, while it's being repaid (used instead of the yearly rate)">Monthly fee %</th>
                  <th className="font-medium px-1" title="Revolving lines: interest paid every month, or built up and paid with the principal on the due date (balloon)">Interest paid</th>
                  <th className="font-medium px-1 text-right">Available</th>
                  <th className="font-medium px-1 text-right">Drawn at end of forecast</th>
                  <th className="font-medium px-1">Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const endBal = bal[l.id]?.[bal[l.id].length - 1] ?? owed(l);
                  return (
                    <tr key={l.id} className="border-t">
                      <td className="py-1.5 pr-2 min-w-[10rem]"><TextField label="Name" value={l.name} placeholder="e.g. Chase LOC" onSave={v => p.updateLine(l.id, { name: v })} /></td>
                      <td className="py-1.5 px-1 w-28"><NumField label="Limit" value={l.limit_usd} onSave={v => p.updateLine(l.id, { limit_usd: v ?? 0 })} /></td>
                      <td className="py-1.5 px-1 w-28 text-right tabular-nums">
                        {usd(owed(l))}
                        {l.drawn_usd > 0 && (
                          <button type="button" className="block ml-auto text-[10px] text-muted-foreground underline" title="A balance typed by hand before draws were recorded. Record it as a draw below, then clear it."
                            onClick={() => { if (confirm(`Clear the ${usd(l.drawn_usd)} typed by hand on ${l.name}? Record it under Draws taken first.`)) p.updateLine(l.id, { drawn_usd: 0 }); }}>
                            incl. {usd(l.drawn_usd)} typed
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 px-1 w-20"><NumField label="Rate" value={l.rate_pct} onSave={v => p.updateLine(l.id, { rate_pct: v ?? 0 })} /></td>
                      <td className="py-1.5 px-1"><MonthField label="Due in full" allowEmpty value={l.maturity_month ?? null} onSave={v => p.updateLine(l.id, { maturity_month: v })} /></td>
                      <td className="py-1.5 px-1 w-20"><NumField integer allowEmpty label="Repay over (months)" value={l.term_months ?? null} onSave={v => p.updateLine(l.id, { term_months: v })} /></td>
                      <td className="py-1.5 px-1 w-20"><NumField allowEmpty label="Monthly fee %" value={l.monthly_fee_pct ?? null} onSave={v => p.updateLine(l.id, { monthly_fee_pct: v })} /></td>
                      <td className="py-1.5 px-1"><BalloonField value={!!l.balloon} onSave={v => p.updateLine(l.id, { balloon: v })} /></td>
                      <td className="py-1.5 px-1 text-right tabular-nums">{usd(l.limit_usd - owed(l))}</td>
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
            <CardTitle className="text-sm">Draws taken</CardTitle>
            <p className="text-xs text-muted-foreground">Money you've actually drawn. These make up Drawn today and Available, and their repayments, fees and interest go into the forecast on each draw's own terms. A draw dated after you last saved cash in the bank is added as cash in this month.</p>
          </div>
          <Button size="sm" disabled={!lines.length} onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Record a draw
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!real.length ? <p className="text-xs text-muted-foreground">No draws recorded yet.</p> : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="font-medium py-1 pr-2">Line</th>
                  <th className="font-medium px-1">Drawn on</th>
                  <th className="font-medium px-1 text-right">Amount</th>
                  <th className="font-medium px-1 text-right" title="Repaid in this many equal monthly payments, from the month after. Blank: revolving, interest on what's owed.">Repay over (months)</th>
                  <th className="font-medium px-1 text-right" title="Fee each month as a % of the draw while it's being repaid">Monthly fee %</th>
                  <th className="font-medium px-1 text-right">Rate (yearly %)</th>
                  <th className="font-medium px-1" title="Revolving draws: interest paid every month, or built up and paid with the principal on the due date (balloon)">Interest paid</th>
                  <th className="font-medium px-1">Due in full</th>
                  <th className="font-medium px-1 text-right">Owed now</th>
                  <th className="font-medium px-1 text-right">Next payment</th>
                  <th className="font-medium px-1">Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {real.map(({ draw: d, terms, left, next }) => (
                  <tr key={d.id} className="border-t">
                    <td className="py-1.5 pr-2">
                      <SelectField label="Line" value={d.line_id} options={lines.map(l => ({ value: l.id, label: l.name || 'Unnamed line' }))} onSave={v => p.updateDraw(d.id, { line_id: v })} />
                    </td>
                    <td className="py-1.5 px-1"><DateField label="Drawn on" value={d.draw_date ?? `${d.month}-01`} onSave={v => p.updateDraw(d.id, { draw_date: v, month: toMonth(v)! })} /></td>
                    <td className="py-1.5 px-1 w-28"><NumField label="Amount" value={d.amount_usd} onSave={v => p.updateDraw(d.id, { amount_usd: v ?? 0 })} /></td>
                    <td className="py-1.5 px-1 w-20"><NumField integer allowEmpty label="Repay over (months)" value={terms.term_months} onSave={v => p.updateDraw(d.id, { term_months: v })} /></td>
                    <td className="py-1.5 px-1 w-20"><NumField allowEmpty label="Monthly fee %" value={terms.monthly_fee_pct} onSave={v => p.updateDraw(d.id, { monthly_fee_pct: v })} /></td>
                    <td className="py-1.5 px-1 w-20"><NumField label="Rate" value={terms.rate_pct} onSave={v => p.updateDraw(d.id, { rate_pct: v ?? 0 })} /></td>
                    <td className="py-1.5 px-1"><BalloonField value={terms.balloon} onSave={v => p.updateDraw(d.id, { balloon: v })} /></td>
                    <td className="py-1.5 px-1"><MonthField label="Due in full" allowEmpty value={terms.maturity_month} onSave={v => p.updateDraw(d.id, { maturity_month: v })} /></td>
                    <td className="py-1.5 px-1 text-right tabular-nums">{usd(left)}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums whitespace-nowrap">{next ? <>{usd(next.amount)} <span className="text-muted-foreground">{monthLabel(next.month)}</span></> : '—'}</td>
                    <td className="py-1.5 px-1 min-w-[9rem]"><TextField label="Notes" value={d.notes ?? null} onSave={v => p.updateDraw(d.id, { notes: v || null })} /></td>
                    <td className="py-1.5 pl-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete draw" onClick={() => { if (confirm('Delete this draw?')) p.removeDraw(d.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                ))}
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
            <Plus className="h-3.5 w-3.5 mr-1" /> Plan a draw
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!planned.length ? <p className="text-xs text-muted-foreground">No draws planned.</p> : (
            <table className="text-xs">
              <thead className="text-muted-foreground text-left">
                <tr><th className="font-medium py-1 pr-2">Line</th><th className="font-medium px-1">Month</th><th className="font-medium px-1 text-right">Amount</th><th /></tr>
              </thead>
              <tbody>
                {planned.map(d => (
                  <tr key={d.id} className={cn('border-t', d.month < thisMonth && 'text-muted-foreground')}>
                    <td className="py-1.5 pr-2">
                      <SelectField label="Line" value={d.line_id} options={lines.map(l => ({ value: l.id, label: l.name || 'Unnamed line' }))} onSave={v => p.updateDraw(d.id, { line_id: v })} />
                    </td>
                    <td className="py-1.5 px-1"><MonthField label="Month" value={d.month} onSave={v => v && p.updateDraw(d.id, { month: v })} /></td>
                    <td className="py-1.5 px-1 w-32"><NumField label="Amount" value={d.amount_usd} onSave={v => p.updateDraw(d.id, { amount_usd: v ?? 0 })} /></td>
                    <td className="py-1.5 pl-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete draw" onClick={() => p.removeDraw(d.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      {d.month < thisMonth && <span className="ml-1">past: record it under Draws taken instead</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {adding && <NewDrawDialog lines={lines} owed={owed} onClose={() => setAdding(false)} onAdd={row => { p.addDraw(row); setAdding(false); }} />}
    </div>
  );
}

function BalloonField({ value, onSave, className }: { value: boolean; onSave: (v: boolean) => void; className?: string }) {
  return (
    <SelectField className={className} label="Interest paid" value={value ? 'end' : 'monthly'}
      options={[{ value: 'monthly', label: 'Monthly' }, { value: 'end', label: 'At the end (balloon)' }]}
      onSave={v => onSave(v === 'end')} />
  );
}

function DateField({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  return (
    <input type="date" aria-label={label} className={cn(fieldCls, 'w-[9.5rem]')} value={value}
      onChange={e => { if (e.target.value && e.target.value !== value) onSave(e.target.value); }} />
  );
}

/** Records a real draw: pick the line, and its terms are filled in from the line to check or change. */
function NewDrawDialog({ lines, owed, onClose, onAdd }: {
  lines: LineRow[]; owed: (l: CreditLine) => number; onClose: () => void; onAdd: (row: Partial<CreditDraw>) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const seed = (l: LineRow) => ({ line_id: l.id, ...drawTerms(l) });
  const [f, setF] = useState<Partial<CreditDraw> & { line_id: string }>(() => ({ draw_date: today, amount_usd: 0, notes: null, ...seed(lines[0]) }));
  const line = lines.find(l => l.id === f.line_id) ?? lines[0];
  const room = line.limit_usd - owed(line);
  const set = (p: Partial<CreditDraw>) => setF(x => ({ ...x, ...p }));
  const installment = (Number(f.term_months) || 0) > 0;
  const amt = Number(f.amount_usd) || 0;
  const label = 'text-[11px] text-muted-foreground';
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Record a draw</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 space-y-1"><div className={label}>Line</div>
            <SelectField className="w-full" label="Line" value={f.line_id} options={lines.map(l => ({ value: l.id, label: `${l.name || 'Unnamed line'} (${usd(l.limit_usd - owed(l))} available)` }))}
              onSave={v => { const l = lines.find(x => x.id === v); if (l) set(seed(l)); }} />
          </label>
          <label className="space-y-1"><div className={label}>Drawn on</div>
            <DateField label="Drawn on" value={f.draw_date || today} onSave={v => set({ draw_date: v })} />
          </label>
          <label className="space-y-1"><div className={label}>Amount (USD)</div>
            <NumField label="Amount" value={f.amount_usd ?? 0} onSave={v => set({ amount_usd: v ?? 0 })} />
          </label>
          <div className="col-span-2 text-xs font-medium pt-1">Repayment terms <span className="font-normal text-muted-foreground">(from {line.name || 'the line'}; change them for this draw)</span></div>
          <label className="space-y-1"><div className={label}>Repay over (months)</div>
            <NumField integer allowEmpty label="Repay over (months)" placeholder="Revolving" value={f.term_months ?? null} onSave={v => set({ term_months: v })} />
          </label>
          <label className="space-y-1"><div className={label}>Monthly fee % of the draw</div>
            <NumField allowEmpty label="Monthly fee %" value={f.monthly_fee_pct ?? null} onSave={v => set({ monthly_fee_pct: v })} />
          </label>
          <label className="space-y-1"><div className={label}>Interest (yearly %)</div>
            <NumField label="Rate" value={f.rate_pct ?? 0} onSave={v => set({ rate_pct: v ?? 0 })} />
          </label>
          <label className="space-y-1"><div className={label}>Due in full</div>
            <MonthField allowEmpty label="Due in full" value={f.maturity_month ?? null} onSave={v => set({ maturity_month: v })} />
          </label>
          {!installment && (
            <label className="col-span-2 space-y-1"><div className={label}>Interest paid</div>
              <BalloonField className="w-full" value={!!f.balloon} onSave={v => set({ balloon: v })} />
            </label>
          )}
          <label className="col-span-2 space-y-1"><div className={label}>Notes</div>
            <TextField label="Notes" value={f.notes ?? null} onSave={v => set({ notes: v || null })} />
          </label>
          <p className="col-span-2 text-xs text-muted-foreground">
            {amt > 0 && (installment
              ? `${Math.round(Number(f.term_months))} payments of ${usd(amt / Number(f.term_months) + amt * (Number(f.monthly_fee_pct) || 0) / 100)} a month from the month after.`
              : f.balloon
                ? f.maturity_month
                  ? `One payment of ${usd(amt * (1 + (Number(f.rate_pct) || 0) / 100 / 12 * Math.max(0, monthDiff(toMonth(f.draw_date) ?? f.maturity_month, f.maturity_month))))} (principal + interest) in ${monthLabel(f.maturity_month)}.`
                  : 'Interest builds up until it is paid. Set a "due in full" month for the balloon payment.'
                : `About ${usd(amt * (Number(f.rate_pct) || 0) / 100 / 12)} interest a month${f.maturity_month ? `, all due ${monthLabel(f.maturity_month)}` : ''}.`)}
            {amt > room + 0.5 && <span className="text-destructive"> That's more than the {usd(room)} available.</span>}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={amt <= 0 || !f.draw_date} onClick={() => onAdd({ ...f, actual: true, month: toMonth(f.draw_date)! })}>Add draw</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
