import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { MetricCard } from './MetricCard';
import { DrillDownDialog } from './DrillDownDialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { buildCsv, downloadCsv, rangeStamp, type CsvSection } from '@/lib/csv-export';
import {
  inRange, pairRfqsToQuotes, sampleCycleDays, avg, median, fmtDays, type DateRange,
} from '@/lib/analytics-helpers';
import { STAGE_LABEL } from '@/components/ProductStagePills';

type DrillKey = null | 'rfqQuote' | 'sampleCycle' | 'pendingRfqs' | 'pendingSamples';

type Props = { range: DateRange; slowQuoteDays: number; slowSampleDays: number };

const TRACKS = ['design', 'quote', 'sample'] as const;

export function OpsDashboard({ range, slowQuoteDays, slowSampleDays }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillKey>(null);
  const [receivedRfqs, setReceivedRfqs] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [samples, setSamples] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [stageEvents, setStageEvents] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [rr, qs, sm, pr, inq, cs, vd, se] = await Promise.all([
        (supabase as any).from('inquiry_received_rfqs').select('id, inquiry_id, received_date'),
        (supabase as any).from('quote_snapshots').select('id, customer_rfq_id, created_at'),
        (supabase as any).from('samples').select('id, product_id, customer_rfq_id, vendor_id, status, requested_date, completed_at'),
        supabase.from('products').select('id, name, customer_rfq_id, quote_stage, sample_stage'),
        supabase.from('customer_rfqs').select('id, rfq_number, title, status, customer_id'),
        supabase.from('customers').select('id, name, company'),
        supabase.from('vendors').select('id, name'),
        (supabase as any).from('product_stage_events').select('product_id, track, from_stage, to_stage, occurred_at').order('occurred_at', { ascending: true }),
      ]);
      setReceivedRfqs((rr.data ?? []) as any[]);
      setQuotes((qs.data ?? []) as any[]);
      setSamples((sm.data ?? []) as any[]);
      setProducts((pr.data ?? []) as any[]);
      setInquiries((inq.data ?? []) as any[]);
      setCustomers((cs.data ?? []) as any[]);
      setVendors((vd.data ?? []) as any[]);
      setStageEvents((se.data ?? []) as any[]);
      setLoading(false);
    })();
  }, []);

  const inquiryById = useMemo(() => {
    const m: Record<string, any> = {};
    inquiries.forEach(i => { m[i.id] = i; });
    return m;
  }, [inquiries]);
  const customerById = useMemo(() => {
    const m: Record<string, any> = {};
    customers.forEach(c => { m[c.id] = c; });
    return m;
  }, [customers]);
  const vendorById = useMemo(() => {
    const m: Record<string, any> = {};
    vendors.forEach(v => { m[v.id] = v; });
    return m;
  }, [vendors]);
  const productById = useMemo(() => {
    const m: Record<string, any> = {};
    products.forEach(p => { m[p.id] = p; });
    return m;
  }, [products]);

  // RFQ → Quote pairs whose quote falls in range
  const rfqQuotePairs = useMemo(() => {
    const pairs = pairRfqsToQuotes(receivedRfqs, quotes);
    return pairs.filter(p => inRange(p.respondedAt, range));
  }, [receivedRfqs, quotes, range]);

  // Sample cycle in range — keep full row info for drill-down
  const sampleCycleRows = useMemo(() => {
    return samples
      .filter(s => s.status === 'completed' && s.completed_at && s.requested_date && inRange(s.completed_at, range))
      .map(s => {
        const days = sampleCycleDays(s);
        const prod = productById[s.product_id];
        const inq = prod?.customer_rfq_id ? inquiryById[prod.customer_rfq_id] : (s.customer_rfq_id ? inquiryById[s.customer_rfq_id] : null);
        const cust = inq?.customer_id ? customerById[inq.customer_id] : null;
        const vendor = s.vendor_id ? vendorById[s.vendor_id] : null;
        return {
          sampleId: s.id,
          productId: s.product_id,
          productName: prod?.name || 'Unknown',
          rfqNumber: inq?.rfq_number || '—',
          customerName: cust?.name || cust?.company || '—',
          vendorName: vendor?.name || 'no vendor',
          requestedDate: s.requested_date,
          completedAt: s.completed_at,
          days: days ?? 0,
        };
      })
      .filter(r => r.days != null)
      .sort((a, b) => b.days - a.days);
  }, [samples, range, productById, inquiryById, customerById, vendorById]);
  const sampleCycles = useMemo(() => sampleCycleRows.map(r => r.days), [sampleCycleRows]);

  // Pending RFQs (received in range without a quote answering them)
  const pendingRfqsInRange = useMemo(() => {
    const allPairs = pairRfqsToQuotes(receivedRfqs, quotes);
    const matched = new Set(allPairs.map(p => p.receivedRfqId));
    return receivedRfqs.filter(r => inRange(r.received_date, range) && !matched.has(r.id));
  }, [receivedRfqs, quotes, range]);

  const pendingSamples = useMemo(() => samples.filter(s => s.status === 'pending'), [samples]);

  // Slow quotes — find inquiries whose oldest unanswered RFQ exceeds threshold
  const slowQuotes = useMemo(() => {
    const allPairs = pairRfqsToQuotes(receivedRfqs, quotes);
    const matched = new Set(allPairs.map(p => p.receivedRfqId));
    const now = Date.now();
    const byInquiry: Record<string, { rfq: any; days: number }> = {};
    for (const r of receivedRfqs) {
      if (matched.has(r.id)) continue;
      const days = (now - new Date(r.received_date + 'T00:00:00Z').getTime()) / 86400000;
      if (days <= slowQuoteDays) continue;
      const cur = byInquiry[r.inquiry_id];
      if (!cur || days > cur.days) byInquiry[r.inquiry_id] = { rfq: r, days };
    }
    return Object.entries(byInquiry).map(([inquiryId, v]) => {
      const inq = inquiryById[inquiryId];
      const cust = inq?.customer_id ? customerById[inq.customer_id] : null;
      const pendingProductCount = products.filter(p =>
        p.customer_rfq_id === inquiryId &&
        (p.quote_stage === 'quoting' || p.quote_stage === 'ready_for_quote')
      ).length;
      return {
        inquiryId,
        rfqNumber: inq?.rfq_number || '?',
        title: inq?.title || '',
        customerName: cust?.name || cust?.company || '—',
        days: v.days,
        pendingProductCount,
      };
    }).sort((a, b) => b.days - a.days);
  }, [receivedRfqs, quotes, slowQuoteDays, inquiryById, customerById, products]);

  const slowSamples = useMemo(() => {
    const now = Date.now();
    return samples.filter(s => {
      if (s.status !== 'pending' || !s.requested_date) return false;
      const days = (now - new Date(s.requested_date + 'T00:00:00Z').getTime()) / 86400000;
      return days > slowSampleDays;
    }).map(s => {
      const days = (now - new Date(s.requested_date + 'T00:00:00Z').getTime()) / 86400000;
      const prod = productById[s.product_id];
      const inq = prod?.customer_rfq_id ? inquiryById[prod.customer_rfq_id] : null;
      const cust = inq?.customer_id ? customerById[inq.customer_id] : null;
      const vendor = s.vendor_id ? vendorById[s.vendor_id] : null;
      return {
        sampleId: s.id,
        productId: s.product_id,
        productName: prod?.name || 'Unknown',
        rfqNumber: inq?.rfq_number || '—',
        customerName: cust?.name || cust?.company || '—',
        vendorName: vendor?.name || 'no vendor',
        days,
      };
    }).sort((a, b) => b.days - a.days);
  }, [samples, slowSampleDays, productById, inquiryById, customerById, vendorById]);

  // Stage durations in range (events in range)
  const stageDurations = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    stageEvents.forEach(e => {
      const key = `${e.product_id}|${e.track}`;
      (grouped[key] ||= []).push(e);
    });
    type Slot = { durations: number[]; count: number };
    const out: Record<string, Record<string, Slot>> = { design: {}, quote: {}, sample: {} };
    Object.entries(grouped).forEach(([key, evs]) => {
      const [, track] = key.split('|');
      if (!TRACKS.includes(track as any)) return;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (!e.to_stage) continue;
        const next = evs[i + 1];
        if (next && inRange(next.occurred_at, range)) {
          const d = (new Date(next.occurred_at).getTime() - new Date(e.occurred_at).getTime()) / 86400000;
          const slot = (out[track][e.to_stage] ||= { durations: [], count: 0 });
          slot.durations.push(d);
          slot.count++;
        }
      }
    });
    return out;
  }, [stageEvents, range]);

  // Pending breakdown
  const costingPending = useMemo(() => {
    const counts: Record<string, number> = {};
    products.forEach(p => {
      if (p.quote_stage === 'quoting' || p.quote_stage === 'ready_for_quote') {
        if (p.customer_rfq_id) counts[p.customer_rfq_id] = (counts[p.customer_rfq_id] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [products]);

  const samplingPending = useMemo(() => {
    const counts: Record<string, number> = {};
    pendingSamples.forEach(s => {
      const inquiryId = s.customer_rfq_id || productById[s.product_id]?.customer_rfq_id;
      if (inquiryId) counts[inquiryId] = (counts[inquiryId] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [pendingSamples, productById]);

  if (loading) {
    return <div className="text-center py-10 text-sm text-muted-foreground">Loading operations analytics…</div>;
  }

  const inqLabel = (id: string) => {
    const inq = inquiryById[id];
    const cust = inq?.customer_id ? customerById[inq.customer_id] : null;
    return `${inq?.rfq_number || id.slice(0, 6)} · ${cust?.name || cust?.company || '—'}`;
  };

  return (
    <div className="space-y-4">
  const handleExport = () => {
    const sections: CsvSection[] = [
      {
        title: `Operations Analytics — ${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}`,
        headers: ['Metric', 'Value'],
        rows: [
          ['Avg RFQ → Quote (days)', avg(rfqQuotePairs.map(p => p.days))?.toFixed(2) ?? '—'],
          ['Median RFQ → Quote (days)', median(rfqQuotePairs.map(p => p.days))?.toFixed(2) ?? '—'],
          ['RFQ→Quote pairs in range', rfqQuotePairs.length],
          ['Avg sample cycle (days)', avg(sampleCycles)?.toFixed(2) ?? '—'],
          ['Median sample cycle (days)', median(sampleCycles)?.toFixed(2) ?? '—'],
          ['Completed samples in range', sampleCycles.length],
          ['Pending RFQs (received in range)', pendingRfqsInRange.length],
          ['Pending Samples (all time)', pendingSamples.length],
        ],
      },
      {
        title: 'RFQ → Quote pairs',
        headers: ['Inquiry', 'Received', 'Responded', 'Days'],
        rows: rfqQuotePairs.map(p => [inqLabel(p.inquiryId), p.receivedAt, p.respondedAt, p.days.toFixed(2)]),
      },
      {
        title: 'Completed sample cycles',
        headers: ['Product', 'Inquiry', 'Customer', 'Vendor', 'Requested', 'Completed', 'Days'],
        rows: sampleCycleRows.map(s => [s.productName, s.rfqNumber, s.customerName, s.vendorName, s.requestedDate, s.completedAt, s.days.toFixed(2)]),
      },
      {
        title: 'Pending RFQs (received in range, no quote yet)',
        headers: ['Inquiry', 'Received', 'Days waiting'],
        rows: pendingRfqsInRange.map(r => [
          inqLabel(r.inquiry_id),
          r.received_date,
          Math.round((Date.now() - new Date(r.received_date + 'T00:00:00Z').getTime()) / 86400000),
        ]),
      },
      {
        title: 'Pending samples (all time)',
        headers: ['Product', 'Vendor', 'Requested', 'Days waiting'],
        rows: pendingSamples.map((s: any) => [
          productById[s.product_id]?.name || 'Unknown',
          s.vendor_id ? (vendorById[s.vendor_id]?.name || '—') : 'no vendor',
          s.requested_date || '—',
          s.requested_date ? Math.round((Date.now() - new Date(s.requested_date + 'T00:00:00Z').getTime()) / 86400000) : '—',
        ]),
      },
      {
        title: `Slow quotes (>${slowQuoteDays} days)`,
        headers: ['Inquiry', 'Customer', 'Days', 'Pending products'],
        rows: slowQuotes.map(r => [r.rfqNumber, r.customerName, r.days.toFixed(0), r.pendingProductCount]),
      },
      {
        title: `Slow samples (>${slowSampleDays} days)`,
        headers: ['Product', 'Inquiry', 'Customer', 'Vendor', 'Days'],
        rows: slowSamples.map(s => [s.productName, s.rfqNumber, s.customerName, s.vendorName, s.days.toFixed(0)]),
      },
    ];
    downloadCsv(`operations-analytics_${rangeStamp(range.from, range.to)}.csv`, buildCsv(sections));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Avg RFQ → Quote"
          value={fmtDays(avg(rfqQuotePairs.map(p => p.days)))}
          sublabel={`${rfqQuotePairs.length} pairs · median ${fmtDays(median(rfqQuotePairs.map(p => p.days)))}`}
          onClick={rfqQuotePairs.length ? () => setDrill('rfqQuote') : undefined}
        />
        <MetricCard
          label="Avg Sample Cycle"
          value={fmtDays(avg(sampleCycles))}
          sublabel={`${sampleCycles.length} completed · median ${fmtDays(median(sampleCycles))}`}
          onClick={sampleCycleRows.length ? () => setDrill('sampleCycle') : undefined}
        />
        <MetricCard
          label="Pending RFQs"
          value={pendingRfqsInRange.length}
          sublabel="Received in range, no quote yet"
          onClick={pendingRfqsInRange.length ? () => setDrill('pendingRfqs') : undefined}
        />
        <MetricCard
          label="Pending Samples"
          value={pendingSamples.length}
          sublabel="Across all time"
          onClick={pendingSamples.length ? () => setDrill('pendingSamples') : undefined}
        />
      </div>

      <DrillDownDialog
        open={drill === 'rfqQuote'}
        onOpenChange={(o) => !o && setDrill(null)}
        title="RFQ → Quote pairs in range"
        description="One row per RFQ that received a quote response with response date inside the selected range."
        rows={rfqQuotePairs}
        rowKey={(r) => r.receivedRfqId}
        onRowClick={(r) => navigate(`/inquiry/${r.inquiryId}?tab=quotes`)}
        columns={[
          { header: 'Inquiry', cell: (r: any) => inqLabel(r.inquiryId) },
          { header: 'Received', cell: (r: any) => r.receivedAt },
          { header: 'Responded', cell: (r: any) => new Date(r.respondedAt).toLocaleDateString() },
          { header: 'Days', align: 'right', cell: (r: any) => r.days.toFixed(1) },
        ]}
      />
      <DrillDownDialog
        open={drill === 'sampleCycle'}
        onOpenChange={(o) => !o && setDrill(null)}
        title="Completed sample cycles in range"
        description="Samples with completed_at inside the selected range."
        rows={sampleCycleRows}
        rowKey={(r) => r.sampleId}
        onRowClick={(r) => navigate(`/product/${r.productId}?tab=sample-log`)}
        columns={[
          { header: 'Product', cell: (r: any) => r.productName },
          { header: 'Inquiry · Customer', cell: (r: any) => `${r.rfqNumber} · ${r.customerName}` },
          { header: 'Vendor', cell: (r: any) => r.vendorName },
          { header: 'Days', align: 'right', cell: (r: any) => r.days.toFixed(1) },
        ]}
      />
      <DrillDownDialog
        open={drill === 'pendingRfqs'}
        onOpenChange={(o) => !o && setDrill(null)}
        title="Pending RFQs (received in range)"
        description="RFQs received during the selected range that have no quote response yet."
        rows={pendingRfqsInRange}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/inquiry/${r.inquiry_id}?tab=quotes`)}
        columns={[
          { header: 'Inquiry', cell: (r: any) => inqLabel(r.inquiry_id) },
          { header: 'Received', cell: (r: any) => r.received_date },
          { header: 'Days waiting', align: 'right', cell: (r: any) => Math.round((Date.now() - new Date(r.received_date + 'T00:00:00Z').getTime()) / 86400000) },
        ]}
      />
      <DrillDownDialog
        open={drill === 'pendingSamples'}
        onOpenChange={(o) => !o && setDrill(null)}
        title="Pending samples"
        description="All samples currently in pending status (across all time)."
        rows={pendingSamples}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/product/${r.product_id}?tab=sample-log`)}
        columns={[
          { header: 'Product', cell: (r: any) => productById[r.product_id]?.name || 'Unknown' },
          { header: 'Vendor', cell: (r: any) => r.vendor_id ? (vendorById[r.vendor_id]?.name || '—') : 'no vendor' },
          { header: 'Requested', cell: (r: any) => r.requested_date || '—' },
          { header: 'Days waiting', align: 'right', cell: (r: any) => r.requested_date ? Math.round((Date.now() - new Date(r.requested_date + 'T00:00:00Z').getTime()) / 86400000) : '—' },
        ]}
      />


      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Slow quotes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Slow quotes (&gt;{slowQuoteDays} days)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {slowQuotes.length === 0 ? (
              <div className="px-6 py-6 text-sm text-muted-foreground text-center">
                No slow quotes — all quotes responded within {slowQuoteDays} days. 🎉
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">Inquiry</TableHead>
                    <TableHead className="h-8 text-xs">Customer</TableHead>
                    <TableHead className="h-8 text-xs text-right">Days</TableHead>
                    <TableHead className="h-8 text-xs text-right">Pending</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slowQuotes.map(r => (
                    <TableRow
                      key={r.inquiryId}
                      onClick={() => navigate(`/inquiry/${r.inquiryId}?tab=quotes`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="py-2 text-xs">
                        {r.rfqNumber}
                        {r.title && <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{r.title}</div>}
                      </TableCell>
                      <TableCell className="py-2 text-xs">{r.customerName}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{r.days.toFixed(0)}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{r.pendingProductCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Slow samples */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Slow samples (&gt;{slowSampleDays} days)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {slowSamples.length === 0 ? (
              <div className="px-6 py-6 text-sm text-muted-foreground text-center">
                No slow samples — all within {slowSampleDays} days. 🎉
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">Product</TableHead>
                    <TableHead className="h-8 text-xs">Inquiry · Customer</TableHead>
                    <TableHead className="h-8 text-xs">Vendor</TableHead>
                    <TableHead className="h-8 text-xs text-right">Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slowSamples.map(s => (
                    <TableRow
                      key={s.sampleId}
                      onClick={() => navigate(`/product/${s.productId}?tab=sample-log`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="py-2 text-xs">{s.productName}</TableCell>
                      <TableCell className="py-2 text-xs">{s.rfqNumber} · {s.customerName}</TableCell>
                      <TableCell className="py-2 text-xs">{s.vendorName}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{s.days.toFixed(0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stage durations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Stage durations (in range)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-xs">Track</TableHead>
                <TableHead className="h-8 text-xs">Stage</TableHead>
                <TableHead className="h-8 text-xs text-right">Avg</TableHead>
                <TableHead className="h-8 text-xs text-right">Median</TableHead>
                <TableHead className="h-8 text-xs text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TRACKS.flatMap(track => {
                const stages = Object.entries(stageDurations[track] || {});
                return stages.map(([stage, info]) => (
                  <TableRow key={`${track}-${stage}`}>
                    <TableCell className="py-2 text-xs capitalize">{track}</TableCell>
                    <TableCell className="py-2 text-xs">{STAGE_LABEL[stage] ?? stage}</TableCell>
                    <TableCell className="py-2 text-xs text-right tabular-nums">{fmtDays(avg(info.durations))}</TableCell>
                    <TableCell className="py-2 text-xs text-right tabular-nums">{fmtDays(median(info.durations))}</TableCell>
                    <TableCell className="py-2 text-xs text-right tabular-nums">{info.count}</TableCell>
                  </TableRow>
                ));
              })}
              {TRACKS.every(t => Object.keys(stageDurations[t] || {}).length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                    No stage transitions in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pending breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Costing pending — top inquiries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {costingPending.length === 0 ? (
              <div className="px-6 py-6 text-sm text-muted-foreground text-center">Nothing pending costing.</div>
            ) : (
              <Table>
                <TableBody>
                  {costingPending.map(([inquiryId, count]) => (
                    <TableRow
                      key={inquiryId}
                      onClick={() => navigate(`/inquiry/${inquiryId}?tab=products`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="py-2 text-xs">{inqLabel(inquiryId)}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sampling pending — top inquiries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {samplingPending.length === 0 ? (
              <div className="px-6 py-6 text-sm text-muted-foreground text-center">Nothing pending sampling.</div>
            ) : (
              <Table>
                <TableBody>
                  {samplingPending.map(([inquiryId, count]) => (
                    <TableRow
                      key={inquiryId}
                      onClick={() => navigate(`/inquiry/${inquiryId}?tab=samples`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="py-2 text-xs">{inqLabel(inquiryId)}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
