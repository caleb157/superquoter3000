import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { fmt } from '@/lib/formatters';
import { projectCashflow, groupCashflowByWeek, type PoInquiryForForecast } from '@/lib/analytics-helpers';

export function CashflowForecastCard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PoInquiryForForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: inqs } = await (supabase as any)
        .from('customer_rfqs')
        .select('id, rfq_number, po_received_date, po_total_value_usd, payment_terms_deposit_pct, payment_terms_deposit_due_days, payment_terms_balance_due_days, customer_id')
        .eq('status', 'po')
        .not('po_received_date', 'is', null)
        .not('po_total_value_usd', 'is', null);
      const list = (inqs ?? []) as any[];
      const custIds = Array.from(new Set(list.map(x => x.customer_id).filter(Boolean)));
      const custMap: Record<string, string> = {};
      if (custIds.length) {
        const { data: cs } = await (supabase as any).from('customers').select('id, name, company').in('id', custIds);
        (cs ?? []).forEach((c: any) => { custMap[c.id] = c.name || c.company || '—'; });
      }
      setRows(list.map(x => ({
        id: x.id,
        rfq_number: x.rfq_number,
        customer_name: x.customer_id ? (custMap[x.customer_id] ?? '—') : '—',
        po_received_date: x.po_received_date,
        po_total_value_usd: x.po_total_value_usd == null ? null : Number(x.po_total_value_usd),
        payment_terms_deposit_pct: x.payment_terms_deposit_pct == null ? null : Number(x.payment_terms_deposit_pct),
        payment_terms_deposit_due_days: x.payment_terms_deposit_due_days,
        payment_terms_balance_due_days: x.payment_terms_balance_due_days,
      })));
      setLoading(false);
    })();
  }, []);

  const items = useMemo(() => projectCashflow(rows, 90), [rows]);
  const weekly = useMemo(() => groupCashflowByWeek(items), [items]);

  const sumWithin = (days: number) => {
    const cutoff = new Date(Date.now() + days * 86400000);
    return items.filter(i => i.expected_date <= cutoff).reduce((s, i) => s + i.amount_usd, 0);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Cashflow Forecast — Next 90 Days</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Looks ahead 90 days from today, regardless of selected period.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-6">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            No cashflow data yet. Fill in PO date and value on PO-status inquiries to project receipts.
            <div className="mt-2">
              <Button variant="link" size="sm" onClick={() => navigate('/inquiries?status=po')}>
                Open PO inquiries
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[{ d: 30, l: 'Next 30 Days' }, { d: 60, l: 'Next 60 Days' }, { d: 90, l: 'Next 90 Days' }].map(s => (
                <div key={s.d} className="rounded-md border p-3">
                  <div className="text-[11px] text-muted-foreground">{s.l}</div>
                  <div className="text-base font-medium tabular-nums">{fmt.usd(sumWithin(s.d))}</div>
                </div>
              ))}
            </div>

            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value: number) => fmt.usd(value)}
                    labelFormatter={(l) => `Week of ${l}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="balance" stackId="a" name="Balance" fill="hsl(var(--primary))" />
                  <Bar dataKey="deposit" stackId="a" name="Deposit" fill="hsl(var(--primary) / 0.5)" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div>
              <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => setExpanded(e => !e)}>
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                View {items.length} expected payment{items.length === 1 ? '' : 's'}
              </Button>
              {expanded && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-xs">Date</TableHead>
                      <TableHead className="h-8 text-xs">Inquiry</TableHead>
                      <TableHead className="h-8 text-xs">Customer</TableHead>
                      <TableHead className="h-8 text-xs">Kind</TableHead>
                      <TableHead className="h-8 text-xs text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-2 text-xs tabular-nums">
                          {it.expected_date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </TableCell>
                        <TableCell className="py-2 text-xs">
                          <button
                            className="text-primary hover:underline font-mono"
                            onClick={() => navigate(`/inquiry/${it.inquiry_id}`)}
                          >
                            {it.inquiry_number}
                          </button>
                        </TableCell>
                        <TableCell className="py-2 text-xs">{it.customer_name}</TableCell>
                        <TableCell className="py-2 text-xs">
                          <Badge variant="outline" className="capitalize text-[10px]">{it.kind}</Badge>
                        </TableCell>
                        <TableCell className="py-2 text-xs text-right tabular-nums">{fmt.usd(it.amount_usd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
