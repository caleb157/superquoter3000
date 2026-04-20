import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';
import { DashboardTaskWidget } from '@/components/DashboardTaskWidget';
import {
  productWeight,
  furthestStageBucket,
  STAGE_BUCKET_ORDER,
  STAGE_BUCKET_LABELS,
  STAGE_BUCKET_COLOR,
  type StageBucket,
} from '@/lib/pipeline-weights';

const INQUIRY_STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-200 text-gray-600',
  po: 'bg-emerald-100 text-emerald-700',
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [cbmData, setCbmData] = useState<any[]>([]);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [allCogs, setAllCogs] = useState<any[]>([]);
  const [allNuc, setAllNuc] = useState<any[]>([]);
  const [allOh, setAllOh] = useState<any[]>([]);
  const [allShip, setAllShip] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [inq, prod, cust, cbm, gs, cogs, nuc, oh, ship, emp, st] = await Promise.all([
        supabase.from('customer_rfqs').select('*').order('updated_at', { ascending: false }),
        supabase.from('products').select('*'),
        supabase.from('customers').select('id, name, company'),
        supabase.from('cbm_estimates').select('product_id, final_unit_cbm, total_cbm'),
        supabase.from('global_settings').select('*').limit(1).maybeSingle(),
        supabase.from('cogs_items').select('*'),
        supabase.from('non_unit_cogs').select('*'),
        supabase.from('overhead_items').select('*'),
        supabase.from('shipping_items').select('*'),
        supabase.from('labor_employees').select('*'),
        supabase.from('shipping_types').select('*'),
      ]);
      setInquiries(inq.data || []);
      setProducts(prod.data || []);
      setCustomers(cust.data || []);
      setCbmData(cbm.data || []);
      setGlobalSettings(gs.data);
      setAllCogs(cogs.data || []);
      setAllNuc(nuc.data || []);
      setAllOh(oh.data || []);
      setAllShip(ship.data || []);
      setEmployees(emp.data || []);
      setShippingTypes(st.data || []);
      setLoading(false);
    })();
  }, []);

  const exchangeRate = globalSettings?.exchange_rate || 90;
  const cbmMap = useMemo(() => {
    const m: Record<string, any> = {};
    cbmData.forEach(c => { if (c.product_id) m[c.product_id] = c; });
    return m;
  }, [cbmData]);
  const customerMap = useMemo(
    () => Object.fromEntries(customers.map(c => [c.id, c])),
    [customers],
  );
  const inquiryMap = useMemo(
    () => Object.fromEntries(inquiries.map(i => [i.id, i])),
    [inquiries],
  );

  // Per-product FOB cost (USD total)
  const productFob = useMemo(() => {
    const map: Record<string, { unit_cost_usd: number; total_cost_usd: number }> = {};
    if (!globalSettings) return map;
    products.forEach(prod => {
      try {
        const cbmEst = cbmMap[prod.id];
        const unitCbm = cbmEst?.final_unit_cbm || 0;
        const qty = prod.quantity || 100;

        const pCogs = allCogs.filter(c => c.product_id === prod.id);
        const pNuc = allNuc.filter(c => c.product_id === prod.id);
        const pOh = allOh.filter(c => c.product_id === prod.id);
        const pShip = allShip.filter(c => c.product_id === prod.id);

        const cogsPerUnit = pCogs
          .filter(i => i.include !== 'No')
          .reduce(
            (sum, item) =>
              sum +
              calc.calcCogsItemCost({
                include: item.include,
                components_per_product: item.components_per_product || 0,
                unit_cost_inr: item.unit_cost_inr || 0,
                waste_factor: item.waste_factor || 0,
              }).unit_cost,
            0,
          );

        const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
          pNuc.map(i => ({
            include: i.include,
            total_quantity: i.total_quantity,
            cost_each_inr: i.cost_each_inr,
          })),
          qty,
        );

        const ohItems = pOh.map(item => ({
          include: item.include,
          labor_type: item.labor_type,
          man_hours_per_unit: item.man_hours_per_unit || 0,
          hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
        }));
        const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
        const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
        const indirectOhPerMh = calc.calcIndirectOhPerManHour(globalSettings);
        const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

        const shipItem = pShip[0];
        const shipType = shippingTypes.find(s => s.id === shipItem?.shipping_type_id);
        const shippingPerUnit = shipType
          ? calc.calcShippingPerUnit({
              cost_inr: shipType.cost_inr,
              per_unit: shipType.per_unit as 'CBM' | 'KG',
              final_unit_cbm: unitCbm,
              weight_kg: prod.weight_kg || 0,
            })
          : 0;

        const markupPercent = prod.markup_percent || 0.2;
        const summary = calc.calcProductCostSummary(
          cogsPerUnit,
          nonUnitCogsPerUnit,
          directOhPerUnit,
          indirectOhPerUnit,
          shippingPerUnit,
          markupPercent,
          exchangeRate,
          qty,
        );
        const unit = summary.product_cost_per_unit_usd || 0;
        map[prod.id] = { unit_cost_usd: unit, total_cost_usd: unit * qty };
      } catch {
        map[prod.id] = { unit_cost_usd: 0, total_cost_usd: 0 };
      }
    });
    return map;
  }, [products, cbmMap, allCogs, allNuc, allOh, allShip, employees, shippingTypes, globalSettings, exchangeRate]);

  // Stats
  const activeInquiries = inquiries.filter(i => i.status !== 'cancelled').length;
  const poInquiries = inquiries.filter(i => i.status === 'po').length;
  const activeProducts = products.filter(
    p => p.design_stage || p.quote_stage || p.sample_stage,
  ).length;
  const weightedPipeline = products.reduce((sum, p) => {
    const fob = productFob[p.id]?.total_cost_usd || 0;
    const inq = inquiryMap[p.customer_rfq_id];
    return sum + fob * productWeight(p, inq?.status);
  }, 0);

  // Portfolio by stage
  const stageCounts = useMemo(() => {
    const counts = {} as Record<StageBucket, number>;
    STAGE_BUCKET_ORDER.forEach(b => (counts[b] = 0));
    products.forEach(p => {
      const inq = inquiryMap[p.customer_rfq_id];
      counts[furthestStageBucket(p, inq?.status)]++;
    });
    return counts;
  }, [products, inquiryMap]);
  const maxStageCount = Math.max(1, ...Object.values(stageCounts));

  // Product counts per inquiry
  const productsByInquiry = useMemo(() => {
    const m: Record<string, number> = {};
    products.forEach(p => {
      if (p.customer_rfq_id) m[p.customer_rfq_id] = (m[p.customer_rfq_id] || 0) + 1;
    });
    return m;
  }, [products]);

  const recentInquiries = useMemo(
    () => inquiries.filter(i => i.status !== 'cancelled').slice(0, 8),
    [inquiries],
  );

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Active Inquiries" value={activeInquiries} />
          <StatCard label="Active Products" value={activeProducts} />
          <StatCard label="PO Inquiries" value={poInquiries} />
          <StatCard label="Weighted Pipeline" value={fmt.usd(weightedPipeline)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Portfolio by Stage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {STAGE_BUCKET_ORDER.map(bucket => {
                const count = stageCounts[bucket];
                const pct = (count / maxStageCount) * 100;
                return (
                  <button
                    key={bucket}
                    onClick={() => navigate(`/inquiries?stage_bucket=${bucket}`)}
                    className="flex items-center gap-2 w-full text-left hover:bg-muted/50 px-1 py-0.5 rounded transition"
                  >
                    <div className="w-32 text-xs text-muted-foreground shrink-0">
                      {STAGE_BUCKET_LABELS[bucket]}
                    </div>
                    <div className="flex-1 h-4 bg-muted/40 rounded overflow-hidden">
                      <div
                        className={cn('h-full rounded', STAGE_BUCKET_COLOR[bucket])}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="w-8 text-xs font-medium tabular-nums text-right">{count}</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <DashboardTaskWidget />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Inquiries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : recentInquiries.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No inquiries yet.</div>
            ) : (
              <div className="divide-y">
                {recentInquiries.map(inq => {
                  const cust = inq.customer_id ? customerMap[inq.customer_id] : null;
                  return (
                    <Link
                      key={inq.id}
                      to={`/inquiry/${inq.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition text-sm"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          <span className="text-muted-foreground mr-2">{inq.rfq_number}</span>
                          {inq.title || 'Untitled'}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {cust?.name || cust?.company || '—'}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-[11px] font-medium',
                          INQUIRY_STATUS_COLORS[inq.status] || 'bg-muted',
                        )}
                      >
                        {inq.status}
                      </span>
                      <div className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                        {productsByInquiry[inq.id] || 0} prod
                      </div>
                      <div className="text-xs text-muted-foreground w-24 text-right hidden sm:block">
                        {formatDistanceToNow(new Date(inq.updated_at), { addSuffix: true })}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

export default Dashboard;
