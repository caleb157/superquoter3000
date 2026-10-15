import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { monthLabel, odooCustPaid, odooFob, odooOwed, odooPaid, type Month, type OdooInvoice } from '@/lib/dkt-cashflow';
import type { OdooRow, OdooTerms } from '@/hooks/use-dkt-cashflow';
import { NumField, usd } from './fields';

type Props = {
  rows: OdooRow[];
  invoices: OdooInvoice[];
  partner: string | null;
  loading: boolean;
  error: string | null;
  thisMonth: Month;
  reload: () => void;
  save: (soName: string, p: Partial<Omit<OdooTerms, 'so_name'>>) => void;
};

/** Confirmed PV → DKT sales orders and PV's unpaid invoices to DKT, live from Odoo. */
export function OdooOrdersCard({ rows, invoices, partner, loading, error, thisMonth, reload, save }: Props) {
  const linked = new Set(rows.flatMap(r => r.invoices.map(i => i.name)));
  const loose = invoices.filter(i => !linked.has(i.name) && i.residual_usd > 0);
  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-start justify-between gap-4 space-y-0 flex-wrap">
        <div className="space-y-1">
          <CardTitle className="text-sm">Confirmed orders in Odoo (PV → {partner || 'DKT'})</CardTitle>
          <p className="text-xs text-muted-foreground max-w-3xl">
            PV's confirmed sales orders to DKT, read live from Odoo. Paid to PV and the ship month come straight from PV's Odoo (DKT's
            advances applied to the earliest orders first, dated as in PV's cash flow); what's still owed is paid as invoices fall due,
            the rest in the ship month. DKT margin, the customer deposit % and what the customer has paid are typed here: the deposit is
            due now, the rest in the ship month. Orders drop off once PV is fully invoiced and paid.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reload} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} /> Refresh from Odoo
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto space-y-3">
        {error && <p className="text-xs text-destructive">Odoo: {error}</p>}
        {loading && !rows.length && <p className="text-xs text-muted-foreground">Loading from Odoo…</p>}
        {!loading && !error && !rows.length && <p className="text-xs text-muted-foreground">No open PV sales orders to DKT in Odoo.</p>}
        {rows.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="font-medium py-1.5 pr-2">Sales order</th>
                <th className="font-medium px-1 text-right">PV order total</th>
                <th className="font-medium px-1 text-right" title="Everything DKT has paid PV on this order, from Odoo">Paid to PV</th>
                <th className="font-medium px-1 text-right">Still owed to PV</th>
                <th className="font-medium px-1">Ship month</th>
                <th className="font-medium px-1 text-right" title="DKT keeps this share of what the customer pays">DKT margin</th>
                <th className="font-medium px-1 text-right">Cust. deposit</th>
                <th className="font-medium px-1 text-right">Customer paid</th>
                <th className="font-medium pl-1 text-center">Count</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(o => {
                const fob = odooFob(o);
                const owed = odooOwed(o, o.invoices);
                const paid = odooPaid(o, o.invoices);
                const custPaid = odooCustPaid(o);
                const custDue = Math.max(0, fob - custPaid);
                const next = [...o.invoices].filter(i => i.residual_usd > 0).sort((a, b) => a.due_month.localeCompare(b.due_month))[0];
                return (
                  <tr key={o.name} className={cn('border-t align-top', o.excluded && 'opacity-50')}>
                    <td className="py-2 pr-2 min-w-[9rem]">
                      <div className="font-mono font-medium">{o.name}</div>
                      <div className="text-muted-foreground truncate max-w-[14rem]">{o.ref || `Ordered ${monthLabel(o.po_month)}`}</div>
                    </td>
                    <td className="py-2 px-1 text-right tabular-nums pt-3">{usd(o.pv_total_usd)}</td>
                    <td className="py-2 px-1 text-right tabular-nums pt-3">{usd(paid)}</td>
                    <td className="py-2 px-1 text-right tabular-nums pt-3">
                      <span className={cn(owed <= 0.5 && 'text-success')}>{owed > 0.5 ? usd(owed) : 'paid'}</span>
                      {owed > 0.5 && (
                        <div className={cn('text-[10px] mt-0.5', next && next.due_month < thisMonth ? 'text-destructive' : 'text-muted-foreground')}>
                          {next ? (next.due_month < thisMonth ? 'invoice overdue' : `invoice due ${monthLabel(next.due_month)}`) : `in ${monthLabel(o.ship_month)}`}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-1 pt-3 whitespace-nowrap">
                      {monthLabel(o.ship_month)}
                      {!o.ship_month_set && <div className="text-[10px] text-muted-foreground mt-0.5">no date in Odoo</div>}
                    </td>
                    <td className="py-2 px-1 w-20">
                      <NumField percent label="DKT margin" value={o.margin_pct} onSave={v => save(o.name, { margin_pct: v })} allowEmpty />
                      <div className="text-[10px] text-muted-foreground text-right mt-0.5">customer {usd(fob)}</div>
                    </td>
                    <td className="py-2 px-1 w-20">
                      <NumField percent label="Customer deposit" value={o.cust_deposit_pct} onSave={v => save(o.name, { cust_deposit_pct: v })} allowEmpty />
                      <div className="text-[10px] text-muted-foreground text-right mt-0.5">{usd(fob * o.cust_deposit_pct)}</div>
                    </td>
                    <td className="py-2 px-1 w-28">
                      <NumField label="Customer paid" value={o.cust_paid_usd ?? null} placeholder={usd(custPaid)} onSave={v => save(o.name, { cust_paid_usd: v })} allowEmpty />
                      <div className="text-[10px] text-muted-foreground text-right mt-0.5">{custDue > 0.5 ? `${usd(custDue)} to come` : 'paid in full'}</div>
                    </td>
                    <td className="py-2 pl-1 text-center pt-3">
                      <Checkbox aria-label="Count this order" checked={!o.excluded} onCheckedChange={v => save(o.name, { excluded: !v })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {loose.length > 0 && (
          <div className="text-xs">
            <div className="text-muted-foreground mb-1">Other unpaid PV invoices to DKT (no open order)</div>
            {loose.map(i => (
              <div key={i.name} className="flex justify-between gap-3 border-t py-1">
                <span className="font-mono">{i.name}{i.origin ? <span className="text-muted-foreground font-sans"> · {i.origin}</span> : null}</span>
                <span className="tabular-nums">{usd(i.residual_usd)} <span className={cn('text-[10px]', i.due_month < thisMonth ? 'text-destructive' : 'text-muted-foreground')}>{i.due_month < thisMonth ? 'overdue' : `due ${monthLabel(i.due_month)}`}</span></span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
