import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';
import { Package, TrendingUp, Clock, AlertTriangle, BarChart3, ChevronRight, Layers } from 'lucide-react';
import { SortableHeader } from '@/components/SortableHeader';
import { ProductStatusIndicator, getStatusLevel } from '@/components/ProductStatusIndicator';
import { useTableSort } from '@/hooks/use-table-sort';
import { cn } from '@/lib/utils';

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
  is_component: boolean;
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
  total_cogs: number;
  total_direct_oh: number;
  total_indirect_oh: number;
  total_shipping: number;
  review_count: number;
  delta_to_target_usd: number | null;
  raw_piece_cost_inr: number;
  max_raw_piece_inr: number | null;
  non_raw_piece_costs_inr: number;
}

interface AssemblyRow {
  id: string;
  name: string;
  sku: string | null;
  photo_url: string | null;
  quantity: number;
  markup_percent: number;
  target_price_usd: number | null;
  componentIds: { productId: string; qtyPerAssembly: number }[];
}

const CONTAINER_SIZES = [
  { name: '20ft', cbm: 33 },
  { name: '40ft', cbm: 67 },
  { name: '40ft HC', cbm: 76 },
];

function computeProductRow(p: any, allCogs: any[], allNuc: any[], allOh: any[], allShip: any[], allCbm: any[], employees: any[], shippingTypes: any[], gs: any, exchangeRate: number): ProductSummaryRow {
  const cbmEst = allCbm.find((c: any) => c.product_id === p.id);
  const pCogs = allCogs.filter((c: any) => c.product_id === p.id);
  const pNuc = allNuc.filter((c: any) => c.product_id === p.id);
  const pOh = allOh.filter((c: any) => c.product_id === p.id);
  const pShip = allShip.filter((c: any) => c.product_id === p.id);
  const qty = p.quantity || 100;

  const unit_cbm = cbmEst?.final_unit_cbm || 0;
  const total_cbm = unit_cbm * qty;

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

  const ohItems = pOh.map((item: any) => ({
    include: item.include, labor_type: item.labor_type,
    man_hours_per_unit: item.man_hours_per_unit || 0,
    hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
  }));
  const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
  const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
  const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs) : 0;
  const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

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

  const reviewCount = pCogs.filter((i: any) => i.include === 'Review').length +
    pOh.filter((i: any) => i.include === 'Review').length;

  let remaining_to_target_inr: number | null = null;
  if (p.target_price_usd && summary.unit_price_usd > 0) {
    const targetCostRatio = summary.product_cost_per_unit_inr / summary.unit_price_inr;
    remaining_to_target_inr = (p.target_price_usd * targetCostRatio - summary.product_cost_per_unit_usd) * exchangeRate;
  }

  const rawPieceCostInr = pCogs
    .filter((i: any) => i.include !== 'No' && i.cogs_type === 'Raw Piece')
    .reduce((sum: number, item: any) => sum + calc.calcCogsItemCost({
      include: item.include, components_per_product: item.components_per_product || 0,
      unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0,
    }).unit_cost, 0);
  const nonRawPieceCostsInr = summary.product_cost_per_unit_inr - rawPieceCostInr;

  let delta_to_target_usd: number | null = null;
  let max_raw_piece_inr: number | null = null;
  if (p.target_price_usd) {
    delta_to_target_usd = p.target_price_usd - summary.unit_price_usd;
    const maxTotalCostInr = (p.target_price_usd / (1 + markupPercent)) * exchangeRate;
    max_raw_piece_inr = maxTotalCostInr - nonRawPieceCostsInr;
  }

  return {
    id: p.id, name: p.name, sku: p.sku, photo_url: p.photo_url,
    quantity: qty, target_price_usd: p.target_price_usd, markup_percent: markupPercent,
    cbm_done: p.cbm_done || false, cogs_done: p.cogs_done || false,
    overhead_done: p.overhead_done || false, shipping_done: p.shipping_done || false,
    revenue_done: p.revenue_done || false, included: true, is_component: p.is_component || false,
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
    delta_to_target_usd,
    raw_piece_cost_inr: rawPieceCostInr,
    max_raw_piece_inr,
    non_raw_piece_costs_inr: nonRawPieceCostsInr,
  };
}

const ProjectSummary = ({ projectId }: { projectId: string }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ProductSummaryRow[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expandedAssemblies, setExpandedAssemblies] = useState<Set<string>>(new Set());
  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<ProductSummaryRow>({
    storageKey: 'summary-sort',
  });

  useEffect(() => {
    if (!projectId) return;
    const fetchAll = async () => {
      const [productsRes, gsRes, empRes, boxRes, chemRes, stRes, asmRes, asmCompRes] = await Promise.all([
        supabase.from('products').select('*').eq('project_id', projectId).order('sort_order'),
        supabase.from('global_settings').select('*').limit(1).single(),
        supabase.from('labor_employees').select('*'),
        supabase.from('box_data').select('*'),
        supabase.from('chemical_prices').select('*'),
        supabase.from('shipping_types').select('*'),
        supabase.from('product_assemblies').select('*').eq('project_id', projectId),
        supabase.from('assembly_components').select('*'),
      ]);

      const products = productsRes.data || [];
      const gs = gsRes.data;
      const employees = empRes.data || [];
      const exchangeRate = gs?.exchange_rate || 90;
      const asmData = asmRes.data || [];
      const asmCompData = asmCompRes.data || [];

      const productIds = products.map((p: any) => p.id);
      if (productIds.length === 0 && asmData.length === 0) { setRows([]); setAssemblies([]); setLoading(false); return; }

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

      const summaryRows: ProductSummaryRow[] = products.map((p: any) =>
        computeProductRow(p, allCogs, allNuc, allOh, allShip, allCbm, employees, shippingTypes, gs, exchangeRate)
      );

      // Build assembly rows
      const assemblyRows: AssemblyRow[] = asmData.map((asm: any) => {
        const comps = asmCompData
          .filter((c: any) => c.assembly_id === asm.id)
          .map((c: any) => ({ productId: c.product_id, qtyPerAssembly: c.quantity_per_assembly || 1 }));
        return {
          id: asm.id,
          name: asm.name,
          sku: asm.sku,
          photo_url: asm.photo_url,
          quantity: asm.quantity || 100,
          markup_percent: asm.markup_percent || 0.2,
          target_price_usd: asm.target_price_usd,
          componentIds: comps,
        };
      });

      setRows(summaryRows);
      setAssemblies(assemblyRows);
      setLoading(false);
    };
    fetchAll();
  }, [projectId]);

  const toggleInclude = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAssemblyExpand = (id: string) => {
    setExpandedAssemblies(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rowMap = useMemo(() => {
    const m: Record<string, ProductSummaryRow> = {};
    rows.forEach(r => { m[r.id] = r; });
    return m;
  }, [rows]);

  // Products that are components of any assembly
  const componentProductIds = useMemo(() => {
    const ids = new Set<string>();
    assemblies.forEach(a => a.componentIds.forEach(c => ids.add(c.productId)));
    return ids;
  }, [assemblies]);

  // Compute assembly aggregate data
  const assemblyAggregates = useMemo(() => {
    const map: Record<string, {
      unit_cost_usd: number; unit_price_usd: number; unit_cbm: number;
      total_cost_usd: number; total_revenue_usd: number; total_profit_usd: number;
      total_cbm: number; total_mh: number; gpm: number;
    }> = {};

    assemblies.forEach(asm => {
      let unitCostUsd = 0;
      let unitCbm = 0;
      let unitMh = 0;

      asm.componentIds.forEach(comp => {
        const row = rowMap[comp.productId];
        if (!row) return;
        unitCostUsd += row.unit_cost_usd * comp.qtyPerAssembly;
        unitCbm += row.unit_cbm * comp.qtyPerAssembly;
        unitMh += (row.total_direct_mh / row.quantity) * comp.qtyPerAssembly;
      });

      const unitPriceUsd = unitCostUsd * (1 + asm.markup_percent);
      const qty = asm.quantity;
      const totalCost = unitCostUsd * qty;
      const totalRevenue = unitPriceUsd * qty;
      const totalProfit = totalRevenue - totalCost;
      const gpm = totalRevenue > 0 ? totalProfit / totalRevenue : 0;

      map[asm.id] = {
        unit_cost_usd: unitCostUsd,
        unit_price_usd: unitPriceUsd,
        unit_cbm: unitCbm,
        total_cost_usd: totalCost,
        total_revenue_usd: totalRevenue,
        total_profit_usd: totalProfit,
        total_cbm: unitCbm * qty,
        total_mh: unitMh * qty,
        gpm,
      };
    });

    return map;
  }, [assemblies, rowMap]);

  // Standalone products (not components of any assembly)
  const standaloneRows = useMemo(() =>
    rows.filter(r => !componentProductIds.has(r.id)),
    [rows, componentProductIds]
  );

  const sortedStandaloneRows = useMemo(() => {
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
      delta: (r) => r.delta_to_target_usd || 0,
      max_raw: (r) => r.max_raw_piece_inr || 0,
      raw_piece: (r) => r.raw_piece_cost_inr,
      status: (r) => getStatusLevel(r),
    };
    return sortItems(standaloneRows, getters);
  }, [standaloneRows, sortColumn, sortDirection]);

  // Aggregates: standalone products + assemblies (no double counting)
  const agg = useMemo(() => {
    const includedStandalone = sortedStandaloneRows.filter(r => !excluded.has(r.id));
    const includedAssemblies = assemblies.filter(a => !excluded.has(a.id));

    // Standalone product totals
    let totalQty = includedStandalone.reduce((s, r) => s + r.quantity, 0);
    let totalCbm = includedStandalone.reduce((s, r) => s + r.total_cbm, 0);
    let totalCost = includedStandalone.reduce((s, r) => s + r.total_cost_usd, 0);
    let totalRevenue = includedStandalone.reduce((s, r) => s + r.total_revenue_usd, 0);
    let totalProfit = includedStandalone.reduce((s, r) => s + r.total_profit_usd, 0);
    let totalMh = includedStandalone.reduce((s, r) => s + r.total_direct_mh, 0);
    let totalReview = includedStandalone.reduce((s, r) => s + r.review_count, 0);

    // Cost breakdown from standalone
    let bCogs = includedStandalone.reduce((s, r) => s + r.total_cogs, 0);
    let bDoh = includedStandalone.reduce((s, r) => s + r.total_direct_oh, 0);
    let bIoh = includedStandalone.reduce((s, r) => s + r.total_indirect_oh, 0);
    let bShip = includedStandalone.reduce((s, r) => s + r.total_shipping, 0);

    // Add assembly totals
    includedAssemblies.forEach(asm => {
      const asmAgg = assemblyAggregates[asm.id];
      if (!asmAgg) return;
      totalQty += asm.quantity;
      totalCbm += asmAgg.total_cbm;
      totalCost += asmAgg.total_cost_usd;
      totalRevenue += asmAgg.total_revenue_usd;
      totalProfit += asmAgg.total_profit_usd;
      totalMh += asmAgg.total_mh;

      // Add component cost breakdowns at assembly quantity
      asm.componentIds.forEach(comp => {
        const row = rowMap[comp.productId];
        if (!row) return;
        const scale = comp.qtyPerAssembly * asm.quantity / row.quantity;
        bCogs += row.total_cogs * scale;
        bDoh += row.total_direct_oh * scale;
        bIoh += row.total_indirect_oh * scale;
        bShip += row.total_shipping * scale;
      });
    });

    const weightedGpm = totalRevenue > 0
      ? (totalProfit / totalRevenue) : 0;
    const fullyCosted = includedStandalone.filter(r => r.cbm_done && r.cogs_done && r.overhead_done && r.shipping_done && r.revenue_done).length;
    const bTotal = bCogs + bDoh + bIoh + bShip;

    return {
      skuCount: includedStandalone.length + includedAssemblies.length,
      totalQty, totalCbm, totalCost, totalRevenue,
      totalProfit, weightedGpm, totalMh, totalReview, fullyCosted,
      bCogs, bDoh, bIoh, bShip, bTotal,
      standaloneCount: includedStandalone.length,
      assemblyCount: includedAssemblies.length,
    };
  }, [sortedStandaloneRows, assemblies, assemblyAggregates, excluded, rowMap]);

  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading summary...</div>;

  const renderProductRow = (r: ProductSummaryRow, indent = false) => (
    <TableRow key={r.id} className={cn(excluded.has(r.id) && 'opacity-40', indent && 'bg-muted/20')}>
      <TableCell>
        {!indent && <Checkbox checked={!excluded.has(r.id)} onCheckedChange={() => toggleInclude(r.id)} />}
      </TableCell>
      <TableCell>
        {r.photo_url ? (
          <img src={r.photo_url} alt="" className="h-6 w-6 rounded object-cover" />
        ) : (
          <div className="h-6 w-6 rounded bg-muted" />
        )}
      </TableCell>
      <TableCell>
        <div className={cn('flex items-center gap-1', indent && 'pl-4')}>
          {indent && <span className="text-muted-foreground text-xs">└</span>}
          <Link to={`/product/${r.id}`} className="font-medium text-primary hover:underline text-sm">{r.name}</Link>
          {r.is_component && <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1">Component</Badge>}
        </div>
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
      <TableCell className={`text-right font-mono font-semibold ${r.delta_to_target_usd != null ? (r.delta_to_target_usd >= 0 ? 'text-emerald-600' : 'text-destructive') : ''}`}>
        {r.delta_to_target_usd != null ? `${r.delta_to_target_usd >= 0 ? '+' : ''}${fmt.usd(r.delta_to_target_usd)}` : '—'}
      </TableCell>
      <TableCell className="text-right font-mono">{r.raw_piece_cost_inr > 0 ? fmt.inr(r.raw_piece_cost_inr) : '—'}</TableCell>
      <TableCell className={`text-right font-mono font-semibold ${r.max_raw_piece_inr != null ? (r.max_raw_piece_inr >= r.raw_piece_cost_inr ? 'text-emerald-600' : 'text-destructive') : ''}`}>
        {r.max_raw_piece_inr != null ? fmt.inr(r.max_raw_piece_inr) : '—'}
      </TableCell>
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
  );

  const renderAssemblyRow = (asm: AssemblyRow) => {
    const asmAgg = assemblyAggregates[asm.id];
    if (!asmAgg) return null;
    const isExpanded = expandedAssemblies.has(asm.id);
    const componentRows = asm.componentIds
      .map(c => rowMap[c.productId])
      .filter(Boolean);

    return (
      <React.Fragment key={asm.id}>
        <TableRow className={cn('bg-accent/30 font-medium', excluded.has(asm.id) && 'opacity-40')}>
          <TableCell>
            <Checkbox checked={!excluded.has(asm.id)} onCheckedChange={() => toggleInclude(asm.id)} />
          </TableCell>
          <TableCell>
            {asm.photo_url ? (
              <img src={asm.photo_url} alt="" className="h-6 w-6 rounded object-cover" />
            ) : (
              <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center">
                <Layers className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
          </TableCell>
          <TableCell>
            <button
              onClick={() => toggleAssemblyExpand(asm.id)}
              className="flex items-center gap-1.5 text-left"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')} />
              <span className="font-semibold text-sm">{asm.name}</span>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                Assembly · {asm.componentIds.length} items
              </Badge>
            </button>
          </TableCell>
          <TableCell className="text-muted-foreground">{asm.sku || '—'}</TableCell>
          <TableCell className="text-right font-mono">{fmt.qty(asm.quantity)}</TableCell>
          <TableCell className="text-right font-mono">{asmAgg.unit_cbm.toFixed(4)}</TableCell>
          <TableCell className="text-right font-mono">{asmAgg.total_cbm.toFixed(2)}</TableCell>
          <TableCell className="text-right font-mono">—</TableCell>
          <TableCell className="text-right font-mono">{fmt.usd(asmAgg.unit_cost_usd)}</TableCell>
          <TableCell className="text-right font-mono">{fmt.usd(asmAgg.unit_price_usd)}</TableCell>
          <TableCell className="text-right font-mono">{fmt.usd(asmAgg.total_cost_usd)}</TableCell>
          <TableCell className="text-right font-mono">{fmt.usd(asmAgg.total_revenue_usd)}</TableCell>
          <TableCell className="text-right font-mono">{fmt.usd(asmAgg.total_profit_usd)}</TableCell>
          <TableCell className="text-right font-mono">{fmt.pct(asmAgg.gpm)}</TableCell>
          <TableCell className="text-right font-mono">—</TableCell>
          <TableCell className="text-right font-mono">{asm.target_price_usd ? fmt.usd(asm.target_price_usd) : '—'}</TableCell>
          <TableCell className="text-right font-mono">
            {asm.target_price_usd != null ? (
              <span className={asm.target_price_usd >= asmAgg.unit_price_usd ? 'text-emerald-600' : 'text-destructive'}>
                {`${asm.target_price_usd >= asmAgg.unit_price_usd ? '+' : ''}${fmt.usd(asm.target_price_usd - asmAgg.unit_price_usd)}`}
              </span>
            ) : '—'}
          </TableCell>
          <TableCell>—</TableCell>
          <TableCell>—</TableCell>
          <TableCell>—</TableCell>
        </TableRow>
        {isExpanded && componentRows.map(r => renderProductRow(r, true))}
      </React.Fragment>
    );
  };

  const allEmpty = rows.length === 0 && assemblies.length === 0;

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
            <div className="text-lg font-bold">{agg.fullyCosted}/{standaloneRows.length}</div>
            <Progress value={standaloneRows.length > 0 ? (agg.fullyCosted / standaloneRows.length) * 100 : 0} className="h-1.5 mt-1" />
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

      {/* Products & Assemblies Table */}
      {allEmpty ? (
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
                <SortableHeader column="delta" label="Δ Target" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="raw_piece" label="Raw Piece (₹)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="max_raw" label="Max Raw (₹)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-center" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Assemblies first */}
              {assemblies.map(asm => renderAssemblyRow(asm))}
              {/* Then standalone products */}
              {sortedStandaloneRows.map(r => renderProductRow(r))}
            </TableBody>
          </Table>

          {/* Aggregate footer */}
          <div className="border-t bg-muted/30 px-2 py-2 flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
            <span><strong>{agg.skuCount}</strong> items ({agg.standaloneCount} products, {agg.assemblyCount} assemblies)</span>
            <span>Qty: <strong>{fmt.qty(agg.totalQty)}</strong></span>
            <span>CBM: <strong>{agg.totalCbm.toFixed(2)}</strong></span>
            <span>Cost: <strong>{fmt.usd(agg.totalCost)}</strong></span>
            <span>Revenue: <strong>{fmt.usd(agg.totalRevenue)}</strong></span>
            <span>Profit: <strong>{fmt.usd(agg.totalProfit)}</strong></span>
            <span>GPM: <strong>{fmt.pct(agg.weightedGpm)}</strong></span>
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
