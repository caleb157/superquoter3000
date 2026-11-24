import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Users, ArrowLeft, Mail, Building2, Linkedin, Upload, FileText, LayoutGrid, List } from 'lucide-react';
import { toast } from 'sonner';
import { CustomerImportDialog } from '@/components/CustomerImportDialog';
import { SalesStageBadge } from '@/components/sales/SalesStageBadge';
import { StageSelect, PICKABLE_STAGES } from '@/components/sales/StageSelect';
import { moveAccountStage } from '@/components/sales/AccountActions';
import { CUSTOMER_GROUPS, SALES_STAGE_LABELS, type SalesStage } from '@/lib/sales/sales-core';
import { CustomersKanban } from '@/components/CustomersKanban';
import { CustomerMetricsCard } from '@/components/CustomerMetricsCard';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { rowNavHandlers } from '@/lib/row-nav';
import { RowContextMenu } from '@/components/RowContextMenu';
import { usePersistentState, useScrollRestoration } from '@/hooks/use-persistent-state';
import { useDocumentTitle } from '@/hooks/use-document-title';


// One status per account: its sales stage (the old lead status is only a database mirror now).
// "Active" = everyone who has answered and is not parked or closed. Prospects (Queued, In outreach) can run to
// hundreds, so only their own tab and All show them.
const ACTIVE_STAGES: string[] = ['responded', 'in_conversation', 'inquiry', 'customer'];
const STATUS_TABS: { value: string; label: string; stages: readonly string[] | null }[] = [
  { value: 'active', label: 'Active', stages: ACTIVE_STAGES },
  ...CUSTOMER_GROUPS.map(g => ({ value: g.key, label: g.label, stages: g.stages })),
  { value: 'all', label: 'All', stages: null },
];




const Customers = () => {
  useDocumentTitle('Customers');
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = usePersistentState<string>('customers.search', '');
  const [statusFilter, setStatusFilter] = usePersistentState<string>('customers.stageGroup', 'active');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [view, setView] = usePersistentState<'list' | 'kanban'>('customers.view', 'list');
  useScrollRestoration('customers.scroll', !loading);
  const [form, setForm] = useState({
    name: '', email: '', company: '', phone: '',
    linkedin_url: '', source: '', sales_stage: 'in_conversation' as SalesStage,
  });
  

  const fetchAll = async () => {
    const [custRes, inqRes] = await Promise.all([
      (supabase as any).from('customers').select('*').order('name'),
      (supabase as any).from('customer_rfqs').select('id, rfq_number, title, customer_id, status, received_date').order('received_date', { ascending: false }),
    ]);
    setCustomers(custRes.data || []);
    setInquiries(inqRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  useKeyboardShortcuts({ onNewItem: () => setShowCreate(true) });

  const inquiriesByCustomer = useMemo(() => {
    const map: Record<string, any[]> = {};
    inquiries.forEach(i => {
      if (i.customer_id) (map[i.customer_id] ||= []).push(i);
    });
    return map;
  }, [inquiries]);

  const tab = STATUS_TABS.find(t => t.value === statusFilter) ?? STATUS_TABS[0];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    STATUS_TABS.forEach(t => { c[t.value] = t.stages ? customers.filter((cu: any) => t.stages!.includes(cu.sales_stage)).length : customers.length; });
    return c;
  }, [customers]);

  const updateStage = async (customerId: string, next: SalesStage) => {
    const account = customers.find((c: any) => c.id === customerId);
    if (!account) return;
    // Same move as the Sales tab: Not now gets its ~6 month date, the database logs the move and mirrors lead_status.
    setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, sales_stage: next } : c));
    if (!(await moveAccountStage(account, next))) { fetchAll(); return; }
    fetchAll();
  };

  const filtered = customers.filter((c: any) => {
    if (tab.stages && !tab.stages.includes(c.sales_stage)) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q)
      || (c.company || '').toLowerCase().includes(q)
      || (c.email || '').toLowerCase().includes(q);
  });

  const resetForm = () => setForm({ name: '', email: '', company: '', phone: '', linkedin_url: '', source: '', sales_stage: 'in_conversation' });

  const createCustomer = async () => {
    const company = form.company.trim();
    if (!company) return;
    const contactName = form.name.trim();
    const { error } = await (supabase as any).from('customers').insert({
      name: contactName || company,
      email: form.email.trim() || null,
      company,
      phone: form.phone.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      source: form.source.trim() || null,
      sales_stage: form.sales_stage,
      ...(form.sales_stage === 'not_now' ? { not_now_until: new Date(Date.now() + 182 * 86_400_000).toISOString().slice(0, 10) } : {}),
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Customer created');
    resetForm();
    setShowCreate(false);
    fetchAll();
  };


  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="page-title">Customers</h1>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Import CSV</span>
            </Button>
            <Dialog open={showCreate} onOpenChange={(v) => { setShowCreate(v); if (!v) resetForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">Add Customer</span><span className="sm:hidden">Add</span></Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Company *" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} autoFocus />
                  <Input placeholder="Contact name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  <Input placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                  <Input placeholder="LinkedIn URL" value={form.linkedin_url} onChange={e => setForm(f => ({ ...f, linkedin_url: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Source (Apollo, Referral...)" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} />
                    <Select value={form.sales_stage} onValueChange={(v) => setForm(f => ({ ...f, sales_stage: v as SalesStage }))}>
                      <SelectTrigger aria-label="Sales stage"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PICKABLE_STAGES.map(s => (
                          <SelectItem key={s} value={s}>{SALES_STAGE_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={createCustomer} className="w-full">Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <CustomerMetricsCard customers={customers as any} />

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <div className="flex border rounded-md overflow-hidden">
            <Button
              variant={view === 'list' ? 'secondary' : 'ghost'}
              size="sm" className="h-9 rounded-none gap-1.5"
              onClick={() => setView('list')}
            ><List className="h-4 w-4" /> <span className="hidden sm:inline">List</span></Button>
            <Button
              variant={view === 'kanban' ? 'secondary' : 'ghost'}
              size="sm" className="h-9 rounded-none gap-1.5"
              onClick={() => setView('kanban')}
            ><LayoutGrid className="h-4 w-4" /> <span className="hidden sm:inline">Kanban</span></Button>
          </div>
        </div>

        {view === 'list' && (
          <Tabs value={statusFilter} onValueChange={setStatusFilter}>
            <TabsList className="w-full sm:w-auto overflow-x-auto flex justify-start">
              {STATUS_TABS.map(t => (
                <TabsTrigger key={t.value} value={t.value} className="text-xs gap-1.5 shrink-0">
                  {t.label}
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{counts[t.value] ?? 0}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : view === 'kanban' ? (
          <CustomersKanban
            customers={customers as any}
            inquiriesByCustomer={inquiriesByCustomer}
            onStageChange={updateStage}
            onOpenCustomer={(id) => navigate(`/customers/${id}`)}
          />
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No customers match this filter.</p>
            {tab.value === 'prospects' && <p className="text-xs mt-1">Prospects you are working are in Sales &gt; Pipeline; the whole list is in Sales &gt; Prospects.</p>}
          </CardContent></Card>
        ) : (
          <>
            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Company</TableHead>
                      <TableHead className="text-xs w-[170px]">Sales stage</TableHead>
                      <TableHead className="text-xs">Contact</TableHead>
                      <TableHead className="text-xs">Email</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="text-xs text-right">Inquiries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c: any) => {
                      const primary = c.company || c.name;
                      const secondary = c.company && c.name && c.name !== c.company ? c.name : null;
                      const navHandlers = rowNavHandlers(navigate, `/customers/${c.id}`, { from: { label: 'Customers', path: '/customers' } });
                      return (
                      <RowContextMenu key={c.id} path={`/customers/${c.id}`}>
                      <TableRow className="cursor-pointer hover:bg-muted/40" {...navHandlers}>
                        <TableCell className="font-medium text-sm">
                          <span className="hover:underline">{primary}</span>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <StageSelect stage={c.sales_stage} dnc={c.dnc} onChange={(v) => updateStage(c.id, v)} />
                          {c.sales_stage === 'not_now' && c.not_now_until && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">until {c.not_now_until}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{secondary || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.email || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.source || '—'}</TableCell>
                        <TableCell className="text-xs text-right">{(inquiriesByCustomer[c.id] || []).length}</TableCell>
                      </TableRow>
                      </RowContextMenu>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="md:hidden space-y-2">
              {filtered.map((c: any) => {
                const inqCount = (inquiriesByCustomer[c.id] || []).length;
                return (
                  <Card key={c.id} className="active:bg-accent/50">
                    <CardContent className="p-3 space-y-2">
                      <RowContextMenu path={`/customers/${c.id}`}>
                      <div className="flex items-start justify-between gap-2 cursor-pointer" {...rowNavHandlers(navigate, `/customers/${c.id}`, { from: { label: 'Customers', path: '/customers' } })}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{c.company || c.name}</div>
                          {c.company && c.name && c.name !== c.company && (
                            <div className="text-xs text-muted-foreground truncate">{c.name}</div>
                          )}
                        </div>
                        <SalesStageBadge stage={c.sales_stage} />
                      </div>
                      </RowContextMenu>
                      <div className="flex items-center gap-2">
                        <StageSelect stage={c.sales_stage} dnc={c.dnc} onChange={(v) => updateStage(c.id, v)} className="flex-1 w-auto" />
                        <span className="shrink-0 text-xs text-muted-foreground"><FileText className="inline h-3 w-3 mr-0.5" />{inqCount}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      <CustomerImportDialog open={showImport} onOpenChange={setShowImport} onImported={fetchAll} />
      
    </AppLayout>
  );
};

export default Customers;
