import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CostItem, Month } from '@/lib/dkt-cashflow';
import { MonthField, NumField, SelectField, Stat, TextField, usd } from './fields';

type Props = {
  costs: CostItem[];
  thisMonth: Month;
  add: (row: Partial<CostItem>) => void;
  update: (id: string, p: Partial<CostItem>) => void;
  remove: (id: string) => void;
};

const KINDS: { value: CostItem['kind']; label: string; help: string }[] = [
  { value: 'overhead', label: 'Overhead', help: 'Fixed running costs: salaries, rent, software, insurance, accounting.' },
  { value: 'expense', label: 'Expenses', help: 'Other costs: taxes, one-off purchases, travel, fees.' },
  { value: 'income', label: 'Other income', help: 'Money in that is not an order or Amazon, such as a refund or a capital injection.' },
];
const FREQ = [
  { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' }, { value: 'once', label: 'Once' },
] as const;
const perMonth = (c: CostItem) => (c.frequency === 'monthly' ? c.amount_usd : c.frequency === 'quarterly' ? c.amount_usd / 3 : c.frequency === 'yearly' ? c.amount_usd / 12 : 0);

export function CostsTab({ costs, thisMonth, add, update, remove }: Props) {
  const active = (c: CostItem) => !c.end_month || c.end_month >= thisMonth;
  const monthly = (k: CostItem['kind']) => costs.filter(c => c.kind === k && active(c)).reduce((s, c) => s + perMonth(c), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Stat label="Overhead per month" value={usd(monthly('overhead'))} sub="Quarterly and yearly spread out" />
        <Stat label="Expenses per month" value={usd(monthly('expense'))} sub="Excludes one-off items" />
        <Stat label="Other income per month" value={usd(monthly('income'))} />
      </div>
      <p className="text-xs text-muted-foreground">
        Type these from Odoo or your books once a month; they stay until you change them. A line runs from its start month
        (blank = now) to its end month (blank = forever). Quarterly and yearly lines repeat from their start month.
      </p>
      {KINDS.map(k => {
        const rows = costs.filter(c => c.kind === k.value);
        return (
          <Card key={k.value}>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0 gap-2">
              <div>
                <CardTitle className="text-sm">{k.label}</CardTitle>
                <p className="text-xs text-muted-foreground">{k.help}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => add({ kind: k.value, name: '', amount_usd: 0, frequency: 'monthly' })}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {!rows.length ? <p className="text-xs text-muted-foreground">None yet.</p> : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="font-medium py-1 pr-2">Name</th>
                      <th className="font-medium py-1 px-1 text-right">Amount</th>
                      <th className="font-medium py-1 px-1">How often</th>
                      <th className="font-medium py-1 px-1">From</th>
                      <th className="font-medium py-1 px-1">Until</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(c => (
                      <tr key={c.id} className="border-t">
                        <td className="py-1.5 pr-2 min-w-[12rem]"><TextField label="Name" value={c.name} placeholder="e.g. Salaries" onSave={v => update(c.id, { name: v })} /></td>
                        <td className="py-1.5 px-1 w-28"><NumField label="Amount" value={c.amount_usd} onSave={v => update(c.id, { amount_usd: v ?? 0 })} /></td>
                        <td className="py-1.5 px-1"><SelectField label="How often" value={c.frequency} options={[...FREQ]} onSave={v => update(c.id, { frequency: v })} /></td>
                        <td className="py-1.5 px-1"><MonthField label="From" allowEmpty value={c.start_month} onSave={v => update(c.id, { start_month: v })} /></td>
                        <td className="py-1.5 px-1"><MonthField label="Until" allowEmpty value={c.end_month} onSave={v => update(c.id, { end_month: v })} /></td>
                        <td className="py-1.5 pl-1 text-right">
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete" onClick={() => remove(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
