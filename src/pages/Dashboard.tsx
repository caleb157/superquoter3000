import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { DashboardTaskWidget } from '@/components/DashboardTaskWidget';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, FolderOpen, Search, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import * as calc from '@/lib/calculations';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  costing: 'bg-amber-100 text-amber-700',
  quoted: 'bg-blue-100 text-blue-700',
  po_confirmed: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-gray-200 text-gray-500',
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [cbmData, setCbmData] = useState<any[]>([]);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [pipelineItems, setPipelineItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<string>('updated_at');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustCompany, setNewCustCompany] = useState('');

  // Extra data for cost calculations
  const [allCogs, setAllCogs] = useState<any[]>([]);
  const [allNuc, setAllNuc] = useState<any[]>([]);
  const [allOh, setAllOh] = useState<any[]>([]);
  const [allShip, setAllShip] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);

  const fetchAll = async () => {
    const [projRes, prodRes, cbmRes, gsRes, custRes, empRes, stRes] = await Promise.all([
      supabase.from('projects').select('*').order('updated_at', { ascending: false }),
      supabase.from('products').select('*'),
      supabase.from('cbm_estimates').select('product_id, final_unit_cbm, total_cbm'),
      supabase.from('global_settings').select('*').limit(1).single(),
      (supabase as any).from('customers').select('*').order('name'),
      supabase.from('labor_employees').select('*'),
      supabase.from('shipping_types').select('*'),
    ]);
    if (projRes.data) setProjects(projRes.data);
    if (prodRes.data) setProducts(prodRes.data);
    if (cbmRes.data) setCbmData(cbmRes.data);
    if (gsRes.data) setGlobalSettings(gsRes.data);
    if (custRes.data) setCustomers(custRes.data);
    if (empRes.data) setEmployees(empRes.data);
    if (stRes.data) setShippingTypes(stRes.data);

    // Fetch per-product cost data
    const productIds = (prodRes.data || []).map((p: any) => p.id);
    if (productIds.length > 0) {
      const [cogsRes, nucRes, ohRes, shipRes] = await Promise.all([
        supabase.from('cogs_items').select('*').in('product_id', productIds),
        supabase.from('non_unit_cogs').select('*').in('product_id', productIds),
        supabase.from('overhead_items').select('*').in('product_id', productIds),
        supabase.from('shipping_items').select('*').in('product_id', productIds),
      ]);
      setAllCogs(cogsRes.data || []);
      setAllNuc(nucRes.data || []);
      setAllOh(ohRes.data || []);
      setAllShip(shipRes.data || []);
    }

    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const exchangeRate = globalSettings?.exchange_rate || 90;
  const cbmMap = useMemo(() => {
    const m: Record<string, any> = {};
    cbmData.forEach(c => { if (c.product_id) m[c.product_id] = c; });
    return m;
  }, [cbmData]);
  const customerMap = useMemo(() => Object.fromEntries(customers.map((c: any) => [c.id, c])), [customers]);

  // Compute per-project aggregates with full cost calculations
  const projectAggregates = useMemo(() => {
    const map: Record<string, { skuCount: number; totalCbm: number; totalCostUsd: number; totalRevenueUsd: number; totalProfitUsd: number }> = {};
    projects.forEach(p => { map[p.id] = { skuCount: 0, totalCbm: 0, totalCostUsd: 0, totalRevenueUsd: 0, totalProfitUsd: 0 }; });

    products.forEach(prod => {
      const agg = map[prod.project_id];
      if (!agg) return;
      agg.skuCount++;

      const cbmEst = cbmMap[prod.id];
      const unitCbm = cbmEst?.final_unit_cbm || 0;
      const qty = prod.quantity || 100;
      agg.totalCbm += unitCbm * qty;

      // COGS
      const pCogs = allCogs.filter((c: any) => c.product_id === prod.id);
      const pNuc = allNuc.filter((c: any) => c.product_id === prod.id);
      const pOh = allOh.filter((c: any) => c.product_id === prod.id);
      const pShip = allShip.filter((c: any) => c.product_id === prod.id);

      const cogsPerUnit = pCogs
        .filter((i: any) => i.include !== 'No')
        .reduce((sum: number, item: any) => sum + calc.calcCogsItemCost({
          include: item.include, components_per_product: item.components_per_product || 0,
          unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0,
        }).unit_cost, 0);

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
      const indirectOhPerMh = globalSettings ? calc.calcIndirectOhPerManHour(globalSettings) : 0;
      const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

      // Shipping
      const shipItem = pShip[0];
      const shipType = shippingTypes.find((s: any) => s.id === shipItem?.shipping_type_id);
      const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
        cost_inr: shipType.cost_inr, per_unit: shipType.per_unit as 'CBM' | 'KG',
        final_unit_cbm: unitCbm, weight_kg: prod.weight_kg || 0,
      }) : 0;

      const markupPercent = prod.markup_percent || 0.2;
      const summary = calc.calcProductCostSummary(
        cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
        shippingPerUnit, markupPercent, exchangeRate, qty
      );

      agg.totalCostUsd += summary.product_cost_per_unit_usd * qty;
      agg.totalRevenueUsd += summary.unit_price_usd * qty;
      agg.totalProfitUsd += (summary.unit_price_usd - summary.product_cost_per_unit_usd) * qty;
    });

    return map;
  }, [projects, products, cbmMap, allCogs, allNuc, allOh, allShip, employees, shippingTypes, globalSettings, exchangeRate]);

  const createCustomer = async () => {
    if (!newCustName.trim()) return;
    const { data, error } = await (supabase as any).from('customers').insert({
      name: newCustName.trim(),
      email: newCustEmail.trim() || null,
      company: newCustCompany.trim() || null,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    setCustomers([...customers, data]);
    setSelectedCustomerId(data.id);
    setShowNewCustomer(false);
    setNewCustName(''); setNewCustEmail(''); setNewCustCompany('');
    toast.success('Customer created');
  };

  const createProject = async () => {
    if (!newName.trim()) return;
    const cust = selectedCustomerId ? customerMap[selectedCustomerId] : null;
    const { error } = await supabase.from('projects').insert({
      name: newName.trim(),
      customer_name: cust?.name || null,
      customer_email: cust?.email || null,
      customer_id: selectedCustomerId || null,
      created_by: user?.id,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success('Project created');
    setNewName(''); setSelectedCustomerId(null); setShowCreate(false);
    fetchAll();
  };

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.customer_name || '').toLowerCase().includes(search.toLowerCase())
  );

  // Pipeline value = sum of all revenue for active projects
  const pipelineValue = useMemo(() => {
    return projects
      .filter(p => ['costing', 'quoted'].includes(p.status))
      .reduce((sum, p) => sum + (projectAggregates[p.id]?.totalRevenueUsd || 0), 0);
  }, [projects, projectAggregates]);

  const stats = {
    total: projects.length,
    active: projects.filter(p => ['costing', 'quoted'].includes(p.status)).length,
    confirmed: projects.filter(p => p.status === 'po_confirmed').length,
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total Projects</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-amber-600">{stats.active}</div>
            <div className="text-xs text-muted-foreground">Active</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-emerald-600">{stats.confirmed}</div>
            <div className="text-xs text-muted-foreground">PO Confirmed</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-primary">{pipelineValue > 0 ? fmt.usd(pipelineValue) : '—'}</div>
            <div className="text-xs text-muted-foreground">Pipeline Value (USD)</div>
          </CardContent></Card>
        </div>

        <DashboardTaskWidget />

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Project</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Project name" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                
                {/* Customer searchable dropdown */}
                <div>
                  <label className="text-xs font-medium mb-1 block">Customer</label>
                  <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal">
                        {selectedCustomerId ? customerMap[selectedCustomerId]?.name : 'Select customer...'}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search customers..." />
                        <CommandList>
                          <CommandEmpty>No customer found.</CommandEmpty>
                          <CommandGroup>
                            {customers.map((c: any) => (
                              <CommandItem key={c.id} value={c.name} onSelect={() => { setSelectedCustomerId(c.id); setCustomerOpen(false); }}>
                                <Check className={cn('mr-2 h-4 w-4', selectedCustomerId === c.id ? 'opacity-100' : 'opacity-0')} />
                                <div>
                                  <div className="text-sm">{c.name}</div>
                                  {c.company && <div className="text-xs text-muted-foreground">{c.company}</div>}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                          <CommandGroup>
                            <CommandItem onSelect={() => { setShowNewCustomer(true); setCustomerOpen(false); }}>
                              <Plus className="mr-2 h-4 w-4" />
                              <span className="text-primary font-medium">+ Add New Customer</span>
                            </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Inline new customer form */}
                {showNewCustomer && (
                  <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                    <p className="text-xs font-medium">New Customer</p>
                    <Input placeholder="Customer name *" value={newCustName} onChange={e => setNewCustName(e.target.value)} className="h-8 text-sm" />
                    <Input placeholder="Company" value={newCustCompany} onChange={e => setNewCustCompany(e.target.value)} className="h-8 text-sm" />
                    <Input placeholder="Email" value={newCustEmail} onChange={e => setNewCustEmail(e.target.value)} className="h-8 text-sm" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={createCustomer} className="h-7 text-xs">Save Customer</Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowNewCustomer(false)} className="h-7 text-xs">Cancel</Button>
                    </div>
                  </div>
                )}

                <Button onClick={createProject} className="w-full">Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Project list */}
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No projects yet. Create your first one!</p>
          </CardContent></Card>
        ) : (
          <div className="border rounded-md overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-2 px-3 font-medium text-xs">Project</th>
                  <th className="text-left py-2 px-3 font-medium text-xs">Customer</th>
                  <th className="text-left py-2 px-3 font-medium text-xs">Status</th>
                  <th className="text-right py-2 px-3 font-medium text-xs">SKUs</th>
                  <th className="text-right py-2 px-3 font-medium text-xs">Total CBM</th>
                  <th className="text-right py-2 px-3 font-medium text-xs">Cost (USD)</th>
                  <th className="text-right py-2 px-3 font-medium text-xs">Revenue (USD)</th>
                  <th className="text-right py-2 px-3 font-medium text-xs">Profit (USD)</th>
                  <th className="text-right py-2 px-3 font-medium text-xs">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const agg = projectAggregates[p.id] || { skuCount: 0, totalCbm: 0, totalCostUsd: 0, totalRevenueUsd: 0, totalProfitUsd: 0 };
                  const custName = p.customer_id ? customerMap[p.customer_id]?.name : p.customer_name;
                  return (
                    <tr key={p.id} className="border-b hover:bg-accent/50 transition-colors cursor-pointer" onClick={() => navigate(`/project/${p.id}`)}>
                      <td className="py-2.5 px-3 font-medium">{p.name}</td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs">{custName || '—'}</td>
                      <td className="py-2.5 px-3">
                        <Badge className={STATUS_COLORS[p.status] || ''} variant="secondary">
                          {p.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">{agg.skuCount || '—'}</td>
                      <td className="py-2.5 px-3 text-right text-xs">{agg.totalCbm > 0 ? fmt.cbm(agg.totalCbm) : '—'}</td>
                      <td className="py-2.5 px-3 text-right text-xs">{agg.totalCostUsd > 0 ? fmt.usd(agg.totalCostUsd) : '—'}</td>
                      <td className="py-2.5 px-3 text-right text-xs">{agg.totalRevenueUsd > 0 ? fmt.usd(agg.totalRevenueUsd) : '—'}</td>
                      <td className="py-2.5 px-3 text-right text-xs">
                        {agg.totalProfitUsd !== 0 ? (
                          <span className={agg.totalProfitUsd > 0 ? 'text-emerald-600' : 'text-destructive'}>
                            {fmt.usd(agg.totalProfitUsd)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">
                        {new Date(p.updated_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
