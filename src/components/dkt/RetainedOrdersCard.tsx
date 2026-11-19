// Orders tab → Retained orders: a what-if list (CCT's quarterly container, last year's customers again)
// that runs through the same order math as the pipeline. Rows count only while ticked; all start unticked.
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { orderAmounts } from '@/lib/dkt-cashflow';
import type { RetainedOrder } from '@/lib/dkt-retained';
import { MonthField, NumField, SelectField, TextField, usd } from './fields';

type Props = {
  rows: RetainedOrder[];
  local: boolean;
  save: (id: string, p: Partial<RetainedOrder>) => void;
  countAll: (counted: boolean) => void;
  add: () => void;
  remove: (id: string) => void;
};

const LAG_OPTIONS = [
  { value: '0', label: 'At shipment' },
  { value: '1', label: '1 month after' },
  { value: '2', label: '2 months after' },
  { value: '3', label: '3 months after' },
];

export function RetainedOrdersCard({ rows, local, save, countAll, add, remove }: Props) {
  const counted = rows.filter(r => r.counted);
  const fob = counted.reduce((s, r) => s + r.fob_usd, 0);
  const margin = counted.reduce((s, r) => s + orderAmounts(r).margin, 0);

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-start justify-between gap-4 space-y-0 flex-wrap">
        <div className="space-y-1">
          <CardTitle className="text-sm">Retained orders (simulation)</CardTitle>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Orders DKT expects to keep getting, typed here: they aren't inquiries or Odoo orders. Tick Count to put a row in the forecast; every row starts unticked.
            The starting list is CCT's container every quarter (no deposit, paid the month after shipping) and last year's other DKT customers again, a year on, all at 10% to DKT.
            Customer deposit and the advance to PV fall in the PO month, PV's balance in the ship month, and the customer's balance when "Customer pays" says.
          </p>
          {local && <p className="text-[11px] text-warning">Saved in this browser only until the retained orders SQL is run.</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground tabular-nums">
            {counted.length} of {rows.length} counted{counted.length ? ` · FOB ${usd(fob)} · DKT margin ${usd(margin)}` : ''}
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => countAll(true)} disabled={!rows.length || counted.length === rows.length}>Count all</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => countAll(false)} disabled={!counted.length}>Count none</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={add}><Plus className="h-3.5 w-3.5 mr-1" /> Add order</Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {!rows.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No retained orders. Add one to try it in the forecast.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="font-medium py-1.5 pr-2">Order</th>
                <th className="font-medium py-1.5 px-1 text-right">FOB</th>
                <th className="font-medium py-1.5 px-1 text-right" title="DKT keeps this share of FOB">DKT margin</th>
                <th className="font-medium py-1.5 px-1 text-right">Cust. deposit</th>
                <th className="font-medium py-1.5 px-1 text-right" title="Share of PV's amount DKT pays at PO">Advance to PV</th>
                <th className="font-medium py-1.5 px-1">PO month</th>
                <th className="font-medium py-1.5 px-1">Ship month</th>
                <th className="font-medium py-1.5 px-1" title="When the customer pays its balance">Customer pays</th>
                <th className="font-medium py-1.5 px-1 text-right" title="Advance minus customer deposit: what DKT carries until shipping">DKT funds</th>
                <th className="font-medium py-1.5 pl-1 text-center">Count</th>
                <th className="py-1.5 pl-1"><span className="sr-only">Delete</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const a = orderAmounts(r);
                return (
                  <tr key={r.id} className={cn('border-t align-top', !r.counted && 'opacity-60')}>
                    <td className="py-2 pr-2 min-w-[12rem] space-y-1">
                      <TextField label="Order name" value={r.name} onSave={v => save(r.id, { name: v })} className="h-7 text-xs font-medium" />
                      <TextField label="Customer" placeholder="Customer" value={r.customer} onSave={v => save(r.id, { customer: v || null })} className="h-7 text-xs" />
                    </td>
                    <td className="py-2 px-1 w-28">
                      <NumField label="FOB" value={Math.round(r.fob_usd)} onSave={v => save(r.id, { fob_usd: v ?? 0 })} />
                    </td>
                    <td className="py-2 px-1 w-20">
                      <NumField percent label="DKT margin" value={r.margin_pct} onSave={v => save(r.id, { margin_pct: v ?? 0 })} />
                      <div className="text-[10px] text-muted-foreground text-right mt-0.5">{usd(a.margin)}</div>
                    </td>
                    <td className="py-2 px-1 w-20">
                      <NumField percent label="Customer deposit" value={r.cust_deposit_pct} onSave={v => save(r.id, { cust_deposit_pct: v ?? 0 })} />
                      <div className="text-[10px] text-muted-foreground text-right mt-0.5">{usd(a.custDeposit)}</div>
                    </td>
                    <td className="py-2 px-1 w-20">
                      <NumField percent label="Advance to PV" value={r.advance_pct} onSave={v => save(r.id, { advance_pct: v ?? 0 })} />
                      <div className="text-[10px] text-muted-foreground text-right mt-0.5">{usd(a.pvAdvance)}</div>
                    </td>
                    <td className="py-2 px-1">
                      <MonthField label="PO month" value={r.po_month} onSave={v => v && save(r.id, { po_month: v, ...(r.ship_month < v ? { ship_month: v } : {}) })} />
                    </td>
                    <td className="py-2 px-1">
                      <MonthField label="Ship month" value={r.ship_month} onSave={v => v && save(r.id, { ship_month: v < r.po_month ? r.po_month : v })} />
                    </td>
                    <td className="py-2 px-1">
                      <SelectField label="Customer pays" className="w-[8.5rem]" value={String(Math.min(3, Math.max(0, r.cust_lag_months)))} options={LAG_OPTIONS}
                        onSave={v => save(r.id, { cust_lag_months: Number(v) })} />
                    </td>
                    <td className={cn('py-2 px-1 text-right tabular-nums font-medium pt-3.5', a.gap > 0 && 'text-warning')}>{usd(a.gap)}</td>
                    <td className="py-2 pl-1 text-center pt-3">
                      <Checkbox aria-label={`Count ${r.name}`} checked={r.counted} onCheckedChange={v => save(r.id, { counted: !!v })} />
                    </td>
                    <td className="py-2 pl-1 pt-2">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${r.name}`} onClick={() => remove(r.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
