import { useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  addMonths, loanOutstanding, lumpLoanMonth, monthLabel,
  type DktOrder, type Loan, type LoanPayment, type Month, type OdooOrder,
} from '@/lib/dkt-cashflow';
import { MonthField, NumField, SelectField, Stat, TextField, usd } from './fields';

type LoanRow = Loan & { notes: string | null };
type Props = {
  loans: LoanRow[];
  payments: LoanPayment[];
  orders: DktOrder[];
  odooOrders: OdooOrder[];
  thisMonth: Month;
  addLoan: () => void;
  updateLoan: (id: string, p: Partial<LoanRow>) => void;
  removeLoan: (id: string) => void;
  addPayment: (loanId: string) => void;
  updatePayment: (id: string, p: Partial<LoanPayment>) => void;
  removePayment: (id: string) => void;
};

export function LoansTab(p: Props) {
  const { loans, payments, orders, odooOrders, thisMonth } = p;
  const yearEnd = addMonths(thisMonth, 11);
  const dueThisYear = loans.filter(l => l.active).reduce((s, l) => {
    if (l.kind === 'schedule') {
      return s + payments.filter(x => x.loan_id === l.id && !x.paid && x.due_date.slice(0, 7) <= yearEnd).reduce((t, x) => t + x.principal_usd + x.interest_usd, 0);
    }
    const m = lumpLoanMonth(l, orders, odooOrders);
    return s + (m && m <= yearEnd ? l.balance_usd : 0);
  }, 0);
  const undated = loans.filter(l => l.active && l.kind === 'lump' && !lumpLoanMonth(l, orders, odooOrders));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Stat label="Total owed" value={usd(loans.filter(l => l.active).reduce((s, l) => s + loanOutstanding(l, payments), 0))} />
        <Stat label="Due in the next 12 months" value={usd(dueThisYear)} sub="Principal and interest" />
        <Stat label="No repayment date yet" value={usd(undated.reduce((s, l) => s + l.balance_usd, 0))} sub={undated.length ? `${undated.length} loan${undated.length > 1 ? 's' : ''}, not in the forecast` : 'All loans are planned'} tone={undated.length ? 'warning' : undefined} />
      </div>
      <div className="flex justify-between items-center gap-2">
        <p className="text-xs text-muted-foreground max-w-2xl">
          A loan either has a payment schedule (like the ORG loan) or is one sum paid back in a month you pick, or with an order's final customer payment.
          Loans with neither are listed but left out of the forecast. Tick a payment once it's made.
        </p>
        <Button size="sm" variant="outline" onClick={p.addLoan}><Plus className="h-3.5 w-3.5 mr-1" /> Add loan</Button>
      </div>
      {loans.map(l => <LoanCard key={l.id} loan={l} {...p} />)}
    </div>
  );
}

function LoanCard({ loan: l, payments, orders, odooOrders, updateLoan, removeLoan, addPayment, updatePayment, removePayment }: Props & { loan: LoanRow }) {
  const mine = payments.filter(x => x.loan_id === l.id);
  const [open, setOpen] = useState(false);
  const next = mine.find(x => !x.paid);
  const when = l.kind === 'lump' ? lumpLoanMonth(l, orders, odooOrders) : null;
  return (
    <Card className={cn(!l.active && 'opacity-60')}>
      <CardHeader className="pb-2 space-y-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TextField className="font-medium max-w-xs" label="Loan name" value={l.name} onSave={v => updateLoan(l.id, { name: v })} />
          <SelectField label="Loan type" value={l.kind} options={[{ value: 'lump', label: 'One payment' }, { value: 'schedule', label: 'Payment schedule' }]} onSave={v => updateLoan(l.id, { kind: v })} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
            <Switch checked={l.active} onCheckedChange={v => updateLoan(l.id, { active: v })} /> In forecast
          </label>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete loan"
            onClick={() => { if (confirm(`Delete ${l.name || 'this loan'} and its payments?`)) removeLoan(l.id); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 items-end text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{l.kind === 'lump' ? 'Amount owed' : 'Balance today'}</span>
            <NumField label="Balance" value={l.balance_usd} onSave={v => updateLoan(l.id, { balance_usd: v ?? 0 })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Interest rate (yearly)</span>
            <NumField label="Rate" value={l.rate_pct} onSave={v => updateLoan(l.id, { rate_pct: v ?? 0 })} />
          </label>
          {l.kind === 'lump' ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Pay back with order</span>
                <SelectField className="w-full" label="Pay back with order"
                  value={l.pay_with_so ? `so:${l.pay_with_so}` : l.pay_with_inquiry_id ? `inq:${l.pay_with_inquiry_id}` : ''}
                  options={[
                    { value: '', label: 'No order, use month' },
                    ...odooOrders.map(o => ({ value: `so:${o.name}`, label: `${o.name}${o.ref ? ` · ${o.ref}` : ''} (Odoo)` })),
                    ...(l.pay_with_so && !odooOrders.some(o => o.name === l.pay_with_so) ? [{ value: `so:${l.pay_with_so}`, label: `${l.pay_with_so} (not open in Odoo)` }] : []),
                    ...orders.map(o => ({ value: `inq:${o.inquiry_id}`, label: `${o.rfq_number}${o.customer ? ` · ${o.customer}` : ''}` })),
                  ]}
                  onSave={v => updateLoan(l.id, { pay_with_so: v.startsWith('so:') ? v.slice(3) : null, pay_with_inquiry_id: v.startsWith('inq:') ? v.slice(4) : null })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">{(l.pay_with_inquiry_id || l.pay_with_so) ? 'Paid in (from the order)' : 'Pay back in'}</span>
                {(l.pay_with_inquiry_id || l.pay_with_so)
                  ? <div className="h-8 flex items-center font-medium">{when ? monthLabel(when) : 'order not open'}</div>
                  : <MonthField label="Pay back in" allowEmpty value={l.due_month} onSave={v => updateLoan(l.id, { due_month: v })} />}
              </label>
            </>
          ) : (
            <div className="col-span-2 text-muted-foreground">
              {next ? <>Next payment <span className="text-foreground font-medium">{usd(next.principal_usd + next.interest_usd)}</span> on {next.due_date}</> : 'No unpaid payments.'}
            </div>
          )}
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 items-end text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground" title="For a loan you haven't received yet: what lands in DKT's account, after fees">Money still to receive</span>
            <NumField label="Money still to receive" allowEmpty placeholder="Already received" value={l.proceeds_usd ?? null} onSave={v => updateLoan(l.id, { proceeds_usd: v })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Arrives in</span>
            <MonthField label="Arrives in" allowEmpty value={l.proceeds_month ?? null} onSave={v => updateLoan(l.id, { proceeds_month: v })} />
          </label>
        </div>
        <TextField label="Notes" placeholder="Notes" value={l.notes} onSave={v => updateLoan(l.id, { notes: v || null })} className="text-xs" />
        {l.kind === 'lump' && !when && l.active && <p className="text-xs text-warning">No repayment month yet, so this loan isn't in the forecast.</p>}
        {l.kind === 'schedule' && (
          <div>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => setOpen(o => !o)}>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
              Payment schedule ({mine.filter(x => !x.paid).length} unpaid of {mine.length})
            </button>
            {open && (
              <div className="mt-2 overflow-x-auto">
                <table className="text-xs">
                  <thead className="text-muted-foreground text-left">
                    <tr><th className="font-medium py-1 pr-2">Due</th><th className="font-medium px-1 text-right">Principal</th><th className="font-medium px-1 text-right">Interest</th><th className="font-medium px-1 text-right">Total</th><th className="font-medium px-2">Paid</th><th /></tr>
                  </thead>
                  <tbody>
                    {mine.map(x => (
                      <tr key={x.id} className={cn('border-t', x.paid && 'text-muted-foreground')}>
                        <td className="py-1 pr-2">
                          <input type="date" aria-label="Due date" className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={x.due_date}
                            onChange={e => e.target.value && updatePayment(x.id, { due_date: e.target.value })} />
                        </td>
                        <td className="py-1 px-1 w-28"><NumField label="Principal" value={x.principal_usd} onSave={v => updatePayment(x.id, { principal_usd: v ?? 0 })} /></td>
                        <td className="py-1 px-1 w-28"><NumField label="Interest" value={x.interest_usd} onSave={v => updatePayment(x.id, { interest_usd: v ?? 0 })} /></td>
                        <td className="py-1 px-1 text-right tabular-nums">{usd(x.principal_usd + x.interest_usd)}</td>
                        <td className="py-1 px-2"><Checkbox checked={x.paid} onCheckedChange={v => updatePayment(x.id, { paid: !!v })} /></td>
                        <td className="py-1"><Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete payment" onClick={() => removePayment(x.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button size="sm" variant="ghost" className="mt-1" onClick={() => addPayment(l.id)}><Plus className="h-3.5 w-3.5 mr-1" /> Add payment</Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
