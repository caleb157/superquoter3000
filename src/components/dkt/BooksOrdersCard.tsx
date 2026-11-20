// Orders tab → confirmed orders read live from DKT's own Odoo (odoo-dkt-books; math in src/lib/dkt-books.ts).
// Every figure comes from DKT's books; the only choices kept here are leaving an order out and moving its
// ship month. Also the switch between DKT's Odoo and PV's Odoo as the source of confirmed orders.
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { monthLabel, type Month } from '@/lib/dkt-cashflow';
import type { Books, BooksOrder, BooksTerms } from '@/lib/dkt-books';
import { MonthField, usd } from './fields';

export type OrderSource = 'dkt' | 'pv';

export function OrderSourceSwitch({ source, setSource, booksError, booksLoading }: {
  source: OrderSource; setSource: (s: OrderSource) => void;
  booksError: { message: string; notConnected: boolean } | null; booksLoading: boolean;
}) {
  const btn = (s: OrderSource, label: string, disabled = false) => (
    <button type="button" disabled={disabled} onClick={() => setSource(s)}
      className={cn('px-3 py-1 text-xs border-r last:border-r-0 disabled:opacity-50', source === s ? 'bg-foreground text-background' : 'bg-background text-muted-foreground')}>
      {label}
    </button>
  );
  return (
    <div className="rounded-md border px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-muted-foreground">Confirmed orders from</span>
        <div className="inline-flex rounded-md border overflow-hidden">
          {btn('dkt', "DKT's Odoo", !!booksError)}
          {btn('pv', "PV's Odoo")}
        </div>
        {booksLoading && <span className="text-muted-foreground">Loading DKT's Odoo…</span>}
      </div>
      {booksError && (
        <p className={booksError.notConnected ? 'text-muted-foreground' : 'text-destructive'}>
          {booksError.notConnected
            ? "DKT's Odoo isn't connected yet, so PV's Odoo is used. Add DKT_ODOO_URL, DKT_ODOO_DB and DKT_ODOO_API_KEY to the edge-function secrets in Lovable Cloud and deploy odoo-dkt-books."
            : `DKT's Odoo didn't load (${booksError.message}), so PV's Odoo is used for now.`}
        </p>
      )}
      {source === 'pv' && !booksError && <p className="text-muted-foreground">PV's view: what PV bills DKT, with DKT's margin and customer payments typed by hand.</p>}
    </div>
  );
}

const SHIP_NOTE: Record<BooksOrder['shipSource'], string> = {
  order: 'delivery date', pv: "PV's ship date", po: 'PO planned date', guess: 'estimated', typed: 'typed here',
};

export function BooksOrdersCard({ books, terms, thisMonth, loading, reload, save }: {
  books: Books; terms: BooksTerms[]; thisMonth: Month; loading: boolean; reload: () => void;
  save: (soName: string, p: Partial<Omit<BooksTerms, 'so_name'>>) => void;
}) {
  const live = books.orders.filter(o => !o.excluded);
  const custToCome = live.reduce((s, o) => s + o.custOpen.reduce((a, d) => a + d.amount, 0) + o.custUninvoiced, 0);
  const pvToPay = live.reduce((s, o) => s + o.pvOpen.reduce((a, d) => a + d.amount, 0) + o.pvUnbilled, 0);
  const typed = (n: string) => terms.find(t => t.so_name === n)?.ship_month ?? null;
  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-start justify-between gap-4 space-y-0 flex-wrap">
        <div className="space-y-1">
          <CardTitle className="text-sm">Confirmed orders in DKT's Odoo</CardTitle>
          <p className="text-xs text-muted-foreground max-w-3xl">
            DKT's open sales orders, read live from DKT's books, with the purchase orders to PV that name them as their source. Customer price, PV's cost, the margin,
            customer deposits and DKT's advances to PV all come from the books: deposits are applied to that customer's open orders and advances to PV's oldest orders first.
            The customer pays unpaid invoices on their due dates and the rest when the order ships; DKT pays PV's unpaid bills on their due dates and the rest when it ships.
            Unpaid invoices or bills whose order is already fully invoiced still count, on their own lines.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={reload} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1', loading && 'animate-spin')} /> Refresh from DKT's Odoo
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 overflow-x-auto">
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4">
          <span>Customers still to pay DKT <b className="text-foreground">{usd(custToCome)}</b></span>
          <span>DKT still to pay PV <b className="text-foreground">{usd(pvToPay)}</b></span>
          {books.unappliedAdvance > 0.5 && <span>Advance to PV not yet used by an order {usd(books.unappliedAdvance)}</span>}
          {books.unappliedDeposits.length > 0 && <span>Customer money not yet used by an order: {books.unappliedDeposits.map(d => `${d.partner} ${usd(d.usd)}`).join(', ')}</span>}
          {books.fetchedAt && <span>Read {new Date(books.fetchedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
        {!books.orders.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No open orders, unpaid customer invoices or unpaid PV bills in DKT's Odoo.</p>
        ) : (
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="font-medium py-1.5 pr-2">Order</th>
                <th className="font-medium py-1.5 px-1 text-right">Customer price</th>
                <th className="font-medium py-1.5 px-1 text-right" title="Deposits applied and invoices paid">Customer paid</th>
                <th className="font-medium py-1.5 px-1 text-right">Still to come</th>
                <th className="font-medium py-1.5 px-1 text-right" title="DKT's purchase orders to PV for this order">PV cost</th>
                <th className="font-medium py-1.5 px-1 text-right" title="Unpaid PV bills plus PO amounts not billed yet, less DKT's advance">Still owed to PV</th>
                <th className="font-medium py-1.5 px-1 text-right">Margin</th>
                <th className="font-medium py-1.5 px-1">Ship month</th>
                <th className="font-medium py-1.5 pl-1 text-center">Count</th>
              </tr>
            </thead>
            <tbody>
              {books.orders.map(o => {
                const toCome = o.custOpen.reduce((a, d) => a + d.amount, 0) + o.custUninvoiced;
                const toPv = o.pvOpen.reduce((a, d) => a + d.amount, 0) + o.pvUnbilled;
                const overdue = o.custOpen.some(d => d.month <= thisMonth && d.amount > 0.5);
                return (
                  <tr key={o.key} className={cn('border-t align-top', o.excluded && 'opacity-50')}>
                    <td className="py-2 pr-2 min-w-[12rem]">
                      <div className="font-mono font-medium">{o.name}</div>
                      <div className="text-muted-foreground truncate max-w-[16rem]">{o.partner}{o.ref ? ` · ${o.ref}` : ''}</div>
                      {o.kind === 'order' && o.pos.length > 0 && <div className="text-[10px] text-muted-foreground">PV: {o.pos.join(', ')}</div>}
                      {o.kind === 'order' && !o.pos.length && <div className="text-[10px] text-warning">No purchase order to PV linked</div>}
                      {o.kind === 'invoice' && <div className="text-[10px] text-muted-foreground">Unpaid customer invoice{o.ref ? ` for ${o.ref}` : ''}</div>}
                      {o.kind === 'bill' && <div className="text-[10px] text-muted-foreground">Unpaid PV bill{o.ref ? ` for ${o.ref}` : ''}</div>}
                    </td>
                    <td className="py-2 px-1 text-right">{o.custTotal ? usd(o.custTotal) : '–'}</td>
                    <td className="py-2 px-1 text-right">
                      {o.custTotal ? usd(o.custPaid) : '–'}
                      {o.depositApplied > 0.5 && <div className="text-[10px] text-muted-foreground">incl. {usd(o.depositApplied)} deposit</div>}
                    </td>
                    <td className={cn('py-2 px-1 text-right', overdue && 'text-destructive font-medium')}>
                      {toCome > 0.5 ? usd(toCome) : '–'}
                      {o.custOpen.map(d => <div key={d.name} className="text-[10px]">{usd(d.amount)} {d.month <= thisMonth ? 'due now' : `due ${monthLabel(d.month)}`}</div>)}
                      {o.custUninvoiced > 0.5 && o.custOpen.length > 0 && <div className="text-[10px] text-muted-foreground">{usd(o.custUninvoiced)} at shipping</div>}
                    </td>
                    <td className="py-2 px-1 text-right">{o.pvTotal ? usd(o.pvTotal) : '–'}</td>
                    <td className="py-2 px-1 text-right">
                      {toPv > 0.5 ? usd(toPv) : o.pvTotal ? 'paid' : '–'}
                      {o.advanceApplied > 0.5 && <div className="text-[10px] text-muted-foreground">after {usd(o.advanceApplied)} advance</div>}
                      {o.pvOpen.map(d => <div key={d.name} className="text-[10px]">{usd(d.amount)} {d.month <= thisMonth ? 'due now' : `due ${monthLabel(d.month)}`}</div>)}
                    </td>
                    <td className="py-2 px-1 text-right">{o.marginPct == null ? '–' : `${(o.marginPct * 100).toFixed(1)}%`}</td>
                    <td className="py-2 px-1">
                      {o.kind === 'order' ? (
                        <>
                          <MonthField label="Ship month" value={o.shipMonth} onSave={v => save(o.name, { ship_month: v })} />
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {SHIP_NOTE[o.shipSource]}
                            {typed(o.name) && <button type="button" className="ml-1 underline" onClick={() => save(o.name, { ship_month: null })}>use Odoo's</button>}
                          </div>
                        </>
                      ) : <span className="text-muted-foreground">{monthLabel(o.shipMonth)}</span>}
                    </td>
                    <td className="py-2 pl-1 text-center pt-3">
                      <Checkbox aria-label={`Count ${o.name}`} checked={!o.excluded} onCheckedChange={v => save(o.name, { excluded: !v })} />
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
