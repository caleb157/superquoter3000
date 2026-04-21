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
import { Plus, Search, Users, ArrowLeft, Mail, Building2, Linkedin, Upload, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { CustomerImportDialog } from '@/components/CustomerImportDialog';
import { LeadStatusBadge } from '@/components/LeadStatusBadge';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'lead', label: 'Leads' },
  { value: 'active', label: 'Active' },
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
  const [form, setForm] = useState({
    name: '', email: '', company: '', phone: '',
    linkedin_url: '', source: '', lead_status: 'lead',
  });
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

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

  const inquiriesByCustomer = useMemo(() => {
    const map: Record<string, any[]> = {};
    inquiries.forEach(i => {
      if (i.customer_id) (map[i.customer_id] ||= []).push(i);
    });
    return map;
  }, [inquiries]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: customers.length, lead: 0, active: 0, inactive: 0, churned: 0 };
    customers.forEach((cu: any) => { c[cu.lead_status || 'lead'] = (c[cu.lead_status || 'lead'] || 0) + 1; });
    return c;
  }, [customers]);

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
    if (!form.name.trim()) return;
    const { error } = await (supabase as any).from('customers').insert({
      name: form.name.trim(),
      email: form.email.trim() || null,
      company: form.company.trim() || null,
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

  // Detail view
  if (selectedCustomer) {
    const custInquiries = inquiriesByCustomer[selectedCustomer.id] || [];
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto space-y-4">
          <Button variant="ghost" size="sm" className="gap-1.5 mb-2" onClick={() => setSelectedCustomer(null)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Customers
          </Button>

          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{selectedCustomer.name}</h1>
                <LeadStatusBadge status={selectedCustomer.lead_status} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                {selectedCustomer.company && <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{selectedCustomer.company}</span>}
                {selectedCustomer.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{selectedCustomer.email}</span>}
                {selectedCustomer.linkedin_url && (
                  <a href={selectedCustomer.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
                    <Linkedin className="h-3.5 w-3.5" />LinkedIn
                  </a>
                )}
                {selectedCustomer.source && <span>Source: {selectedCustomer.source}</span>}
              </div>
            </div>
          </div>

          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mt-6 flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" /> Inquiries ({custInquiries.length})
          </h2>
          {custInquiries.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No inquiries yet.</CardContent></Card>
          ) : (
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">CRFQ</TableHead>
                  <TableHead className="text-xs">Title</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Received</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {custInquiries.map((i: any) => (
                    <TableRow key={i.id} className="cursor-pointer" onClick={() => navigate(`/inquiry/${i.id}`)}>
                      <TableCell className="font-mono text-xs">{i.rfq_number}</TableCell>
                      <TableCell className="text-sm">{i.title || '—'}</TableCell>
                      <TableCell><Badge className={INQUIRY_STATUS_COLORS[i.status] || ''} variant="secondary">{i.status}</Badge></TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {new Date(i.received_date).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}

        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-bold">Customers</h1>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
            <Dialog open={showCreate} onOpenChange={(v) => { setShowCreate(v); if (!v) resetForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Customer</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                  <Input placeholder="Company" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
                  <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  <Input placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                  <Input placeholder="LinkedIn URL" value={form.linkedin_url} onChange={e => setForm(f => ({ ...f, linkedin_url: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Source (Apollo, Referral...)" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} />
                    <Select value={form.lead_status} onValueChange={(v) => setForm(f => ({ ...f, lead_status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="churned">Churned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={createCustomer} className="w-full">Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            {STATUS_TABS.map(t => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs gap-1.5">
                {t.label}
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{counts[t.value] ?? 0}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No customers match this filter.</p>
          </CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Name</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Company</TableHead>
                    <TableHead className="text-xs">Email</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs text-right">Inquiries</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c: any) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedCustomer(c)}>
                      <TableCell className="font-medium text-sm">{c.name}</TableCell>
                      <TableCell><LeadStatusBadge status={c.lead_status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.company || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.email || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.source || '—'}</TableCell>
                      <TableCell className="text-xs text-right">{(inquiriesByCustomer[c.id] || []).length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <CustomerImportDialog open={showImport} onOpenChange={setShowImport} onImported={fetchAll} />
    </AppLayout>
  );
};

export default Customers;
