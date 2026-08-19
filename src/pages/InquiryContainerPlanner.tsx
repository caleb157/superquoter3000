import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Info, RefreshCw, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { supabase } from '@/integrations/supabase/client';
import { fmt } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { computeProductPriceAndCost, type ProductPriceCostMap } from '@/lib/product-pricing';
import { buildCsv, downloadCsv } from '@/lib/csv-export';

const CUBIC_IN_PER_CBM = 61023.7441;

type Inquiry = { id: string; rfq_number: string; title: string | null };
type Row = {
  id: string;
  name: string;
  sku: string | null;
  inquiry_id: string | null;
  inquiry_label: string;
  quantity: number;
  weight_kg: number;
  unit_cbm: number;
  unit_price_usd: number;
  unit_cost_usd: number;
};
type ContainerType = {
  id: string;
  name: string;
  internal_width_in: number;
  internal_depth_in: number;
  internal_height_in: number;
  max_weight_kg: number;
  usable_volume_factor: number;
};

export default function InquiryContainerPlanner() {
  const { id: inquiryId } = useParams<{ id: string }>();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(inquiryId ? [inquiryId] : []);
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [containerId, setContainerId] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const baseInquiry = inquiries.find(i => i.id === inquiryId) || null;
  useDocumentTitle(baseInquiry ? `Container planner · ${baseInquiry.rfq_number}` : 'Container planner');

  useEffect(() => {
    (async () => {
      const [inqRes, ctRes] = await Promise.all([
        supabase.from('customer_rfqs').select('id, rfq_number, title').order('created_at', { ascending: false }).limit(500),
        (supabase as any).from('container_types').select('*').order('sort_order'),
      ]);
      setInquiries((inqRes.data || []) as Inquiry[]);
      const cts = ((ctRes as any).data || []) as ContainerType[];
      setContainers(cts);
      if (cts.length) setContainerId(prev => prev || cts[0].id);
    })();
  }, []);

  const load = useCallback(async () => {
    if (selectedIds.length === 0) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, quantity, weight_kg, customer_rfq_id, archived_at')
      .in('customer_rfq_id', selectedIds)
      .is('archived_at', null)
      .order('created_at', { ascending: true });
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (data || []) as any[];
    let priceMap: ProductPriceCostMap = {};
    if (list.length) priceMap = await computeProductPriceAndCost(list.map(p => p.id));
    const labelOf = (id: string | null) => inquiries.find(i => i.id === id)?.rfq_number || '—';
    const next: Row[] = list.map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      inquiry_id: p.customer_rfq_id,
      inquiry_label: labelOf(p.customer_rfq_id),
      quantity: Number(p.quantity) || 0,
      weight_kg: Number(p.weight_kg) || 0,
      unit_cbm: priceMap[p.id]?.final_unit_cbm || 0,
      unit_price_usd: priceMap[p.id]?.unit_price_usd || 0,
      unit_cost_usd: priceMap[p.id]?.unit_cost_usd || 0,
    }));
    setRows(next);
    setQty(Object.fromEntries(next.map(r => [r.id, String(r.quantity)])));
    setLoading(false);
  }, [selectedIds, inquiries]);

  useEffect(() => { load(); }, [load]);

  const container = containers.find(c => c.id === containerId) || null;
  const usableCbm = container
    ? (Number(container.internal_width_in) * Number(container.internal_depth_in) * Number(container.internal_height_in) / CUBIC_IN_PER_CBM) *
      (Number(container.usable_volume_factor) || 1)
    : 0;
  const maxWeight = Number(container?.max_weight_kg) || 0;

  const qtyOf = (id: string) => {
    const n = Number(qty[id]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const totals = useMemo(() => {
    let cbm = 0, weight = 0, revenue = 0, cost = 0, units = 0;
    for (const r of rows) {
      const q = qtyOf(r.id);
      units += q;
      cbm += q * r.unit_cbm;
      weight += q * r.weight_kg;
      revenue += q * r.unit_price_usd;
      cost += q * r.unit_cost_usd;
    }
    const byVolume = usableCbm > 0 ? cbm / usableCbm : 0;
    const byWeight = maxWeight > 0 ? weight / maxWeight : 0;
    const containersNeeded = Math.ceil(Math.max(byVolume, byWeight) || 0);
    return {
      cbm, weight, revenue, cost, units,
      margin: revenue - cost,
      marginPct: revenue > 0 ? (revenue - cost) / revenue : 0,
      byVolume, byWeight, containersNeeded,
      binding: byWeight > byVolume ? 'weight' : 'volume' as 'weight' | 'volume',
    };
  }, [rows, qty, usableCbm, maxWeight]);

  // Max additional units of this product that still fit in ONE container with others fixed.
  const fillSuggestion = (r: Row) => {
    if (!container || r.unit_cbm <= 0) return null;
    const otherCbm = totals.cbm - qtyOf(r.id) * r.unit_cbm;
    const otherWeight = totals.weight - qtyOf(r.id) * r.weight_kg;
    const roomCbm = usableCbm - otherCbm;
    const roomKg = maxWeight - otherWeight;
    if (roomCbm <= 0 || roomKg <= 0) return 0;
    const byVol = Math.floor(roomCbm / r.unit_cbm);
    const byWt = r.weight_kg > 0 ? Math.floor(roomKg / r.weight_kg) : Infinity;
    return Math.max(0, Math.min(byVol, byWt));
  };

  const exportCsv = () => {
    const csv = buildCsv([{
      title: `Container plan — ${container?.name || 'no container'} (planning only)`,
      headers: ['Inquiry', 'Product', 'SKU', 'Qty', 'Unit CBM', 'Total CBM', 'Unit kg', 'Total kg', 'Unit revenue $', 'Total revenue $', 'Unit cost $', 'Total cost $'],
      rows: rows.map(r => {
        const q = qtyOf(r.id);
        return [r.inquiry_label, r.name, r.sku ?? '', q,
          r.unit_cbm.toFixed(4), (q * r.unit_cbm).toFixed(3),
          r.weight_kg.toFixed(2), (q * r.weight_kg).toFixed(1),
          r.unit_price_usd.toFixed(2), (q * r.unit_price_usd).toFixed(2),
          r.unit_cost_usd.toFixed(2), (q * r.unit_cost_usd).toFixed(2)];
      }).concat([[
        'TOTAL', '', '', totals.units, '', totals.cbm.toFixed(3), '', totals.weight.toFixed(1), '',
        totals.revenue.toFixed(2), '', totals.cost.toFixed(2),
      ]]),
    }]);
    downloadCsv(`container-plan-${baseInquiry?.rfq_number || 'plan'}.csv`, csv);
  };

  const addInquiry = (id: string) => setSelectedIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  const removeInquiry = (id: string) => setSelectedIds(prev => prev.filter(x => x !== id));

  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageBreadcrumbs
          canonical={[
            { label: 'Inquiries', to: '/' },
            { label: baseInquiry?.rfq_number || 'Inquiry', to: `/inquiry/${inquiryId}` },
          ]}
          current="Container planner"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="gap-1.5">
            <Link to={`/inquiry/${inquiryId}`}><ArrowLeft className="h-4 w-4" /> Back</Link>
          </Button>
          <h1 className="text-lg font-semibold">Container planner</h1>
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Info className="h-3.5 w-3.5" /> Changes here are for planning only and don't affect saved quantities.
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={load}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedIds.map(sid => {
                const inq = inquiries.find(i => i.id === sid);
                return (
                  <Badge key={sid} variant="secondary" className="gap-1">
                    {inq?.rfq_number || sid.slice(0, 6)}
                    {selectedIds.length > 1 && (
                      <button onClick={() => removeInquiry(sid)} aria-label="Remove inquiry"><X className="h-3 w-3" /></button>
                    )}
                  </Badge>
                );
              })}
            </div>
            <Select value="" onValueChange={addInquiry}>
              <SelectTrigger className="h-8 w-[260px] text-xs"><SelectValue placeholder="Add products from another inquiry…" /></SelectTrigger>
              <SelectContent>
                {inquiries.filter(i => !selectedIds.includes(i.id)).map(i => (
                  <SelectItem key={i.id} value={i.id}>{i.rfq_number}{i.title ? ` — ${i.title}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Container</span>
              <Select value={containerId} onValueChange={setContainerId}>
                <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Select container" /></SelectTrigger>
                <SelectContent>
                  {containers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-4">
          <SummaryTile
            label="Volume"
            value={`${fmt.num(totals.cbm, 2)} / ${fmt.num(usableCbm, 2)} CBM`}
            sub={`${pct(totals.byVolume)} of one container`}
            tone={totals.byVolume > 1 ? 'warn' : 'ok'}
          />
          <SummaryTile
            label="Weight"
            value={`${fmt.num(totals.weight, 0)} / ${fmt.num(maxWeight, 0)} kg`}
            sub={`${pct(totals.byWeight)} of one container`}
            tone={totals.byWeight > 1 ? 'warn' : 'ok'}
          />
          <SummaryTile
            label="Containers needed"
            value={String(totals.containersNeeded)}
            sub={`${totals.binding === 'weight' ? 'Weight' : 'Volume'} is the binding constraint`}
            tone={totals.binding === 'weight' ? 'warn' : 'ok'}
          />
          <SummaryTile
            label="Margin"
            value={`$${fmt.num(totals.margin, 0)} · ${pct(totals.marginPct)}`}
            sub={`Rev $${fmt.num(totals.revenue, 0)} · Cost $${fmt.num(totals.cost, 0)}`}
            tone="ok"
          />
        </div>

        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">What-if quantities ({rows.length} products)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="dense-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Product</TableHead>
                    <TableHead className="w-24">Inquiry</TableHead>
                    <TableHead className="w-28">Qty</TableHead>
                    <TableHead className="w-32">Fill container</TableHead>
                    <TableHead className="w-24 text-right">Unit CBM</TableHead>
                    <TableHead className="w-24 text-right">Total CBM</TableHead>
                    <TableHead className="w-24 text-right">Total kg</TableHead>
                    <TableHead className="w-28 text-right">Revenue $</TableHead>
                    <TableHead className="w-28 text-right">Cost $</TableHead>
                    <TableHead className="w-24 text-right">Margin %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => {
                    const q = qtyOf(r.id);
                    const rev = q * r.unit_price_usd;
                    const cost = q * r.unit_cost_usd;
                    const suggestion = fillSuggestion(r);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link to={`/product/${r.id}`} className="hover:underline">{r.name}</Link>
                          {r.sku && <span className="text-muted-foreground text-[11px] ml-1">{r.sku}</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.inquiry_label}</TableCell>
                        <TableCell>
                          <Input
                            className="h-7 text-xs"
                            value={qty[r.id] ?? ''}
                            inputMode="numeric"
                            onChange={e => setQty(prev => ({ ...prev, [r.id]: e.target.value }))}
                          />
                        </TableCell>
                        <TableCell>
                          {suggestion == null ? (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              className="h-6 px-2 text-[11px] gap-1"
                              onClick={() => setQty(prev => ({ ...prev, [r.id]: String(suggestion) }))}
                            >
                              <Wand2 className="h-3 w-3" /> {suggestion}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt.num(r.unit_cbm, 4)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt.num(q * r.unit_cbm, 3)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt.num(q * r.weight_kg, 1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt.num(rev, 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt.num(cost, 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rev > 0 ? pct((rev - cost) / rev) : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                        {loading ? 'Loading products…' : 'No active products in the selected inquiries.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function SummaryTile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'ok' | 'warn' }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn('text-lg font-semibold tabular-nums', tone === 'warn' && 'text-amber-600 dark:text-amber-400')}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
