import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import * as calc from '@/lib/calculations';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Upload } from 'lucide-react';
import { fmt } from '@/lib/formatters';
import { UploadParseDialog } from '@/components/UploadParseDialog';
import { SortableHeader } from '@/components/SortableHeader';
import { ProductStatusIndicator, getStatusLevel } from '@/components/ProductStatusIndicator';
import { useTableSort } from '@/hooks/use-table-sort';

const Products = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [cbmMap, setCbmMap] = useState<Record<string, any>>({});
  const [cogsMap, setCogsMap] = useState<Record<string, any[]>>({});
  const [ohMap, setOhMap] = useState<Record<string, any[]>>({});
  const [costDataMap, setCostDataMap] = useState<Record<string, { cost_usd: number; price_usd: number }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterProject, setFilterProject] = useState('all');
  const [filterCustomer, setFilterCustomer] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showUploadParse, setShowUploadParse] = useState(false);
  const [uploadProjectId, setUploadProjectId] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<any>({
    storageKey: 'products-sort',
  });

  useEffect(() => {
    const fetchAll = async () => {
      const [prodRes, projRes, custRes, typesRes, cbmRes, cogsRes, ohRes, gsRes, empRes, stRes, nucRes, shipRes, psRes] = await Promise.all([
        supabase.from('products').select('*').order('created_at', { ascending: false }),
        supabase.from('projects').select('*'),
        supabase.from('customers').select('*'),
        supabase.from('product_types').select('*'),
        supabase.from('cbm_estimates').select('*'),
        supabase.from('cogs_items').select('*'),
        supabase.from('overhead_items').select('*'),
        supabase.from('global_settings').select('*').limit(1).single(),
        supabase.from('labor_employees').select('*'),
        supabase.from('shipping_types').select('*'),
        supabase.from('non_unit_cogs').select('*'),
        supabase.from('shipping_items').select('*'),
        supabase.from('project_settings').select('*'),
      ]);
      const prods = prodRes.data || [];
      const gs = gsRes.data;
      const employees = empRes.data || [];
      const shTypes = stRes.data || [];
      const allNuc = nucRes.data || [];
      const allShip = shipRes.data || [];
      const allCogs = cogsRes.data || [];
      const allOh = ohRes.data || [];
      const allCbm = cbmRes.data || [];
      const allPs = psRes.data || [];

      setProducts(prods);
      if (projRes.data) setProjects(projRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (typesRes.data) setProductTypes(typesRes.data);

      const cbm: Record<string, any> = {};
      allCbm.forEach((c: any) => { if (c.product_id) cbm[c.product_id] = c; });
      setCbmMap(cbm);

      const cogsM: Record<string, any[]> = {};
      allCogs.forEach((c: any) => { if (c.product_id) { if (!cogsM[c.product_id]) cogsM[c.product_id] = []; cogsM[c.product_id].push(c); } });
      setCogsMap(cogsM);

      const ohM: Record<string, any[]> = {};
      allOh.forEach((o: any) => { if (o.product_id) { if (!ohM[o.product_id]) ohM[o.product_id] = []; ohM[o.product_id].push(o); } });
      setOhMap(ohM);

      // Build per-project settings map
      const psMap: Record<string, any> = {};
      allPs.forEach((s: any) => { psMap[s.project_id] = s; });

      // Compute cost/price per product
      const cMap: Record<string, { cost_usd: number; price_usd: number }> = {};
      prods.forEach((p: any) => {
        const cbmEst = cbm[p.id];
        const pCogs = cogsM[p.id] || [];
        const pNuc = allNuc.filter((c: any) => c.product_id === p.id);
        const pOh = ohM[p.id] || [];
        const pShip = allShip.filter((c: any) => c.product_id === p.id);
        const ps = psMap[p.project_id];
        const qty = p.quantity || 100;
        const unit_cbm = cbmEst?.final_unit_cbm || 0;
        const exchangeRate = (ps && !ps.use_global_exchange_rate && ps.exchange_rate_override) ? ps.exchange_rate_override : (gs?.exchange_rate || 90);

        const cogsPerUnit = pCogs.filter((i: any) => i.include !== 'No').reduce((sum: number, item: any) => {
          const c = calc.calcCogsItemCost({ include: item.include, components_per_product: item.components_per_product || 0, unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0 });
          return sum + c.unit_cost;
        }, 0);
        const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(pNuc.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr })), qty);
        const ohItems = pOh.map((item: any) => ({ include: item.include, labor_type: item.labor_type, man_hours_per_unit: item.man_hours_per_unit || 0, hourly_rate: calc.avgRateByDesignation(employees, item.labor_type) }));
        const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
        const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
        const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs as any) : 0;
        const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);
        const shipItem = pShip[0];
        const shipType = shTypes.find((s: any) => s.id === shipItem?.shipping_type_id);
        const shippingPerUnit = shipType ? calc.calcShippingPerUnit({ cost_inr: shipType.cost_inr, per_unit: shipType.per_unit as 'CBM' | 'KG', final_unit_cbm: unit_cbm, weight_kg: p.weight_kg || 0 }) : 0;
        const markupPercent = (ps?.apply_uniform_markup && ps.default_markup_override != null) ? ps.default_markup_override : (p.markup_percent || 0.2);
        const summary = calc.calcProductCostSummary(cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit, shippingPerUnit, markupPercent, exchangeRate, qty);
        cMap[p.id] = { cost_usd: summary.product_cost_per_unit_usd, price_usd: summary.unit_price_usd };
      });
      setCostDataMap(cMap);

      setLoading(false);
    };
    fetchAll();
  }, []);

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]));

  const hasReview = (productId: string) => {
    const cogs = cogsMap[productId] || [];
    const oh = ohMap[productId] || [];
    return cogs.some((c: any) => c.include === 'Review') || oh.some((o: any) => o.include === 'Review');
  };

  const filtered = useMemo(() => {
    let result = products.filter(p => {
      if (search) {
        const s = search.toLowerCase();
        if (!(p.name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s))) return false;
      }
      if (filterProject !== 'all' && p.project_id !== filterProject) return false;
      if (filterType !== 'all' && p.product_type_id !== filterType) return false;
      if (filterCustomer !== 'all') {
        const proj = projectMap[p.project_id];
        if (!proj || proj.customer_id !== filterCustomer) return false;
      }
      if (filterStatus !== 'all') {
        const flags = [p.cbm_done, p.cogs_done, p.overhead_done, p.shipping_done, p.revenue_done];
        const done = flags.filter(Boolean).length;
        switch (filterStatus) {
          case 'complete': if (done !== 5) return false; break;
          case 'in_progress': if (done === 0 || done === 5) return false; break;
          case 'not_started': if (done !== 0) return false; break;
          case 'needs_review': if (!hasReview(p.id)) return false; break;
        }
      }
      return true;
    });

    const getters: Record<string, (p: any) => string | number> = {
      product: (p) => (p.name || '').toLowerCase(),
      sku: (p) => (p.sku || '').toLowerCase(),
      project: (p) => (projectMap[p.project_id]?.name || '').toLowerCase(),
      customer: (p) => {
        const proj = projectMap[p.project_id];
        const cust = proj?.customer_id ? customerMap[proj.customer_id] : null;
        return (cust?.name || proj?.customer_name || '').toLowerCase();
      },
      qty: (p) => p.quantity || 0,
      unit_cbm: (p) => cbmMap[p.id]?.final_unit_cbm || 0,
      cost: (p) => 0,
      price: (p) => 0,
      status: (p) => getStatusLevel(p),
    };

    result = sortItems(result, getters);
    return result;
  }, [products, search, filterProject, filterType, filterCustomer, filterStatus, sortColumn, sortDirection, projectMap, customerMap, cbmMap]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">All Products</h1>
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => setShowProjectPicker(true)}>
            <Upload className="h-3 w-3" /> Upload & Parse
          </Button>
        </div>

        <Dialog open={showProjectPicker} onOpenChange={setShowProjectPicker}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Select Project</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground">Choose which project to add parsed products to:</p>
            <Select value={uploadProjectId} onValueChange={setUploadProjectId}>
              <SelectTrigger><SelectValue placeholder="Select a project..." /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button disabled={!uploadProjectId} onClick={() => { setShowProjectPicker(false); setShowUploadParse(true); }}>
              Continue
            </Button>
          </DialogContent>
        </Dialog>

        {uploadProjectId && (
          <UploadParseDialog
            open={showUploadParse}
            onOpenChange={setShowUploadParse}
            projectId={uploadProjectId}
            productTypes={productTypes}
            onProductsCreated={() => {
              setUploadProjectId('');
              supabase.from('products').select('*').order('created_at', { ascending: false }).then(({ data }) => { if (data) setProducts(data); });
            }}
          />
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCustomer} onValueChange={setFilterCustomer}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Customers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {productTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="not_started">Not Started</SelectItem>
              <SelectItem value="needs_review">Needs Review</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : (
          <div className="border rounded-md overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <SortableHeader column="product" label="Product" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableHeader column="sku" label="SKU" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableHeader column="project" label="Project" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableHeader column="customer" label="Customer" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableHeader column="qty" label="Qty" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                  <SortableHeader column="unit_cbm" label="Unit CBM" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                  <SortableHeader column="cost" label="Cost ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                  <SortableHeader column="price" label="Price ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                  <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-center" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => {
                  const proj = projectMap[p.project_id];
                  const cust = proj?.customer_id ? customerMap[proj.customer_id] : null;
                  const cbm = cbmMap[p.id];
                  const review = hasReview(p.id);
                  return (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/product/${p.id}`)}>
                      <TableCell>
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={p.photo_url || ''} />
                          <AvatarFallback className="text-[10px]">{p.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{p.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.sku || '—'}</TableCell>
                      <TableCell>
                        <span className="text-xs text-primary hover:underline" onClick={e => { e.stopPropagation(); if (proj) navigate(`/project/${proj.id}`); }}>
                          {proj?.name || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{cust?.name || proj?.customer_name || '—'}</TableCell>
                      <TableCell className="text-right text-xs">{fmt.qty(p.quantity)}</TableCell>
                      <TableCell className="text-right text-xs">{cbm?.final_unit_cbm ? fmt.cbm(cbm.final_unit_cbm) : '—'}</TableCell>
                      <TableCell className="text-right text-xs">—</TableCell>
                      <TableCell className="text-right text-xs">—</TableCell>
                      <TableCell className="text-center">
                        <ProductStatusIndicator
                          cbm_done={p.cbm_done}
                          cogs_done={p.cogs_done}
                          overhead_done={p.overhead_done}
                          shipping_done={p.shipping_done}
                          revenue_done={p.revenue_done}
                          hasReview={review}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No products found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Products;
