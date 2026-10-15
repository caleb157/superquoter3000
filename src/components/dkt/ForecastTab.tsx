import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  FLOW_LABEL, IN_KINDS, monthLabel, OUT_KINDS,
  type DktSettings, type Flow, type FlowKind, type Forecast, type Month,
} from '@/lib/dkt-cashflow';
import { NumField, SelectField, Stat, usd, usdK } from './fields';

type Props = {
  forecast: Forecast;
  settings: DktSettings;
  saveSettings: (p: Partial<DktSettings>) => void;
  totalOwed: number;
  creditAvailable: number;
};

export function ForecastTab({ forecast, settings, saveSettings, totalOwed, creditAvailable }: Props) {
  const [cell, setCell] = useState<{ title: string; flows: Flow[] } | null>(null);
  const { months, need, lowest } = forecast;
  const used = useMemo(() => new Set(forecast.flows.map(f => f.kind)), [forecast.flows]);
  const inKinds = IN_KINDS.filter(k => used.has(k));
  const outKinds = OUT_KINDS.filter(k => used.has(k));
  const chart = months.map(m => ({ month: monthLabel(m.month), net: Math.round(m.net), closing: Math.round(m.closing) }));
  const open = (title: string, month: Month | null, kinds: FlowKind[]) =>
    setCell({ title, flows: forecast.flows.filter(f => (!month || f.month === month) && kinds.includes(f.kind)) });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border px-3 py-2 space-y-1">
          <div className="text-[11px] text-muted-foreground">Cash in the bank now</div>
          <NumField label="Current cash" value={settings.cash_usd} onSave={v => saveSettings({ cash_usd: v ?? 0, cash_as_of: new Date().toISOString().slice(0, 10) })} />
          <div className="text-[11px] text-muted-foreground">{settings.cash_as_of ? `Updated ${settings.cash_as_of}` : 'Type today’s balance'}</div>
        </div>
        <div className="rounded-md border px-3 py-2 space-y-1">
          <div className="text-[11px] text-muted-foreground">Keep at least</div>
          <NumField label="Minimum cash" value={settings.min_cash_usd} onSave={v => saveSettings({ min_cash_usd: v ?? 0 })} />
          <div className="text-[11px] text-muted-foreground">Alerts when cash drops below this</div>
        </div>
        <Stat label="Loans still owed" value={usd(totalOwed)} sub="Principal, all loans" />
        <Stat label="Credit available" value={usd(creditAvailable)} sub="Limits minus what's drawn" />
      </div>

      {need ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm space-y-0.5">
            <div className="font-semibold">You need {usd(need.amount)} more by {monthLabel(need.firstMonth)}.</div>
            <div className="text-muted-foreground">
              Cash first drops below {usd(settings.min_cash_usd)} in {monthLabel(need.firstMonth)} and is lowest in {monthLabel(need.peakMonth)}
              {lowest ? ` (${usd(lowest.closing)})` : ''}. {need.amount <= creditAvailable
                ? `Your credit lines have ${usd(creditAvailable)} available, which covers it. Plan a draw on the Credit lines tab to see the forecast with it.`
                : `That is more than the ${usd(creditAvailable)} left on your credit lines.`}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-success/40 bg-success/10 px-4 py-3 flex gap-3 items-center">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
          <div className="text-sm">
            Cash stays above {usd(settings.min_cash_usd)} for the next {months.length} months.
            {lowest && <span className="text-muted-foreground"> Lowest point is {usd(lowest.closing)} in {monthLabel(lowest.month)}.</span>}
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Cash at the end of each month</CardTitle>
          <SelectField
            label="Months to forecast" value={String(settings.horizon_months)}
            options={[12, 18, 24].map(n => ({ value: String(n), label: `${n} months` }))}
            onSave={v => saveSettings({ horizon_months: Number(v) })}
          />
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={usdK} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={56} />
                <Tooltip
                  formatter={(v: number, k: string) => [usd(v), k === 'closing' ? 'Cash at month end' : 'Net for the month']}
                  contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
                />
                <ReferenceLine y={settings.min_cash_usd} stroke="hsl(var(--warning))" strokeDasharray="4 4" />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="net" radius={[3, 3, 0, 0]} maxBarSize={28}>
                  {chart.map((r, i) => <Cell key={i} fill={r.net >= 0 ? 'hsl(var(--success) / 0.55)' : 'hsl(var(--destructive) / 0.55)'} />)}
                </Bar>
                <Line type="monotone" dataKey="closing" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Line: cash at month end. Bars: money in minus money out. Dashed line: your minimum.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Month by month</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium py-1.5 pr-3 sticky left-0 bg-card min-w-[11rem]" />
                {months.map(m => <th key={m.month} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{monthLabel(m.month)}</th>)}
                <th className="text-right font-medium py-1.5 pl-3">Total</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Opening cash" values={months.map(m => m.opening)} muted />
              <Section label="Money in" />
              {inKinds.map(k => (
                <Row key={k} label={FLOW_LABEL[k]} values={months.map(m => m.byKind[k] || 0)} total
                  onCell={i => open(`${FLOW_LABEL[k]} · ${i == null ? 'all months' : monthLabel(months[i].month)}`, i == null ? null : months[i].month, [k])} />
              ))}
              <Row label="Total in" values={months.map(m => m.inflow)} bold total />
              <Section label="Money out" />
              {outKinds.map(k => (
                <Row key={k} label={FLOW_LABEL[k]} values={months.map(m => m.byKind[k] || 0)} total
                  onCell={i => open(`${FLOW_LABEL[k]} · ${i == null ? 'all months' : monthLabel(months[i].month)}`, i == null ? null : months[i].month, [k])} />
              ))}
              <Row label="Total out" values={months.map(m => -m.outflow)} bold total />
              <tr><td className="h-2" /></tr>
              <Row label="Net for the month" values={months.map(m => m.net)} bold total />
              <Row label="Cash at month end" values={months.map(m => m.closing)} bold highlight min={settings.min_cash_usd} />
              <Row label="Short of minimum" values={months.map(m => m.shortBy)} danger />
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-2">Click a number to see what's in it.</p>
        </CardContent>
      </Card>

      <Dialog open={!!cell} onOpenChange={o => !o && setCell(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-base">{cell?.title}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto divide-y text-sm">
            {(cell?.flows ?? []).map((f, i) => (
              <div key={i} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{f.label} <span className="text-muted-foreground text-xs">· {monthLabel(f.month)}</span></span>
                <span className={cn('tabular-nums', f.amount < 0 && 'text-destructive')}>{usd(f.amount)}</span>
              </div>
            ))}
            {cell && !cell.flows.length && <p className="text-muted-foreground py-2">Nothing here.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ label }: { label: string }) {
  return (
    <tr><td className="pt-3 pb-1 text-[11px] font-semibold text-muted-foreground sticky left-0 bg-card">{label}</td></tr>
  );
}

function Row({ label, values, bold, muted, highlight, danger, total, onCell, min }: {
  label: string; values: number[]; bold?: boolean; muted?: boolean; highlight?: boolean; danger?: boolean; total?: boolean;
  onCell?: (i: number | null) => void; min?: number;
}) {
  const sum = values.reduce((s, v) => s + v, 0);
  if (danger && !values.some(v => v > 0.5)) return null;
  return (
    <tr className={cn('border-t border-border/50', highlight && 'bg-muted/40')}>
      <td className={cn('py-1.5 pr-3 sticky left-0 whitespace-nowrap', highlight ? 'bg-muted' : 'bg-card', bold && 'font-semibold', muted && 'text-muted-foreground', danger && 'text-destructive')}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={cn('text-right py-1.5 px-2 whitespace-nowrap', bold && 'font-semibold', muted && 'text-muted-foreground',
          (danger || (min != null && v < min) || (!highlight && v < 0)) && 'text-destructive')}>
          {Math.abs(v) < 0.5 ? <span className="text-muted-foreground/50">–</span>
            : onCell ? <button type="button" className="hover:underline" onClick={() => onCell(i)}>{usd(v)}</button> : usd(v)}
        </td>
      ))}
      <td className={cn('text-right py-1.5 pl-3 whitespace-nowrap', bold && 'font-semibold')}>
        {total ? (onCell ? <button type="button" className="hover:underline" onClick={() => onCell(null)}>{usd(sum)}</button> : usd(sum)) : ''}
      </td>
    </tr>
  );
}

