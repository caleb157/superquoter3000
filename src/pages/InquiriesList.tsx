import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus, Search, FileText, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { differenceInDays, parseISO } from 'date-fns';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'costing', label: 'Costing' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'sample', label: 'Sample' },
  { value: 'po', label: 'PO' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  costing: 'bg-amber-100 text-amber-700',
  quoted: 'bg-purple-100 text-purple-700',
  sample: 'bg-cyan-100 text-cyan-700',
  po: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-200 text-gray-600',
};

const PRIORITY_COLOR: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-50 text-blue-600',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
};

export default function InquiriesList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    customer_id: '', title: '', requirements: '', priority: 'normal', assigned_to: '',
  });

  const fetchAll = async () => {
    const [iRes, cRes] = await Promise.all([
      (supabase as any).from('customer_rfqs').select('*').order('received_date', { ascending: false }),
      (supabase as any).from('customers').select('id, name').order('name'),
    ]);
    setItems(iRes.data || []);
    setCustomers(cRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const customerName = (id: string) => customers.find(c => c.id === id)?.name || '—';

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    items.forEach(i => { c[i.status] = (c[i.status] || 0) + 1; });
    return c;
  }, [items]);

  const filtered = items.filter(i => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (i.title || '').toLowerCase().includes(q)
      || i.rfq_number.toLowerCase().includes(q)
      || customerName(i.customer_id).toLowerCase().includes(q);
  });

  const create = async () => {
    if (!form.customer_id) { toast.error('Pick a customer'); return; }
    const { data, error } = await (supabase as any).from('customer_rfqs').insert({
      customer_id: form.customer_id,
      title: form.title.trim() || null,
      requirements: form.requirements.trim() || null,
      priority: form.priority,
      assigned_to: form.assigned_to.trim() || null,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    toast.success(`Created ${data.rfq_number}`);
    setShowCreate(false);
    setForm({ customer_id: '', title: '', requirements: '', priority: 'normal', assigned_to: '' });
    navigate(`/inquiry/${data.id}`);
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-bold flex items-center gap-2"><Inbox className="h-5 w-5" /> Inquiries</h1>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm" className="ml-auto gap-1.5"><Plus className="h-4 w-4" /> New Inquiry</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Customer Inquiry</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Customer *</Label>
                  <Select value={form.customer_id} onValueChange={v => setForm(f => ({ ...f, customer_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Pick a customer..." /></SelectTrigger>
                    <SelectContent>
                      {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Input placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                <Textarea placeholder="Requirements / what they're asking for" rows={4}
                  value={form.requirements} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input placeholder="Assigned to" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} />
                </div>
                <Button onClick={create} className="w-full">Create Inquiry</Button>
              </div>
            </DialogContent>
          </Dialog>
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
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No inquiries match this filter.</p>
          </CardContent></Card>
        ) : (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">CRFQ</TableHead>
                <TableHead className="text-xs">Customer</TableHead>
                <TableHead className="text-xs">Title</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Priority</TableHead>
                <TableHead className="text-xs">Assigned</TableHead>
                <TableHead className="text-xs text-right">Received</TableHead>
                <TableHead className="text-xs text-right">Days Open</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map(i => {
                  const days = differenceInDays(new Date(), parseISO(i.received_date));
                  return (
                    <TableRow key={i.id} className="cursor-pointer" onClick={() => navigate(`/inquiry/${i.id}`)}>
                      <TableCell className="font-mono text-xs">{i.rfq_number}</TableCell>
                      <TableCell className="text-sm">{customerName(i.customer_id)}</TableCell>
                      <TableCell className="text-sm">{i.title || '—'}</TableCell>
                      <TableCell><Badge className={STATUS_COLOR[i.status] || ''} variant="secondary">{i.status}</Badge></TableCell>
                      <TableCell><Badge className={PRIORITY_COLOR[i.priority] || ''} variant="secondary">{i.priority}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.assigned_to || '—'}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{new Date(i.received_date).toLocaleDateString()}</TableCell>
                      <TableCell className={`text-xs text-right ${days > 14 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>{days}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        )}
      </div>
    </AppLayout>
  );
}
