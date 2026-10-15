import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { statusLabel } from '@/lib/inquiry-status';
import { cn } from '@/lib/utils';
import { orderAmounts, type DktOrder, type DktSettings } from '@/lib/dkt-cashflow';
import type { OrderMeta } from '@/hooks/use-dkt-cashflow';
import { MonthField, NumField, Stat, usd } from './fields';

type Props = {
  orders: DktOrder[];
  meta: Record<string, OrderMeta>;
  settings: DktSettings;
  dktEntityName: string | null;
  saveOrder: (id: string, p: Partial<DktOrder>) => void;
  saveStatus: (id: string, p: Partial<DktOrder['done']> & { excluded?: boolean }) => void;
  saveSettings: (p: Partial<DktSettings>) => void;
};

const DONE: { key: keyof DktOrder['done']; label: string; short: string }[] = [
  { key: 'cust_deposit', label: 'Customer deposit received', short: 'Cust. dep.' },
  { key: 'advance', label: 'Advance paid to PV', short: 'PV adv.' },
  { key: 'cust_balance', label: 'Customer balance received', short: 'Cust. bal.' },
  { key: 'pv_balance', label: 'Balance paid to PV', short: 'PV bal.' },
];

export function OrdersTab({ orders, meta, settings, dktEntityName, saveOrder, saveStatus, saveSettings }: Props) {
  const live = orders.filter(o => !o.excluded);
  const sum = (f: (a: ReturnType<typeof orderAmounts>) => number) => live.reduce((s, o) => s + f(orderAmounts(o)), 0);
  const gapOpen = live.filter(o => !o.done.advance).reduce((s, o) => s + orderAmounts(o).gap, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Open DKT orders" value={live.length} sub={`FOB ${usd(live.reduce((s, o) => s + o.fob_usd, 0))}`} />
        <Stat label="DKT margin on them" value={usd(sum(a => a.margin))} />
        <Stat label="Still to advance PV" value={usd(live.filter(o => !o.done.advance).reduce((s, o) => s + orderAmounts(o).pvAdvance, 0))} />
        <Stat label="Working capital DKT funds" value={usd(gapOpen)} sub="Advances not covered by deposits" tone={gapOpen > 0 ? 'warning' : undefined} />
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-start justify-between gap-4 space-y-0 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-sm">Orders sold through {dktEntityName ?? 'DKT'}</CardTitle>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Every open inquiry (Active, Projected PO, PO) whose selling entity is {dktEntityName ?? 'DKT'}, counted at 100%.
              The customer deposit and the advance to PV happen in the PO month; the customer balance and PV's balance in the ship month.
              Edits here save to the inquiry's Projection tab, so PV analytics sees the same numbers. Tick a payment once it has happened: it is then in your current cash and leaves the forecast.
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
                  <th className="font-medium py-1.5 px-1">Already happened</th>
                  <th className="font-medium py-1.5 pl-1 text-center">Count</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const a = orderAmounts(o);
                  const m = meta[o.inquiry_id];
                  return (
                    <tr key={o.inquiry_id} className={cn('border-t align-top', o.excluded && 'opacity-50')}>
                      <td className="py-2 pr-2 min-w-[11rem]">
                        <Link to={`/inquiry/${o.inquiry_id}`} className="font-mono font-medium hover:underline">{o.rfq_number}</Link>
                        <div className="text-muted-foreground truncate max-w-[14rem]">{o.customer ?? o.title ?? ''}</div>
                        <Badge variant="outline" className="mt-0.5 h-4 text-[10px]">{statusLabel(o.status)}</Badge>
                      </td>
                      <td className="py-2 px-1 w-28">
                        <NumField label="FOB" value={Math.round(o.fob_usd)} onSave={v => saveOrder(o.inquiry_id, { fob_usd: v ?? 0 })} />
                        {o.fob_source === 'live' && <div className="text-[10px] text-muted-foreground text-right mt-0.5">from costing</div>}
                      </td>
                      <td className="py-2 px-1 w-20">
                        <NumField percent label="DKT margin" value={o.margin_pct} onSave={v => saveOrder(o.inquiry_id, { margin_pct: v ?? 0 })} />
                        <div className="text-[10px] text-muted-foreground text-right mt-0.5">{m?.margin_set ? usd(a.margin) : 'default'}</div>
                      </td>
                      <td className="py-2 px-1 w-20">
                        <NumField percent label="Customer deposit" value={o.cust_deposit_pct} onSave={v => saveOrder(o.inquiry_id, { cust_deposit_pct: v ?? 0 })} />
                        <div className="text-[10px] text-muted-foreground text-right mt-0.5">{usd(a.custDeposit)}</div>
                      </td>
                      <td className="py-2 px-1 w-20">
                        <NumField percent label="Advance to PV" value={o.advance_pct} onSave={v => saveOrder(o.inquiry_id, { advance_pct: v ?? 0 })} />
                        <div className="text-[10px] text-muted-foreground text-right mt-0.5">{usd(a.pvAdvance)}</div>
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
                      <td className="py-2 px-1">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                          {DONE.map(d => (
                            <label key={d.key} className="flex items-center gap-1.5 whitespace-nowrap cursor-pointer" title={d.label}>
                              <Checkbox checked={o.done[d.key]} onCheckedChange={v => saveStatus(o.inquiry_id, { [d.key]: !!v })} />
                              <span className={cn(o.done[d.key] && 'line-through text-muted-foreground')}>{d.short}</span>
                            </label>
                          ))}
                        </div>
                      </td>
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
