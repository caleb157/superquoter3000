import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { budgetPace, budgetTotals, type BudgetPace, type Snapshot } from '@/lib/master-analytics';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const lakh = (n: number) => '₹' + (n / 100000).toFixed(2) + ' L';

const PACE: Record<BudgetPace, { label: string; bar: string; text: string }> = {
  under: { label: 'On track', bar: 'bg-success', text: 'text-success' },
  near: { label: 'Near pace', bar: 'bg-warning', text: 'text-warning' },
  over_pace: { label: 'Over pace', bar: 'bg-warning', text: 'text-warning' },
  over_budget: { label: 'Over budget', bar: 'bg-destructive', text: 'text-destructive' },
  unbudgeted: { label: 'Unbudgeted', bar: 'bg-destructive', text: 'text-destructive' },
};
const RANK: Record<BudgetPace, number> = { over_budget: 0, unbudgeted: 1, over_pace: 2, near: 3, under: 4 };

/** Bullet pacing bars: track = full budget, fill = achieved, tick = Odoo's theoretical amount today. */
export function BudgetZone({ snapshot }: { snapshot: Snapshot | null }) {
  const budgets = snapshot?.budgets ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const b = budgets.find(x => String(x.id) === sel) ?? budgets[0];
  const rows = useMemo(() => (b?.lines ?? []).map(l => ({ ...l, pace: budgetPace(l) }))
    .sort((x, y) => RANK[x.pace] - RANK[y.pace] || (y.achieved / (y.budget || 1)) - (x.achieved / (x.budget || 1))), [b]);

  if (!snapshot) return null;
  if (!b) return <p className="text-xs text-muted-foreground">No open Odoo budgets in the last refresh. Press Refresh to load them.</p>;
  const t = budgetTotals(b);
  const scale = Math.max(1, ...rows.map(r => Math.max(r.budget, r.achieved)));
  const under = t.variance >= 0;

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {budgets.length > 1 ? (
            <Select value={String(b.id)} onValueChange={setSel}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{budgets.map(x => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : <span className="text-sm font-semibold">{b.name}</span>}
          <span className="text-xs text-muted-foreground">{b.date_from} → {b.date_to}</span>
          <div className="ml-auto flex flex-wrap gap-2 text-xs">
            <span className="rounded border px-2 py-1">Spent <b className="tabular-nums">{lakh(t.achieved)}</b> of {lakh(t.budget)}</span>
            <span className="rounded border px-2 py-1">Pace today <b className="tabular-nums">{lakh(t.theoretical)}</b></span>
            <span className={cn('rounded border px-2 py-1 font-medium', under ? 'text-success' : 'text-destructive')}>
              {under ? 'Under' : 'Over'} pace by {lakh(Math.abs(t.variance))}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-[150px_1fr_190px] gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Category</span><span>Spent vs budget · tick = pace today</span><span className="text-right">Spent / Budget</span>
          </div>
          {rows.map(r => {
            const p = PACE[r.pace];
            const pct = r.budget > 0 ? (r.achieved / r.budget) * 100 : null;
            return (
              <div key={r.id} className="grid grid-cols-[150px_1fr_190px] items-center gap-3 text-xs" title={`Pace today ${inr(r.theoretical)}`}>
                <span className="truncate font-medium">{r.name}</span>
                <div className="relative h-4 rounded bg-muted">
                  <div className="absolute inset-y-0 left-0 rounded bg-muted-foreground/15" style={{ width: `${(r.budget / scale) * 100}%` }} />
                  <div className={cn('absolute inset-y-1 left-0 rounded-sm', p.bar)} style={{ width: `${(r.achieved / scale) * 100}%` }} />
                  {r.budget > 0 && <div className="absolute -inset-y-0.5 w-0.5 bg-foreground" style={{ left: `${(r.theoretical / scale) * 100}%` }} />}
                </div>
                <div className="flex items-center justify-end gap-2 tabular-nums">
                  <span>{lakh(r.achieved)} / {lakh(r.budget)}</span>
                  <span className={cn('w-24 text-right font-medium', p.text)}>{pct != null ? `${Math.round(pct)}% · ` : ''}{p.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
