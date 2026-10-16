import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { statusLabel } from '@/lib/inquiry-status';
import { cn } from '@/lib/utils';
import { odooFob, odooOwed, orderAmounts, type DktOrder, type DktSettings } from '@/lib/dkt-cashflow';
import { TERM_KEYS, type OdooRow, type OdooShare, type OrderMeta, type TermKey } from '@/hooks/use-dkt-cashflow';
import { MonthField, NumField, Stat, usd } from './fields';
import type { ReactNode } from 'react';

type Props = {
  orders: DktOrder[];
  odooRows: OdooRow[];
  share: OdooShare | null;
  meta: Record<string, OrderMeta>;
  settings: DktSettings;
  dktEntityName: string | null;
  saveOrder: (id: string, p: Partial<DktOrder>) => void;
  saveTermsToInquiry: (id: string) => void;
  saveStatus: (id: string, p: Partial<DktOrder['done']> & { excluded?: boolean }) => void;
  saveSettings: (p: Partial<DktSettings>) => void;
  odooCard: ReactNode;
};

export function OrdersTab({ orders, odooRows, share, meta, settings, dktEntityName, saveOrder, saveTermsToInquiry, saveStatus, saveSettings, odooCard }: Props) {
  const live = orders.filter(o => !o.excluded);
  const sum = (f: (a: ReturnType<typeof orderAmounts>) => number) => live.reduce((s, o) => s + f(orderAmounts(o)), 0);
  const real = odooRows.filter(o => !o.excluded);
  const realFob = real.reduce((s, o) => s + odooFob(o), 0);
  const realMargin = real.reduce((s, o) => s + odooFob(o) - o.pv_total_usd, 0);
  const stillToPv = real.reduce((s, o) => s + odooOwed(o, o.invoices), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders (confirmed + pipeline)" value={real.length + live.length}
          sub={`${real.length} confirmed · ${live.length} pipeline · FOB ${usd(realFob + live.reduce((s, o) => s + o.fob_usd, 0))}`} />
        <Stat label="DKT margin on them" value={usd(realMargin + sum(a => a.margin))} />
        <Stat label="Still to pay PV (confirmed orders)" value={usd(stillToPv)} sub="From Odoo" />
        <Stat label="PV sales to DKT, last 12 months"
          value={share && share.total_usd > 0 ? `${Math.round((share.dkt_usd / share.total_usd) * 100)}%` : '–'}
          sub={share && share.total_usd > 0
            ? `${usd(share.dkt_usd)} DKT · ${usd(share.total_usd - share.dkt_usd)} others (${Math.round(100 - (share.dkt_usd / share.total_usd) * 100)}%), invoiced`
            : 'From PV invoices in Odoo'} />
      </div>

      {share?.invoices?.length ? (
        <details className="rounded-md border px-3 py-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">PV invoices behind the DKT share ({share.invoices.length}, since {share.since}, before tax, credit notes negative)</summary>
          <div className="grid gap-4 md:grid-cols-2 mt-2">
            {[true, false].map(isDkt => {
              const list = share.invoices!.filter(i => i.dkt === isDkt);
              return (
                <div key={String(isDkt)}>
                  <div className="font-medium mb-1">{isDkt ? 'To DKT' : 'To other customers'} · {usd(list.reduce((s, i) => s + i.amount_usd, 0))}</div>
                  <table className="w-full">
                    <tbody>
                      {list.map(i => (
                        <tr key={i.name} className="border-t">
                          <td className="py-1 pr-2 font-mono whitespace-nowrap">{i.name}</td>
                          <td className="py-1 pr-2 text-muted-foreground truncate max-w-[12rem]">{isDkt ? i.origin : i.partner}</td>
                          <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{i.date}</td>
                          <td className="py-1 text-right tabular-nums">{usd(i.amount_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      {odooCard}

      <Card>
        <CardHeader className="pb-2 flex-row items-start justify-between gap-4 space-y-0 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-sm">Pipeline in HQ, not yet confirmed ({dktEntityName ?? 'DKT'} sells)</CardTitle>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Every Active or Projected PO inquiry whose selling entity is {dktEntityName ?? 'DKT'}, counted at 100%. Once it's a PO it shows above from Odoo instead, so it's never counted twice.
              The customer deposit and the advance to PV happen in the PO month; the customer balance and PV's balance in the ship month.
              DKT margin, customer deposit and advance to PV come from the inquiry's Projection tab; changing them here only changes the cash flow until you press Save to inquiry. FOB and months save straight to the inquiry.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Default DKT margin</span>
            <NumField className="w-20" percent label="Default DKT margin" value={settings.default_margin_pct} onSave={v => saveSettings({ default_margin_pct: v ?? 0 })} />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!orders.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No open inquiries have {dktEntityName ?? 'DKT'} as their selling entity yet. Set it on an inquiry's Projection tab.
            </p>
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
                  <th className="font-medium py-1.5 px-1 text-right" title="Advance minus customer deposit: what DKT carries until shipping">DKT funds</th>
                  <th className="font-medium py-1.5 pl-1 text-center">Count</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const a = orderAmounts(o);
                  const m = meta[o.inquiry_id];
                  const differs = (k: TermKey) => !!m && Math.abs(o[k] - m.inquiry[k]) > 1e-9;
                  const changed = TERM_KEYS.some(differs);
                  const note = (k: TermKey, amount: string, fallback?: string) => differs(k)
                    ? <div className="text-[10px] text-warning text-right mt-0.5" title="What the inquiry's Projection tab has">inquiry {Math.round(m!.inquiry[k] * 1000) / 10}%</div>
                    : <div className="text-[10px] text-muted-foreground text-right mt-0.5">{fallback ?? amount}</div>;
                  return (
                    <tr key={o.inquiry_id} className={cn('border-t align-top', o.excluded && 'opacity-50')}>
                      <td className="py-2 pr-2 min-w-[11rem]">
                        <Link to={`/inquiry/${o.inquiry_id}`} className="font-mono font-medium hover:underline">{o.rfq_number}</Link>
                        <div className="text-muted-foreground truncate max-w-[14rem]">{o.customer ?? o.title ?? ''}</div>
                        <Badge variant="outline" className="mt-0.5 h-4 text-[10px]">{statusLabel(o.status)}</Badge>
                        {changed && (
                          <Button size="sm" variant="outline" className="mt-1 h-6 px-2 text-[11px] block" onClick={() => saveTermsToInquiry(o.inquiry_id)}
                            title="Write this margin, customer deposit and advance into the inquiry's Projection tab">
                            Save to inquiry
                          </Button>
                        )}
                      </td>
                      <td className="py-2 px-1 w-28">
                        <NumField label="FOB" value={Math.round(o.fob_usd)} onSave={v => saveOrder(o.inquiry_id, { fob_usd: v ?? 0 })} />
                        {o.fob_source === 'live' && <div className="text-[10px] text-muted-foreground text-right mt-0.5">from costing</div>}
                      </td>
                      <td className="py-2 px-1 w-20">
                        <NumField percent label="DKT margin" value={o.margin_pct} onSave={v => saveOrder(o.inquiry_id, { margin_pct: v ?? 0 })} />
                        {note('margin_pct', usd(a.margin), m?.margin_set ? undefined : 'default')}
                      </td>
                      <td className="py-2 px-1 w-20">
                        <NumField percent label="Customer deposit" value={o.cust_deposit_pct} onSave={v => saveOrder(o.inquiry_id, { cust_deposit_pct: v ?? 0 })} />
                        {note('cust_deposit_pct', usd(a.custDeposit))}
                      </td>
                      <td className="py-2 px-1 w-20">
                        <NumField percent label="Advance to PV" value={o.advance_pct} onSave={v => saveOrder(o.inquiry_id, { advance_pct: v ?? 0 })} />
                        {note('advance_pct', usd(a.pvAdvance))}
                      </td>
                      <td className="py-2 px-1">
                        <MonthField label="PO month" value={o.po_month} onSave={v => v && saveOrder(o.inquiry_id, { po_month: v, ...(o.ship_month < v ? { ship_month: v } : {}) })} />
                        {!m?.po_month_set && <div className="text-[10px] text-warning mt-0.5">not set, using this month</div>}
                      </td>
                      <td className="py-2 px-1">
                        <MonthField label="Ship month" value={o.ship_month} onSave={v => v && saveOrder(o.inquiry_id, { ship_month: v < o.po_month ? o.po_month : v })} />
                        {!m?.ship_month_set && <div className="text-[10px] text-muted-foreground mt-0.5">estimated</div>}
                      </td>
                      <td className={cn('py-2 px-1 text-right tabular-nums font-medium pt-3.5', a.gap > 0 && 'text-warning')}>{usd(a.gap)}</td>
                      <td className="py-2 pl-1 text-center pt-3">
                        <Checkbox aria-label="Count this order" checked={!o.excluded} onCheckedChange={v => saveStatus(o.inquiry_id, { excluded: !v })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
