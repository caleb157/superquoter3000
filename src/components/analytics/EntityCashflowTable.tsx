import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { computeInquiryFinancials } from '@/lib/inquiry-financials';
import {
  computeEntityCashflow,
  type CashflowInquiry,
  type EntityCashflow,
} from '@/lib/entity-cashflow';

type Props = {
  entityId: string;
  entityName: string;
};

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function fmtUsd(n: number, opts?: { paren?: boolean }): string {
  if (!n || Math.abs(n) < 0.5) return '—';
  if (opts?.paren && n < 0) return `(${usdFmt.format(Math.abs(n))})`;
  return usdFmt.format(n);
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function monthIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function monthLabel(iso: string): string {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return format(d, "MMM ''yy").toUpperCase();
}

export function EntityCashflowTable({ entityId, entityName }: Props) {
  const [params, setParams] = useSearchParams();

  const startParam = params.get('p_start');
  const monthsParam = params.get('p_months');
  const basisParam = params.get('p_basis'); // 'committed' | 'expected'

  const startDate = useMemo(() => {
    if (startParam) {
      const d = new Date(startParam);
      if (!isNaN(d.getTime())) return monthStart(d);
    }
    return monthStart(new Date());
  }, [startParam]);
  const monthsCount = Number(monthsParam) || 6;
  const basis: 'committed' | 'expected' =
    basisParam === 'committed' ? 'committed' : 'expected';
  const weighted = basis === 'expected';

  const months = useMemo(
    () =>
      Array.from({ length: monthsCount }, (_, i) => monthIso(addMonths(startDate, i))),
    [startDate, monthsCount],
  );

  const [inquiries, setInquiries] = useState<CashflowInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const setUrl = (next: Record<string, string | null>) => {
    const np = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => {
      if (v == null) np.delete(k);
      else np.set(k, v);
    });
    setParams(np, { replace: true });
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('customer_rfqs')
      .select(
        `id, rfq_number, title, status,
         inquiry_projections ( * ),
         products ( id, quantity, design_stage, quote_stage, sample_stage, calculated_unit_price_usd, calculated_unit_cost_usd )`,
      )
      .in('status', ['active', 'projected_po', 'po']);
    if (error) {
      setInquiries([]);
      setLoading(false);
      return;
    }

    const allProductIds: string[] = [];
    (data || []).forEach((r: any) => (r.products || []).forEach((p: any) => allProductIds.push(p.id)));
    const priceMap = allProductIds.length ? await computeProductPriceAndCost(allProductIds) : {};

    const mapped: CashflowInquiry[] = (data || []).map((r: any) => {
      const proj = Array.isArray(r.inquiry_projections)
        ? r.inquiry_projections[0]
        : r.inquiry_projections;
      const fin = computeInquiryFinancials(r.products || [], priceMap);
      return {
        id: r.id,
        title: r.title || '',
        rfqNumber: r.rfq_number,
        status: r.status,
        projection: proj ?? null,
        products: r.products || [],
        liveFobUsd: fin.fobRevenueUsd,
        liveGpm: fin.gpm,
        liveTotalCostUsd: fin.totalCostUsd,
      };
    });
    setInquiries(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const cashflow: EntityCashflow = useMemo(
    () => computeEntityCashflow(entityId, inquiries, months, weighted),
    [entityId, inquiries, months, weighted],
  );

  // Mobile fallback — Net + Cumulative per month
  const mobile = (
    <div className="md:hidden space-y-2">
      <div className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
        Cashflow table is desktop-only. Summary by month:
      </div>
      {months.map((m) => {
        const net = cashflow.rows.find((r) => r.kind === 'net')?.byMonth[m] || 0;
        const cum = cashflow.rows.find((r) => r.kind === 'cumulative')?.byMonth[m] || 0;
        return (
          <div key={m} className="flex justify-between items-center rounded-md border px-3 py-2 text-sm">
            <span className="font-medium">{monthLabel(m)}</span>
            <div className="flex gap-4 tabular-nums">
              <span>Net: <span className={cn(net < 0 && 'text-destructive')}>{fmtUsd(net, { paren: true })}</span></span>
              <span>Cum: <span className={cn(cum < 0 && 'text-destructive font-semibold')}>{fmtUsd(cum, { paren: true })}</span></span>
            </div>
          </div>
        );
      })}
    </div>
  );

  const cumRow = cashflow.rows.find((r) => r.kind === 'cumulative');

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon className="h-4 w-4" />
              From: {format(startDate, 'MMM yyyy')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={startDate}
              onSelect={(d) => d && setUrl({ p_start: format(monthStart(d), 'yyyy-MM-dd') })}
              className={cn('p-3 pointer-events-auto')}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        <Select value={String(monthsCount)} onValueChange={(v) => setUrl({ p_months: v })}>
          <SelectTrigger className="w-[130px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6">6 months</SelectItem>
            <SelectItem value="12">12 months</SelectItem>
            <SelectItem value="24">24 months</SelectItem>
          </SelectContent>
        </Select>

        <Select value={basis} onValueChange={(v) => setUrl({ p_basis: v })}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="expected">Expected (×certainty)</SelectItem>
            <SelectItem value="committed">Committed (raw)</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-xs text-muted-foreground ml-2">
          {entityName} cashflow · {basis === 'expected' ? 'certainty-weighted' : 'unweighted'}
        </div>
      </div>

      {mobile}

      <div className="hidden md:block rounded-md border bg-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading…</div>
        ) : cashflow.rows.length <= 2 ? (
          <div className="p-8 text-sm text-muted-foreground">
            No cashflow activity for {entityName} in this window.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-30 bg-card border-b">
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 bg-card z-20 text-left px-3 py-2 min-w-[200px]">
                    Category
                  </th>
                  {months.map((m) => (
                    <th key={m} className="text-right px-3 py-2 min-w-[110px]">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cashflow.rows.map((row, idx) => {
                  const isOutflow = row.kind === 'outflow';
                  const isNet = row.kind === 'net';
                  const isCum = row.kind === 'cumulative';
                  const isTotal = row.label === 'Total inflow' || row.label === 'Total outflow';
                  return (
                    <tr
                      key={`${row.label}-${idx}`}
                      className={cn(
                        'border-b hover:bg-muted/30',
                        isTotal && 'font-medium bg-muted/20',
                        isNet && 'font-semibold border-t-2',
                        isCum && 'font-semibold border-t-2 bg-muted/30',
                      )}
                    >
                      <td className="sticky left-0 bg-background z-10 px-3 py-2">
                        {row.label}
                      </td>
                      {months.map((m) => {
                        const v = row.byMonth[m] || 0;
                        const signed = isOutflow ? -v : v;
                        const isNeg = isCum && v < -0.5;
                        return (
                          <td
                            key={m}
                            className={cn(
                              'px-3 py-2 text-right tabular-nums',
                              isOutflow && v > 0 && 'text-destructive',
                              isNeg && 'bg-destructive/10 text-destructive font-semibold',
                            )}
                          >
                            {fmtUsd(signed, { paren: isOutflow || (isCum && v < 0) })}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inquiry contributions disclosure */}
      {cashflow.inquiryContributions.length > 0 && (
        <div className="hidden md:block rounded-md border bg-card">
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/30"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-medium">Per-inquiry contribution</span>
            <span className="text-muted-foreground text-xs">
              ({cashflow.inquiryContributions.length} inquiries)
            </span>
          </button>
          {expanded && (
            <div className="overflow-x-auto border-t">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-card border-b">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="sticky left-0 bg-card text-left px-3 py-2 min-w-[200px]">
                      Inquiry
                    </th>
                    {months.map((m) => (
                      <th key={m} className="text-right px-3 py-2 min-w-[100px]">
                        {monthLabel(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cashflow.inquiryContributions.map((c) => (
                    <tr key={c.inquiryId} className="border-b hover:bg-muted/30">
                      <td className="sticky left-0 bg-background px-3 py-2">
                        <div className="font-medium truncate max-w-[200px]">{c.title}</div>
                        <div className="text-xs text-muted-foreground">{c.rfqNumber}</div>
                      </td>
                      {months.map((m) => {
                        const v = c.net[m] || 0;
                        return (
                          <td
                            key={m}
                            className={cn(
                              'px-3 py-2 text-right tabular-nums',
                              v < -0.5 && 'text-destructive',
                            )}
                          >
                            {fmtUsd(v, { paren: true })}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Cashflow projection from live FOB/GPM and milestone schedule. Cumulative starts at zero each window
        — this is a flow projection, not a real bank balance. Negative cumulative months are flagged.
      </p>
    </div>
  );
}
