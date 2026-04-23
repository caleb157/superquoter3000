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
import { LeadStatusBadge, LEAD_STATUS_LABELS, LEAD_STATUS_ORDER, type LeadStatus } from '@/components/LeadStatusBadge';
import { CustomersKanban } from '@/components/CustomersKanban';
import { CustomerMetricsCard } from '@/components/CustomerMetricsCard';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';


const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'lead', label: 'Leads' },
  { value: 'active', label: 'Live Inquiry' },
  { value: 'won', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'churned', label: 'Churned' },
];

const INQUIRY_STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-200 text-gray-600',
  po: 'bg-emerald-100 text-emerald-700',
};

const Customers = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [form, setForm] = useState({
    name: '', email: '', company: '', phone: '',
    linkedin_url: '', source: '', lead_status: 'lead',
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

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: customers.length, lead: 0, active: 0, won: 0, inactive: 0, churned: 0 };
    customers.forEach((cu: any) => { c[cu.lead_status || 'lead'] = (c[cu.lead_status || 'lead'] || 0) + 1; });
    return c;
  }, [customers]);

  const updateStatus = async (customerId: string, next: LeadStatus) => {
    // Optimistic
    setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, lead_status: next } : c));
    const { error } = await (supabase as any).from('customers').update({ lead_status: next }).eq('id', customerId);
    if (error) {
      toast.error(error.message);
      fetchAll();
    } else {
      toast.success(`Marked as ${LEAD_STATUS_LABELS[next]}`);
    }
  };

  const filtered = customers.filter((c: any) => {
    if (statusFilter !== 'all' && (c.lead_status || 'lead') !== statusFilter) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q)
      || (c.company || '').toLowerCase().includes(q)
      || (c.email || '').toLowerCase().includes(q);
  });

  const resetForm = () => setForm({ name: '', email: '', company: '', phone: '', linkedin_url: '', source: '', lead_status: 'lead' });

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
      lead_status: form.lead_status,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Customer created');
    resetForm();
    setShowCreate(false);
    fetchAll();
  };


  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-bold">Customers</h1>
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
                    <Select value={form.lead_status} onValueChange={(v) => setForm(f => ({ ...f, lead_status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LEAD_STATUS_ORDER.map(s => (
                          <SelectItem key={s} value={s}>{LEAD_STATUS_LABELS[s]}</SelectItem>
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
            onStatusChange={updateStatus}
            onOpenCustomer={(id) => navigate(`/customers/${id}`)}
          />
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No customers match this filter.</p>
          </CardContent></Card>
        ) : (
          <>
            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Company</TableHead>
                      <TableHead className="text-xs w-[160px]">Status</TableHead>
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
                      return (
                      <TableRow key={c.id} className="hover:bg-muted/40">
                        <TableCell className="font-medium text-sm">
                          <button className="hover:underline text-left" onClick={() => navigate(`/customers/${c.id}`)}>
                            {primary}
                          </button>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={c.lead_status || 'lead'}
                            onValueChange={(v) => updateStatus(c.id, v as LeadStatus)}
                          >
                            <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {LEAD_STATUS_ORDER.map(s => (
                                <SelectItem key={s} value={s}>{LEAD_STATUS_LABELS[s]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>{secondary || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>{c.email || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>{c.source || '—'}</TableCell>
                        <TableCell className="text-xs text-right cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>{(inquiriesByCustomer[c.id] || []).length}</TableCell>
                      </TableRow>
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
                      <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{c.company || c.name}</div>
                          {c.company && c.name && c.name !== c.company && (
                            <div className="text-xs text-muted-foreground truncate">{c.name}</div>
                          )}
                        </div>
                        <LeadStatusBadge status={c.lead_status} />
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={c.lead_status || 'lead'}
                          onValueChange={(v) => updateStatus(c.id, v as LeadStatus)}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {LEAD_STATUS_ORDER.map(s => (
                              <SelectItem key={s} value={s}>{LEAD_STATUS_LABELS[s]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
