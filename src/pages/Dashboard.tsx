import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpDown, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<string>('updated_at');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCustomerId, setFilterCustomerId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
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

  const quoteDeadlineMap = useMemo(() => ({} as Record<string, string | null>), []);

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

  const filtered = useMemo(() => {
    let list = projects.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.customer_name || '').toLowerCase().includes(search.toLowerCase())
    );
    if (filterCustomerId !== 'all') {
      list = list.filter(p => p.customer_id === filterCustomerId);
    }
    if (filterStatus !== 'all') {
      list = list.filter(p => p.status === filterStatus);
    }

    // Sort
    list = [...list].sort((a, b) => {
      let va: any, vb: any;
      const aggA = projectAggregates[a.id];
      const aggB = projectAggregates[b.id];
      switch (sortField) {
        case 'name': va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
        case 'customer': va = (a.customer_name || '').toLowerCase(); vb = (b.customer_name || '').toLowerCase(); break;
        case 'status': va = a.status; vb = b.status; break;
        case 'skus': va = aggA?.skuCount || 0; vb = aggB?.skuCount || 0; break;
        case 'cbm': va = aggA?.totalCbm || 0; vb = aggB?.totalCbm || 0; break;
        case 'cost': va = aggA?.totalCostUsd || 0; vb = aggB?.totalCostUsd || 0; break;
        case 'revenue': va = aggA?.totalRevenueUsd || 0; vb = aggB?.totalRevenueUsd || 0; break;
        case 'profit': va = aggA?.totalProfitUsd || 0; vb = aggB?.totalProfitUsd || 0; break;
        case 'quote_deadline': va = quoteDeadlineMap[a.id] || '9999'; vb = quoteDeadlineMap[b.id] || '9999'; break;
        default: va = a.updated_at; vb = b.updated_at; break;
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    return list;
  }, [projects, search, filterCustomerId, filterStatus, sortField, sortAsc, projectAggregates, quoteDeadlineMap]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const stats = {
    total: projects.length,
    active: projects.filter(p => ['costing', 'quoted'].includes(p.status)).length,
    confirmed: projects.filter(p => p.status === 'po_confirmed').length,
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
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
        </div>

        {/* Task widget and weighted pipeline will be rebuilt in Phases 3 + 6 */}

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
          <Select value={filterCustomerId} onValueChange={setFilterCustomerId}>
            <SelectTrigger className="w-48 h-9 text-sm">
              <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {customers.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 h-9 text-sm">
              <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="costing">Costing</SelectItem>
              <SelectItem value="quoted">Quoted</SelectItem>
              <SelectItem value="po_confirmed">PO Confirmed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
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
                  {[
                    { key: 'name', label: 'Project', align: 'left' },
                    { key: 'customer', label: 'Customer', align: 'left' },
                    { key: 'status', label: 'Status', align: 'left' },
                    { key: 'quote_deadline', label: 'Quote Deadline', align: 'left' },
                    { key: 'skus', label: 'SKUs', align: 'right' },
                    { key: 'cbm', label: 'Total CBM', align: 'right' },
                    { key: 'cost', label: 'Cost (USD)', align: 'right' },
                    { key: 'revenue', label: 'Revenue (USD)', align: 'right' },
                    { key: 'profit', label: 'Profit (USD)', align: 'right' },
                    { key: 'updated_at', label: 'Updated', align: 'right' },
                  ].map(col => (
                    <th
                      key={col.key}
                      className={cn(
                        'py-2 px-3 font-medium text-xs cursor-pointer hover:text-foreground select-none',
                        col.align === 'right' ? 'text-right' : 'text-left'
                      )}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortField === col.key && <ArrowUpDown className="h-3 w-3" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const agg = projectAggregates[p.id] || { skuCount: 0, totalCbm: 0, totalCostUsd: 0, totalRevenueUsd: 0, totalProfitUsd: 0 };
                  const custName = p.customer_id ? customerMap[p.customer_id]?.name : p.customer_name;
                  const deadline = quoteDeadlineMap[p.id];
                  const deadlineDays = deadline ? Math.floor((new Date(deadline).getTime() - Date.now()) / 86400000) : null;
                  return (
                    <tr key={p.id} className="border-b hover:bg-accent/50 transition-colors cursor-pointer" onClick={() => navigate(`/project/${p.id}`)}>
                      <td className="py-2.5 px-3 font-medium">{p.name}</td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs">{custName || '—'}</td>
                      <td className="py-2.5 px-3">
                        <Badge className={STATUS_COLORS[p.status] || ''} variant="secondary">
                          {p.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        {deadline ? (
                          <span className={cn(
                            'font-medium',
                            deadlineDays !== null && deadlineDays < 0 ? 'text-destructive' :
                            deadlineDays !== null && deadlineDays <= 3 ? 'text-amber-600' : 'text-muted-foreground'
                          )}>
                            {new Date(deadline).toLocaleDateString()}
                          </span>
                        ) : '—'}
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
