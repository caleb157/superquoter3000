import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  addMonths as addMonthsStr,
  effectiveCertainty,
  effectiveManHours,
  spreadManHours,
  type InquiryProjection,
} from '@/lib/projections';
import { computeProductPriceAndCost } from '@/lib/product-pricing';

type ProductLite = {
  id: string;
  quantity: number | null;
  design_stage: string | null;
  quote_stage: string | null;
  sample_stage: string | null;
};

type InquiryRow = {
  id: string;
  rfq_number: string;
  title: string | null;
  status: string;
  customer_company: string | null;
  customer_name: string | null;
  projection: Partial<InquiryProjection> | null;
  products: ProductLite[];
  totalMh: number;     // basis-adjusted total
  rawTotalMh: number;  // committed total
};

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function monthLabel(iso: string): string {
  const d = new Date(iso);
  return format(d, "MMM ''yy");
}

// Stable hue from inquiry id
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 55%)`;
}

const STATUSES = ['active', 'projected_po', 'po'];

export function CapacityChart() {
  const navigate = useNavigate();
  const [startMonth, setStartMonth] = useState<Date>(monthStart(new Date()));
  const [windowLen, setWindowLen] = useState<number>(12);
  const [basis, setBasis] = useState<'committed' | 'expected'>('committed');
  const [capacity, setCapacity] = useState<number>(0);
  const [rows, setRows] = useState<InquiryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const months = useMemo(() => {
    return Array.from({ length: windowLen }, (_, i) => {
      const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
      return toIso(d);
    });
  }, [startMonth, windowLen]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [gsRes, inqRes] = await Promise.all([
        supabase
          .from('global_settings')
          .select('total_available_mh_per_month')
          .limit(1)
          .maybeSingle(),
        supabase
          .from('customer_rfqs')
          .select(
            `id, rfq_number, title, status,
             customers:customer_id ( name, company ),
             inquiry_projections ( * ),
             products ( id, quantity, design_stage, quote_stage, sample_stage )`,
          )
          .in('status', STATUSES),
      ]);
      setCapacity(Number((gsRes.data as any)?.total_available_mh_per_month) || 0);

      const data = (inqRes.data || []) as any[];
      const allPids: string[] = [];
      data.forEach((r) => (r.products || []).forEach((p: any) => allPids.push(p.id)));
      const priceMap = allPids.length ? await computeProductPriceAndCost(allPids) : {};

      const mapped: InquiryRow[] = data.map((r) => {
        const proj = Array.isArray(r.inquiry_projections)
          ? r.inquiry_projections[0]
          : r.inquiry_projections;
        const products = (r.products || []) as ProductLite[];
        const productMh = products.map((p) => ({
          product_id: p.id,
          quantity: Number(p.quantity || 0),
          total_mh_per_unit: Number(priceMap[p.id]?.man_hours_per_unit || 0),
        }));
        const rawTotalMh = effectiveManHours(proj ?? null, productMh);
        const cert = effectiveCertainty(proj ?? null, products, r.status);
        const totalMh = basis === 'expected' ? rawTotalMh * cert : rawTotalMh;
        return {
          id: r.id,
          rfq_number: r.rfq_number,
          title: r.title,
          status: r.status,
          customer_company: r.customers?.company ?? null,
          customer_name: r.customers?.name ?? null,
          projection: proj ?? null,
          products,
          rawTotalMh,
          totalMh,
        };
      });
      setRows(mapped);
      setLoading(false);
    })();
  }, [basis]);

  // Compute per-month buckets + per-inquiry contribution
  const { chartData, contributingInquiries } = useMemo(() => {
    const monthSet = new Set(months);
    // Map<month, Map<inquiryId, mh>>
    const buckets = new Map<string, Map<string, number>>();
    months.forEach((m) => buckets.set(m, new Map()));
    const contributing = new Set<string>();

    rows.forEach((r) => {
      if (!r.projection?.start_month || !r.projection?.duration_months) return;
      const spread = spreadManHours(
        r.totalMh,
        r.projection.start_month as any,
        r.projection.duration_months,
      );
      spread.forEach(({ month, mh }) => {
        if (!monthSet.has(month)) return;
        const m = buckets.get(month)!;
        m.set(r.id, (m.get(r.id) || 0) + mh);
        contributing.add(r.id);
      });
    });

    const contribInq = rows.filter((r) => contributing.has(r.id));
    const data = months.map((m) => {
      const row: Record<string, any> = { month: m, label: monthLabel(m) };
      let total = 0;
      contribInq.forEach((inq) => {
        const v = buckets.get(m)!.get(inq.id) || 0;
        row[`inq_${inq.id}`] = v;
        total += v;
      });
      row.total = total;
      row.over = capacity > 0 && total > capacity;
      return row;
    });
    return { chartData: data, contributingInquiries: contribInq };
  }, [rows, months, capacity]);

  const showLegend = contributingInquiries.length > 0 && contributingInquiries.length <= 10;

  // Per-inquiry table data (sorted by start month)
  const tableRows = useMemo(() => {
    const withStart = rows.filter(
      (r) => r.projection?.start_month && r.projection?.duration_months && r.rawTotalMh > 0,
    );
    withStart.sort((a, b) =>
      String(a.projection?.start_month).localeCompare(String(b.projection?.start_month)),
    );
    return withStart;
  }, [rows]);

  const inquiryLabel = (r: InquiryRow) =>
    r.customer_company || r.customer_name || r.title || r.rfq_number;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const monthIso = payload[0]?.payload?.month;
    const total = payload[0]?.payload?.total || 0;
    const segs = payload
      .filter((p: any) => p.dataKey?.toString().startsWith('inq_') && p.value > 0)
      .map((p: any) => {
        const id = p.dataKey.replace('inq_', '');
        const inq = contributingInquiries.find((i) => i.id === id);
        return { name: inq ? inquiryLabel(inq) : id, value: p.value, color: p.color };
      });
    return (
      <div className="rounded-md border bg-popover p-2 text-xs shadow-md max-w-xs">
        <div className="font-medium mb-1">{label}</div>
        <div className="space-y-0.5">
          {segs.map((s: any, i: number) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="flex items-center gap-1.5 truncate">
                <span
                  className="inline-block h-2 w-2 rounded-sm shrink-0"
                  style={{ background: s.color }}
                />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="tabular-nums">{Math.round(s.value)}</span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 pt-1.5 border-t flex justify-between font-medium">
          <span>Total</span>
          <span
            className={cn(
              'tabular-nums',
              capacity > 0 && total > capacity && 'text-destructive',
            )}
          >
            {Math.round(total)} MH
          </span>
        </div>
        {capacity > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Capacity</span>
            <span className="tabular-nums">{Math.round(capacity)} MH</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">Production Capacity</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  From: {format(startMonth, 'MMM yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={startMonth}
                  onSelect={(d) => d && setStartMonth(monthStart(d))}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <Select value={String(windowLen)} onValueChange={(v) => setWindowLen(Number(v))}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 months</SelectItem>
                <SelectItem value="12">12 months</SelectItem>
                <SelectItem value="24">24 months</SelectItem>
              </SelectContent>
            </Select>
            <Select value={basis} onValueChange={(v) => setBasis(v as any)}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="committed">Committed</SelectItem>
                <SelectItem value="expected">Expected (× certainty)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
        ) : contributingInquiries.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center border border-dashed rounded-md">
            No scheduled production in this window. Set a start month and duration on an inquiry's
            projection to see capacity.
          </div>
        ) : (
          <>
            {capacity <= 0 && (
              <div className="text-xs text-muted-foreground rounded-md border border-dashed p-2">
                Set "total available man-hours per month" in Settings to see the capacity reference
                line.
              </div>
            )}
            {/* Desktop chart */}
            <div className="hidden md:block w-full" style={{ height: 380 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
                  {contributingInquiries.map((inq) => (
                    <Bar
                      key={inq.id}
                      dataKey={`inq_${inq.id}`}
                      stackId="mh"
                      name={inquiryLabel(inq)}
                      fill={colorFor(inq.id)}
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const { cx, cy, payload, index } = props;
                      const over = payload?.over;
                      return (
                        <circle
                          key={index}
                          cx={cx}
                          cy={cy}
                          r={4}
                          fill={over ? 'hsl(var(--destructive))' : 'hsl(var(--foreground))'}
                          stroke="hsl(var(--background))"
                          strokeWidth={1.5}
                        />
                      );
                    }}
                  />
                  {capacity > 0 && (
                    <ReferenceLine
                      y={capacity}
                      stroke="hsl(var(--destructive))"
                      strokeDasharray="5 5"
                      label={{
                        value: `Capacity ${Math.round(capacity)}`,
                        position: 'insideTopRight',
                        fontSize: 11,
                        fill: 'hsl(var(--destructive))',
                      }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="md:hidden text-xs text-muted-foreground rounded-md border border-dashed p-3">
              Capacity chart is desktop-only. See the table below for the spread.
            </div>

            {/* Verification table */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inquiry</TableHead>
                    <TableHead className="text-right">Total MH</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Per-month MH</TableHead>
                    <TableHead>Months</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((r) => {
                    const dur = Number(r.projection?.duration_months) || 0;
                    const totalForBasis = r.totalMh;
                    const perMonth = dur > 0 ? totalForBasis / dur : 0;
                    const monthsList: string[] = [];
                    if (r.projection?.start_month && dur > 0) {
                      for (let i = 1; i <= dur; i++) {
                        monthsList.push(
                          monthLabel(addMonthsStr(r.projection.start_month as any, i)),
                        );
                      }
                    }
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/inquiry/${r.id}?tab=projection`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-sm shrink-0"
                              style={{ background: colorFor(r.id) }}
                            />
                            <div>
                              <div className="font-medium text-sm">{inquiryLabel(r)}</div>
                              <div className="text-xs text-muted-foreground">{r.rfq_number}</div>
                            </div>
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              {r.status}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Math.round(totalForBasis)}
                          {basis === 'expected' && r.rawTotalMh !== r.totalMh && (
                            <span className="text-xs text-muted-foreground ml-1">
                              ({Math.round(r.rawTotalMh)})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.projection?.start_month
                            ? monthLabel(r.projection.start_month as any)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{dur}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Math.round(perMonth)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {monthsList.join(', ')}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
