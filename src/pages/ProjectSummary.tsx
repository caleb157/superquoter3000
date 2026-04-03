import { useEffect, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';
import { Package, TrendingUp, Clock, AlertTriangle, Container, BarChart3 } from 'lucide-react';
import { SortableHeader } from '@/components/SortableHeader';
import { ProductStatusIndicator, getStatusLevel } from '@/components/ProductStatusIndicator';
import { useTableSort } from '@/hooks/use-table-sort';

interface ProductSummaryRow {
  id: string;
  name: string;
  sku: string | null;
  photo_url: string | null;
  quantity: number;
  target_price_usd: number | null;
  markup_percent: number;
  cbm_done: boolean;
  cogs_done: boolean;
  overhead_done: boolean;
  shipping_done: boolean;
  revenue_done: boolean;
  included: boolean;
  // Calculated
  unit_cbm: number;
  total_cbm: number;
  unit_cost_inr: number;
  unit_cost_usd: number;
  unit_price_usd: number;
  total_cost_usd: number;
  total_revenue_usd: number;
  total_profit_usd: number;
  gpm: number;
  npm: number;
  remaining_to_target_inr: number | null;
  total_direct_mh: number;
  // Cost breakdown
  total_cogs: number;
  total_direct_oh: number;
  total_indirect_oh: number;
  total_shipping: number;
  review_count: number;
}

const CONTAINER_SIZES = [
  { name: '20ft', cbm: 33 },
  { name: '40ft', cbm: 67 },
  { name: '40ft HC', cbm: 76 },
];

const ProjectSummary = ({ projectId }: { projectId: string }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ProductSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<ProductSummaryRow>({
    storageKey: 'summary-sort',
  });

  useEffect(() => {
    if (!projectId) return;
    const fetchAll = async () => {
      const [productsRes, gsRes, empRes, boxRes, chemRes, stRes] = await Promise.all([
        supabase.from('products').select('*').eq('project_id', projectId).order('sort_order'),
        supabase.from('global_settings').select('*').limit(1).single(),
        supabase.from('labor_employees').select('*'),
        supabase.from('box_data').select('*'),
        supabase.from('chemical_prices').select('*'),
        supabase.from('shipping_types').select('*'),
      ]);

      const products = productsRes.data || [];
      const gs = gsRes.data;
      const employees = empRes.data || [];
      const exchangeRate = gs?.exchange_rate || 90;

      // Fetch per-product data
      const productIds = products.map((p: any) => p.id);
      if (productIds.length === 0) { setRows([]); setLoading(false); return; }

      const [cogsRes, nucRes, ohRes, shipRes, cbmRes] = await Promise.all([
        supabase.from('cogs_items').select('*').in('product_id', productIds),
        supabase.from('non_unit_cogs').select('*').in('product_id', productIds),
        supabase.from('overhead_items').select('*').in('product_id', productIds),
        supabase.from('shipping_items').select('*').in('product_id', productIds),
        supabase.from('cbm_estimates').select('*').in('product_id', productIds),
      ]);

      const allCogs = cogsRes.data || [];
      const allNuc = nucRes.data || [];
      const allOh = ohRes.data || [];
      const allShip = shipRes.data || [];
      const allCbm = cbmRes.data || [];
      const shippingTypes = stRes.data || [];

      const summaryRows: ProductSummaryRow[] = products.map((p: any) => {
        const cbmEst = allCbm.find((c: any) => c.product_id === p.id);
        const pCogs = allCogs.filter((c: any) => c.product_id === p.id);
        const pNuc = allNuc.filter((c: any) => c.product_id === p.id);
        const pOh = allOh.filter((c: any) => c.product_id === p.id);
        const pShip = allShip.filter((c: any) => c.product_id === p.id);
        const qty = p.quantity || 100;

        // CBM
        const unit_cbm = cbmEst?.final_unit_cbm || 0;
        const total_cbm = unit_cbm * qty;

        // COGS
        const cogsPerUnit = pCogs
          .filter((i: any) => i.include !== 'No')
          .reduce((sum: number, item: any) => {
            const c = calc.calcCogsItemCost({
              include: item.include, components_per_product: item.components_per_product || 0,
              unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0,
            });
            return sum + c.unit_cost;
          }, 0);

        const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
          pNuc.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr })), qty
        );

        // Overhead
        const ohItems = pOh.map((item: any) => ({
          include: item.include, labor_type: item.labor_type,
          man_hours_per_unit: item.man_hours_per_unit || 0,
          hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
        }));
        const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
        const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
        const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs) : 0;
        const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

        // Shipping
        const shipItem = pShip[0];
        const shipType = shippingTypes.find((s: any) => s.id === shipItem?.shipping_type_id);
        const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
          cost_inr: shipType.cost_inr, per_unit: shipType.per_unit as 'CBM' | 'KG',
          final_unit_cbm: unit_cbm, weight_kg: p.weight_kg || 0,
        }) : 0;

        const markupPercent = p.markup_percent || 0.2;
        const summary = calc.calcProductCostSummary(
          cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
          shippingPerUnit, markupPercent, exchangeRate, qty
        );

        // Review count
        const reviewCount = pCogs.filter((i: any) => i.include === 'Review').length +
          pOh.filter((i: any) => i.include === 'Review').length;

        // Remaining to target
        let remaining_to_target_inr: number | null = null;
        if (p.target_price_usd && summary.unit_price_usd > 0) {
          const targetCostRatio = summary.product_cost_per_unit_inr / summary.unit_price_inr;
          remaining_to_target_inr = (p.target_price_usd * targetCostRatio - summary.product_cost_per_unit_usd) * exchangeRate;
        }

        return {
          id: p.id, name: p.name, sku: p.sku, photo_url: p.photo_url,
          quantity: qty, target_price_usd: p.target_price_usd, markup_percent: markupPercent,
          cbm_done: p.cbm_done || false, cogs_done: p.cogs_done || false,
          overhead_done: p.overhead_done || false, shipping_done: p.shipping_done || false,
          revenue_done: p.revenue_done || false, included: true,
          unit_cbm, total_cbm,
          unit_cost_inr: summary.product_cost_per_unit_inr,
          unit_cost_usd: summary.product_cost_per_unit_usd,
          unit_price_usd: summary.unit_price_usd,
          total_cost_usd: summary.product_cost_per_unit_usd * qty,
          total_revenue_usd: summary.unit_price_usd * qty,
          total_profit_usd: (summary.unit_price_usd - summary.product_cost_per_unit_usd) * qty,
          gpm: summary.gpm, npm: summary.npm,
          remaining_to_target_inr,
          total_direct_mh: totalDirectMhPerUnit * qty,
          total_cogs: (cogsPerUnit + nonUnitCogsPerUnit) * qty,
          total_direct_oh: directOhPerUnit * qty,
          total_indirect_oh: indirectOhPerUnit * qty,
          total_shipping: shippingPerUnit * qty,
          review_count: reviewCount,
        };
      });

      setRows(summaryRows);
      setLoading(false);
    };
    fetchAll();
  }, [projectId]);

  const toggleInclude = (productId: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const sortedRows = useMemo(() => {
    const getters: Record<string, (r: ProductSummaryRow) => string | number> = {
      product: (r) => (r.name || '').toLowerCase(),
      sku: (r) => (r.sku || '').toLowerCase(),
      qty: (r) => r.quantity,
      unit_cbm: (r) => r.unit_cbm,
      total_cbm: (r) => r.total_cbm,
      cost_inr: (r) => r.unit_cost_inr,
      cost_usd: (r) => r.unit_cost_usd,
      price_usd: (r) => r.unit_price_usd,
      total_cost: (r) => r.total_cost_usd,
      total_rev: (r) => r.total_revenue_usd,
      profit: (r) => r.total_profit_usd,
      gpm: (r) => r.gpm,
      npm: (r) => r.npm,
      target: (r) => r.target_price_usd || 0,
      status: (r) => getStatusLevel(r),
    };
    return sortItems(rows, getters);
  }, [rows, sortColumn, sortDirection]);

  const includedRows = sortedRows.filter(r => !excluded.has(r.id));

  // Aggregates
  const agg = useMemo(() => {
    const totalQty = includedRows.reduce((s, r) => s + r.quantity, 0);
    const totalCbm = includedRows.reduce((s, r) => s + r.total_cbm, 0);
    const totalCost = includedRows.reduce((s, r) => s + r.total_cost_usd, 0);
    const totalRevenue = includedRows.reduce((s, r) => s + r.total_revenue_usd, 0);
    const totalProfit = includedRows.reduce((s, r) => s + r.total_profit_usd, 0);
    const weightedGpm = totalRevenue > 0
      ? includedRows.reduce((s, r) => s + r.gpm * r.total_revenue_usd, 0) / totalRevenue : 0;
    const weightedNpm = totalRevenue > 0
      ? includedRows.reduce((s, r) => s + r.npm * r.total_revenue_usd, 0) / totalRevenue : 0;
    const totalMh = includedRows.reduce((s, r) => s + r.total_direct_mh, 0);
    const totalReview = includedRows.reduce((s, r) => s + r.review_count, 0);
    const fullyCosted = includedRows.filter(r => r.cbm_done && r.cogs_done && r.overhead_done && r.shipping_done && r.revenue_done).length;

    // Cost breakdown
    const bCogs = includedRows.reduce((s, r) => s + r.total_cogs, 0);
    const bDoh = includedRows.reduce((s, r) => s + r.total_direct_oh, 0);
    const bIoh = includedRows.reduce((s, r) => s + r.total_indirect_oh, 0);
    const bShip = includedRows.reduce((s, r) => s + r.total_shipping, 0);
    const bTotal = bCogs + bDoh + bIoh + bShip;

    return {
      skuCount: includedRows.length, totalQty, totalCbm, totalCost, totalRevenue,
      totalProfit, weightedGpm, weightedNpm, totalMh, totalReview, fullyCosted,
      bCogs, bDoh, bIoh, bShip, bTotal,
    };
  }, [includedRows]);

  const statusColor = (r: ProductSummaryRow) => {
    const flags = [r.cbm_done, r.cogs_done, r.overhead_done, r.shipping_done, r.revenue_done];
    const done = flags.filter(Boolean).length;
    if (done === 5) return 'bg-emerald-500';
    if (done > 0) return 'bg-amber-500';
    return 'bg-muted-foreground/30';
  };

  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading summary...</div>;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase">Total CBM</span>
            </div>
            <div className="text-lg font-bold font-mono">{agg.totalCbm.toFixed(2)}</div>
            <div className="mt-1 space-y-1">
              {CONTAINER_SIZES.map(c => (
                <div key={c.name} className="flex items-center gap-1.5">
                  <Progress value={Math.min(100, (agg.totalCbm / c.cbm) * 100)} className="h-1.5 flex-1" />
                  <span className="text-[9px] text-muted-foreground w-16">{c.name} {((agg.totalCbm / c.cbm) * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase">Revenue vs Cost</span>
            </div>
            <div className="text-sm font-bold font-mono text-emerald-600">{fmt.usd(agg.totalRevenue)}</div>
            <div className="text-xs text-muted-foreground font-mono">Cost: {fmt.usd(agg.totalCost)}</div>
            <div className="text-xs font-semibold font-mono mt-0.5">Profit: {fmt.usd(agg.totalProfit)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase">Margins</span>
            </div>
            <div className="text-sm font-mono">GPM: <span className="font-bold">{fmt.pct(agg.weightedGpm)}</span></div>
            <div className="text-sm font-mono">NPM: <span className="font-bold">{fmt.pct(agg.weightedNpm)}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase">Man-Hours</span>
            </div>
            <div className="text-lg font-bold font-mono">{agg.totalMh.toFixed(0)}</div>
            <div className="text-[10px] text-muted-foreground">Total direct labor hours</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase">Progress</span>
            </div>
            <div className="text-lg font-bold">{agg.fullyCosted}/{rows.length}</div>
            <Progress value={rows.length > 0 ? (agg.fullyCosted / rows.length) * 100 : 0} className="h-1.5 mt-1" />
            <div className="text-[10px] text-muted-foreground mt-0.5">products fully costed</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              <span className="text-[10px] text-muted-foreground uppercase">To Review</span>
            </div>
            <div className="text-lg font-bold">{agg.totalReview}</div>
            <div className="text-[10px] text-muted-foreground">items flagged "Review"</div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Breakdown */}
      {agg.bTotal > 0 && (
        <Card>
          <CardContent className="p-3">
            <h3 className="text-xs font-semibold mb-2">Cost Breakdown (₹)</h3>
            <div className="flex h-4 rounded-full overflow-hidden">
              {[
                { label: 'COGS', value: agg.bCogs, color: 'bg-primary' },
                { label: 'Direct OH', value: agg.bDoh, color: 'bg-blue-400' },
                { label: 'Indirect OH', value: agg.bIoh, color: 'bg-amber-400' },
                { label: 'Shipping', value: agg.bShip, color: 'bg-emerald-400' },
              ].map(seg => (
                <div key={seg.label} className={`${seg.color} transition-all`}
                  style={{ width: `${(seg.value / agg.bTotal) * 100}%` }}
                  title={`${seg.label}: ${fmt.inr(seg.value)} (${((seg.value / agg.bTotal) * 100).toFixed(1)}%)`}
                />
              ))}
            </div>
            <div className="flex gap-4 mt-1.5 text-[10px]">
              {[
                { label: 'COGS', value: agg.bCogs, color: 'bg-primary' },
                { label: 'Direct OH', value: agg.bDoh, color: 'bg-blue-400' },
                { label: 'Indirect OH', value: agg.bIoh, color: 'bg-amber-400' },
                { label: 'Shipping', value: agg.bShip, color: 'bg-emerald-400' },
              ].map(seg => (
                <span key={seg.label} className="flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${seg.color}`} />
                  {seg.label} {((seg.value / agg.bTotal) * 100).toFixed(1)}%
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Products Table */}
      {rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No products in this project yet.</CardContent></Card>
      ) : (
        <div className="border rounded-md overflow-auto">
          <Table className="dense-table">
             <TableHeader>
              <TableRow>
                <TableHead className="w-8">✓</TableHead>
                <TableHead className="w-10">Photo</TableHead>
                <SortableHeader column="product" label="Product" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHeader column="sku" label="SKU" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHeader column="qty" label="Qty" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="unit_cbm" label="Unit CBM" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="total_cbm" label="Total CBM" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="cost_inr" label="Cost (₹)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="cost_usd" label="Cost ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="price_usd" label="Price ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="total_cost" label="Total Cost ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="total_rev" label="Total Rev ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="profit" label="Profit ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="gpm" label="GPM" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="npm" label="NPM" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="target" label="Target ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-center" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map(r => (
                <TableRow key={r.id} className={excluded.has(r.id) ? 'opacity-40' : ''}>
                  <TableCell>
                    <Checkbox checked={!excluded.has(r.id)} onCheckedChange={() => toggleInclude(r.id)} />
                  </TableCell>
                  <TableCell>
                    {r.photo_url ? (
                      <img src={r.photo_url} alt="" className="h-6 w-6 rounded object-cover" />
                    ) : (
                      <div className="h-6 w-6 rounded bg-muted" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link to={`/product/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.sku || '—'}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.qty(r.quantity)}</TableCell>
                  <TableCell className="text-right font-mono">{r.unit_cbm.toFixed(4)}</TableCell>
                  <TableCell className="text-right font-mono">{r.total_cbm.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.inr(r.unit_cost_inr)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.usd(r.unit_cost_usd)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.usd(r.unit_price_usd)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.usd(r.total_cost_usd)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.usd(r.total_revenue_usd)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.usd(r.total_profit_usd)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.pct(r.gpm)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt.pct(r.npm)}</TableCell>
                  <TableCell className="text-right font-mono">{r.target_price_usd ? fmt.usd(r.target_price_usd) : '—'}</TableCell>
                  <TableCell className="text-center">
                    <ProductStatusIndicator
                      cbm_done={r.cbm_done}
                      cogs_done={r.cogs_done}
                      overhead_done={r.overhead_done}
                      shipping_done={r.shipping_done}
                      revenue_done={r.revenue_done}
                      hasReview={r.review_count > 0}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Aggregate footer */}
          <div className="border-t bg-muted/30 px-2 py-2 flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
            <span><strong>{agg.skuCount}</strong> SKUs</span>
            <span>Qty: <strong>{fmt.qty(agg.totalQty)}</strong></span>
            <span>CBM: <strong>{agg.totalCbm.toFixed(2)}</strong></span>
            <span>Cost: <strong>{fmt.usd(agg.totalCost)}</strong></span>
            <span>Revenue: <strong>{fmt.usd(agg.totalRevenue)}</strong></span>
            <span>Profit: <strong>{fmt.usd(agg.totalProfit)}</strong></span>
            <span>GPM: <strong>{fmt.pct(agg.weightedGpm)}</strong></span>
            <span>NPM: <strong>{fmt.pct(agg.weightedNpm)}</strong></span>
            <span className="text-muted-foreground">
              Container: {CONTAINER_SIZES.map(c => `${((agg.totalCbm / c.cbm) * 100).toFixed(0)}% ${c.name}`).join(' | ')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectSummary;
