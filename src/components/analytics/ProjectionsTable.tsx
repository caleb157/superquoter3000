import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Plus, CalendarIcon, Check, Sheet as SheetIcon, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  INQUIRY_STATUS_COLORS,
  INQUIRY_STATUS_LABEL,
} from '@/lib/inquiry-status';
import { effectiveCertainty, type InquiryProjection } from '@/lib/projections';
import { NewInquiryDialog } from '@/components/NewInquiryDialog';

type Row = {
  id: string;
  rfq_number: string;
  title: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_company: string | null;
  projection: Partial<InquiryProjection> | null;
  products: Array<{ design_stage: string | null; quote_stage: string | null; sample_stage: string | null }>;
};

const STATUS_FILTERS: Record<string, string[]> = {
  all_forward: ['active', 'projected_po', 'po'],
  active: ['active'],
  projected_po: ['projected_po'],
  po: ['po'],
};

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function fmtUsd(n: number | null | undefined): string {
  if (!n) return '—';
  return usdFmt.format(n);
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function monthLabel(d: Date): string {
  return format(d, "MMM ''yy").toUpperCase();
}

function cashForMonth(
  projection: Partial<InquiryProjection> | null,
  certainty: number,
  mStart: Date,
  mEnd: Date,
): number {
  if (!projection?.projected_fob_revenue_usd) return 0;
  const fob = Number(projection.projected_fob_revenue_usd);
  const milestones = [
    { month: projection.cust_deposit_month, pct: projection.cust_deposit_pct },
    { month: projection.cust_final_month, pct: projection.cust_final_pct },
    { month: projection.cust_other_month, pct: projection.cust_other_pct },
  ];
  let total = 0;
  for (const m of milestones) {
    if (!m.month || !m.pct) continue;
    const d = new Date(m.month as any);
    if (d >= mStart && d < mEnd) total += fob * Number(m.pct) * certainty;
  }
  return total;
}

const EDITABLE_FIELDS = ['certainty_override', 'projected_fob_revenue_usd', 'project_gpm'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

export function ProjectionsTable() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const startParam = params.get('p_start');
  const monthsParam = params.get('p_months');
  const statusParam = params.get('p_status');

  const startMonth = useMemo(() => {
    if (startParam) {
      const d = new Date(startParam);
      if (!isNaN(d.getTime())) return monthStart(d);
    }
    return monthStart(new Date());
  }, [startParam]);

  const monthsCount = Number(monthsParam) || 6;
  const statusKey = statusParam && STATUS_FILTERS[statusParam] ? statusParam : 'all_forward';

  const months = useMemo(
    () => Array.from({ length: monthsCount }, (_, i) => addMonths(startMonth, i)),
    [startMonth, monthsCount],
  );

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null);
  const [editVal, setEditVal] = useState<string>('');

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
    const statuses = STATUS_FILTERS[statusKey];
    const { data, error } = await supabase
      .from('customer_rfqs')
      .select(
        `id, rfq_number, title, status, customer_id,
         customers:customer_id ( id, name, company ),
         inquiry_projections ( * ),
         products ( design_stage, quote_stage, sample_stage )`,
      )
      .in('status', statuses)
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Failed to load projections: ' + error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const mapped: Row[] = (data || []).map((r: any) => {
      const proj = Array.isArray(r.inquiry_projections)
        ? r.inquiry_projections[0]
        : r.inquiry_projections;
      return {
        id: r.id,
        rfq_number: r.rfq_number,
        title: r.title,
        status: r.status,
        customer_id: r.customer_id,
        customer_name: r.customers?.name ?? null,
        customer_company: r.customers?.company ?? null,
        projection: proj ?? null,
        products: r.products ?? [],
      };
    });
    setRows(mapped);
    setLoading(false);
  }, [statusKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const computedRows = useMemo(() => {
    return rows.map((r) => {
      const cert = effectiveCertainty(r.projection as any, r.products, r.status);
      const fob = Number(r.projection?.projected_fob_revenue_usd) || 0;
      const gpm = Number(r.projection?.project_gpm) || 0;
      const expectedRev = fob * cert;
      const expectedGp = fob * gpm * cert;
      const monthCells = months.map((m) => {
        const mEnd = addMonths(m, 1);
        return cashForMonth(r.projection, cert, m, mEnd);
      });
      return { ...r, cert, fob, gpm, expectedRev, expectedGp, monthCells };
    });
  }, [rows, months]);

  const totals = useMemo(() => {
    const fob = computedRows.reduce((a, r) => a + r.fob, 0);
    const expectedRev = computedRows.reduce((a, r) => a + r.expectedRev, 0);
    const expectedGp = computedRows.reduce((a, r) => a + r.expectedGp, 0);
    const perMonth = months.map((_, i) =>
      computedRows.reduce((a, r) => a + (r.monthCells[i] || 0), 0),
    );
    return { fob, expectedRev, expectedGp, perMonth };
  }, [computedRows, months]);

  const startEdit = (id: string, field: EditableField, current: any) => {
    setEditing({ id, field });
    if (field === 'certainty_override' || field === 'project_gpm') {
      setEditVal(current == null ? '' : String(Number(current) * 100));
    } else {
      setEditVal(current == null ? '' : String(current));
    }
  };

  const commitEdit = async () => {
    if (!editing) return;
    const { id, field } = editing;
    const raw = editVal.trim();
    let value: number | null = null;
    if (raw !== '') {
      const n = Number(raw);
      if (isNaN(n)) {
        toast.error('Invalid number');
        setEditing(null);
        return;
      }
      value = field === 'certainty_override' || field === 'project_gpm' ? n / 100 : n;
    }

    // Optimistic update
    const prev = rows;
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? { ...r, projection: { ...(r.projection || {}), [field]: value, inquiry_id: id } as any }
          : r,
      ),
    );
    setEditing(null);

    const { error } = await supabase
      .from('inquiry_projections')
      .upsert({ inquiry_id: id, [field]: value } as any, { onConflict: 'inquiry_id' });
    if (error) {
      toast.error('Save failed: ' + error.message);
      setRows(prev);
    }
  };

  const stickyTh = 'sticky bg-card z-20';
  const stickyTd = 'sticky bg-background z-10';

  const renderEditableCell = (
    rowId: string,
    field: EditableField,
    current: any,
    display: string,
  ) => {
    const isEditing = editing?.id === rowId && editing?.field === field;
    if (isEditing) {
      return (
        <Input
          autoFocus
          type="number"
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(null);
          }}
          className="h-7 text-right tabular-nums px-1"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => startEdit(rowId, field, current)}
        className="w-full text-right tabular-nums hover:bg-muted/50 px-2 py-1 rounded cursor-text"
      >
        {display}
      </button>
    );
  };

  // Mobile view
  const mobile = (
    <div className="md:hidden space-y-3">
      <div className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
        The Projections table is designed for desktop. Tap an inquiry to open its Projection tab.
      </div>
      {computedRows.map((r) => (
        <button
          key={r.id}
          onClick={() => navigate(`/inquiry/${r.id}?tab=projection`)}
          className="w-full text-left rounded-md border p-3 hover:bg-muted/30"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium truncate">
              {r.customer_company || r.customer_name || '—'}
            </div>
            <Badge className={cn('text-xs', INQUIRY_STATUS_COLORS[r.status])}>
              {INQUIRY_STATUS_LABEL[r.status]}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">{r.rfq_number} · {r.title}</div>
          <div className="mt-2 flex justify-between text-sm tabular-nums">
            <span>FOB: {fmtUsd(r.fob)}</span>
            <span>Exp Rev: {fmtUsd(r.expectedRev)}</span>
          </div>
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon className="h-4 w-4" />
              From: {format(startMonth, 'MMM yyyy')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={startMonth}
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

        <Select value={statusKey} onValueChange={(v) => setUrl({ p_status: v })}>
          <SelectTrigger className="w-[170px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all_forward">All forward</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="projected_po">Projected POs only</SelectItem>
            <SelectItem value="po">POs only</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add projection
        </Button>
      </div>

      {mobile}

      {/* Desktop table */}
      <div className="hidden md:block rounded-md border bg-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading…</div>
        ) : computedRows.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground">
            No projections in this window. Try a wider date range or different status filter.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-30 bg-card border-b">
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className={cn(stickyTh, 'left-0 text-left px-3 py-2 min-w-[180px]')}>Inquiry</th>
                  <th className={cn(stickyTh, 'left-[180px] text-left px-3 py-2 min-w-[160px]')}>Customer</th>
                  <th className={cn(stickyTh, 'left-[340px] text-left px-3 py-2 min-w-[110px]')}>Status</th>
                  <th className={cn(stickyTh, 'left-[450px] text-right px-3 py-2 min-w-[90px]')}>Certainty</th>
                  <th className="text-right px-3 py-2 min-w-[120px]">FOB Rev</th>
                  <th className="text-right px-3 py-2 min-w-[80px]">GPM</th>
                  <th className="text-right px-3 py-2 min-w-[120px]">Exp Rev</th>
                  <th className="text-right px-3 py-2 min-w-[120px]">Exp GP</th>
                  {months.map((m) => (
                    <th key={m.toISOString()} className="text-right px-3 py-2 min-w-[100px]">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {computedRows.map((r) => {
                  const actualReady = r.projection?.actual_ready_date
                    ? new Date(r.projection.actual_ready_date as any)
                    : null;
                  return (
                    <tr key={r.id} className="border-b hover:bg-muted/30 group">
                      <td className={cn(stickyTd, 'left-0 px-3 py-2 group-hover:bg-muted/30')}>
                        <button
                          onClick={() => navigate(`/inquiry/${r.id}?tab=projection`)}
                          className="text-left hover:underline"
                        >
                          <div className="font-medium truncate max-w-[160px]">{r.title || r.rfq_number}</div>
                          <div className="text-xs text-muted-foreground">{r.rfq_number}</div>
                        </button>
                      </td>
                      <td className={cn(stickyTd, 'left-[180px] px-3 py-2 group-hover:bg-muted/30')}>
                        <div className="truncate max-w-[140px]">
                          {r.customer_company || r.customer_name || '—'}
                        </div>
                      </td>
                      <td className={cn(stickyTd, 'left-[340px] px-3 py-2 group-hover:bg-muted/30')}>
                        <Badge className={cn('text-xs', INQUIRY_STATUS_COLORS[r.status])}>
                          {INQUIRY_STATUS_LABEL[r.status]}
                        </Badge>
                      </td>
                      <td className={cn(stickyTd, 'left-[450px] px-1 py-1 group-hover:bg-muted/30')}>
                        {renderEditableCell(
                          r.id,
                          'certainty_override',
                          r.projection?.certainty_override,
                          `${Math.round(r.cert * 100)}%${r.projection?.certainty_override == null ? '*' : ''}`,
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {renderEditableCell(
                          r.id,
                          'projected_fob_revenue_usd',
                          r.projection?.projected_fob_revenue_usd,
                          fmtUsd(r.fob),
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {renderEditableCell(
                          r.id,
                          'project_gpm',
                          r.projection?.project_gpm,
                          r.gpm ? `${Math.round(r.gpm * 100)}%` : '—',
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.expectedRev)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.expectedGp)}</td>
                      {months.map((m, i) => {
                        const v = r.monthCells[i];
                        const mEnd = addMonths(m, 1);
                        const isActual =
                          r.status === 'po' && actualReady && mEnd <= addMonths(actualReady, 1);
                        return (
                          <td
                            key={m.toISOString()}
                            className={cn(
                              'px-3 py-2 text-right tabular-nums',
                              isActual && v > 0 && 'bg-emerald-50 dark:bg-emerald-500/10',
                            )}
                          >
                            <div className="inline-flex items-center justify-end gap-1">
                              {isActual && v > 0 && (
                                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              )}
                              {fmtUsd(v)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20 bg-card border-t-2 font-semibold">
                <tr>
                  <td className={cn(stickyTd, 'left-0 px-3 py-2 bg-card')} colSpan={1}>
                    TOTAL
                  </td>
                  <td className={cn(stickyTd, 'left-[180px] bg-card')} />
                  <td className={cn(stickyTd, 'left-[340px] bg-card')} />
                  <td className={cn(stickyTd, 'left-[450px] bg-card')} />
                  <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(totals.fob)}</td>
                  <td />
                  <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(totals.expectedRev)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(totals.expectedGp)}</td>
                  {totals.perMonth.map((t, i) => (
                    <td key={i} className="px-3 py-2 text-right tabular-nums">
                      {fmtUsd(t)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        * Certainty derived from product stages. Click any value to edit. Month cells show weighted customer payments only (revenue side).
      </p>

      <NewInquiryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultStatus="projected_po"
        onCreated={() => {
          setDialogOpen(false);
          fetchData();
        }}
      />
    </div>
  );
}
