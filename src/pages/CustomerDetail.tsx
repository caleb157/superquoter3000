import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ResponsiveTabs } from '@/components/ResponsiveTabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Pencil, Plus, FileText, ListTodo, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LeadStatusBadge } from '@/components/LeadStatusBadge';
import { NewInquiryDialog } from '@/components/NewInquiryDialog';
import { TaskList } from '@/components/TaskList';
import { TaskDialog } from '@/components/TaskDialog';

const INQUIRY_STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-200 text-gray-600',
  po: 'bg-emerald-100 text-emerald-700',
};

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  linkedin_url: string | null;
  lead_score: number;
  lead_status: string;
  last_contacted_at: string | null;
  notes: string | null;
};

type Inquiry = {
  id: string;
  rfq_number: string;
  title: string | null;
  status: string;
  updated_at: string;
};

type ProductCount = { customer_rfq_id: string };

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'inquiries';

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [showNewInquiry, setShowNewInquiry] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [taskRefresh, setTaskRefresh] = useState(0);

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    const [custRes, inqRes, taskRes] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).maybeSingle(),
      supabase.from('customer_rfqs').select('id, rfq_number, title, status, updated_at')
        .eq('customer_id', id).order('updated_at', { ascending: false }),
      supabase.from('tasks').select('id', { count: 'exact', head: true })
        .eq('customer_id', id).eq('status', 'open'),
    ]);
    if (custRes.error || !custRes.data) {
      toast.error('Customer not found');
      setLoading(false);
      return;
    }
    setCustomer(custRes.data as Customer);
    const inqs = (inqRes.data ?? []) as Inquiry[];
    setInquiries(inqs);
    setOpenTaskCount(taskRes.count ?? 0);

    if (inqs.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('customer_rfq_id')
        .in('customer_rfq_id', inqs.map(i => i.id)) as { data: ProductCount[] | null };
      const counts: Record<string, number> = {};
      (prods ?? []).forEach(p => {
        if (p.customer_rfq_id) counts[p.customer_rfq_id] = (counts[p.customer_rfq_id] ?? 0) + 1;
      });
      setProductCounts(counts);
    } else {
      setProductCounts({});
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [id]);

  const totalInquiries = useMemo(
    () => inquiries.filter(i => i.status !== 'cancelled').length,
    [inquiries],
  );

  const setTab = (v: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', v);
    setSearchParams(next, { replace: true });
  };

  if (loading) {
    return <AppLayout><div className="p-12 text-center text-sm text-muted-foreground">Loading…</div></AppLayout>;
  }
  if (!customer) {
    return <AppLayout><div className="p-12 text-center text-sm text-muted-foreground">Customer not found.</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate('/customers')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        {/* Header */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight break-words">
                {customer.name || customer.company || 'Customer'}
              </h1>
              <LeadStatusBadge status={customer.lead_status} />
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs sm:text-sm text-muted-foreground">
              {customer.company && customer.company !== customer.name && <span className="truncate max-w-full">{customer.company}</span>}
              {customer.email && <a href={`mailto:${customer.email}`} className="hover:text-foreground truncate max-w-full">{customer.email}</a>}
              {customer.phone && <span>{customer.phone}</span>}
              {customer.source && <span>· {customer.source}</span>}
              {customer.linkedin_url && (
                <a href={customer.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-foreground">LinkedIn</a>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
          <StatCard icon={<FileText className="h-4 w-4" />} label="Inquiries" value={totalInquiries} sub="Excl. cancelled" />
          <StatCard icon={<ListTodo className="h-4 w-4" />} label="Open Tasks" value={openTaskCount} />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Last contact"
            value={customer.last_contacted_at ? formatDistanceToNow(new Date(customer.last_contacted_at), { addSuffix: true }) : '—'}
          />
        </div>

        {/* Tabs — keeps original style on desktop because there are only 2 */}
        <Tabs value={tab} onValueChange={setTab}>
          <ResponsiveTabs
            value={tab}
            onValueChange={setTab}
            options={[
              { value: 'inquiries', label: `Inquiries (${inquiries.length})` },
              { value: 'tasks', label: 'Tasks' },
            ]}
          />

          <TabsContent value="inquiries" className="mt-3">
            {inquiries.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center space-y-3">
                  <p className="text-sm text-muted-foreground">No inquiries yet</p>
                  <Button size="sm" className="gap-1.5" onClick={() => setShowNewInquiry(true)}>
                    <Plus className="h-4 w-4" /> New Inquiry
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="hidden md:block">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs w-[120px]">#</TableHead>
                          <TableHead className="text-xs">Title</TableHead>
                          <TableHead className="text-xs w-[100px]">Status</TableHead>
                          <TableHead className="text-xs text-right w-[90px]">Products</TableHead>
                          <TableHead className="text-xs text-right w-[120px]">Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inquiries.map(i => (
                          <TableRow
                            key={i.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => navigate(`/inquiry/${i.id}`)}
                          >
                            <TableCell className="font-mono text-xs">{i.rfq_number}</TableCell>
                            <TableCell className="text-sm">
                              {i.title || <span className="italic text-muted-foreground">Untitled</span>}
                            </TableCell>
                            <TableCell>
                              <span className={cn('px-2 py-0.5 rounded text-[11px] font-medium capitalize',
                                INQUIRY_STATUS_COLORS[i.status] || 'bg-muted')}>{i.status}</span>
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{productCounts[i.id] ?? 0}</TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground">
                              {formatDistanceToNow(new Date(i.updated_at), { addSuffix: true })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <div className="md:hidden space-y-2">
                  {inquiries.map(i => (
                    <Card key={i.id} className="cursor-pointer active:bg-accent/50" onClick={() => navigate(`/inquiry/${i.id}`)}>
                      <CardContent className="p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] text-muted-foreground">{i.rfq_number}</div>
                            <div className="text-sm font-medium truncate">{i.title || <span className="italic text-muted-foreground">Untitled</span>}</div>
                          </div>
                          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium capitalize shrink-0',
                            INQUIRY_STATUS_COLORS[i.status] || 'bg-muted')}>{i.status}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{productCounts[i.id] ?? 0} product{(productCounts[i.id] ?? 0) === 1 ? '' : 's'}</span>
                          <span>{formatDistanceToNow(new Date(i.updated_at), { addSuffix: true })}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
            {inquiries.length > 0 && (
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowNewInquiry(true)}>
                  <Plus className="h-3.5 w-3.5" /> New Inquiry
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="tasks" className="mt-3 space-y-5">
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5" onClick={() => setShowNewTask(true)}>
                <Plus className="h-4 w-4" /> Add Task
              </Button>
            </div>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Lead tasks</h3>
              <Card>
                <CardContent className="p-2">
                  <TaskList
                    customerId={customer.id}
                    showAnchorLinks={false}
                    status="all"
                    refreshKey={taskRefresh}
                  />
                </CardContent>
              </Card>
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Inquiry tasks</h3>
              <Card>
                <CardContent className="p-2">
                  <TaskList
                    customerIdIncludingInquiries={customer.id}
                    showAnchorLinks
                    status="all"
                    refreshKey={taskRefresh}
                  />
                </CardContent>
              </Card>
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <EditCustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
        onSaved={fetchAll}
      />

      <NewInquiryDialog
        open={showNewInquiry}
        onOpenChange={setShowNewInquiry}
        defaultCustomerId={customer.id}
        onCreated={(inquiryId) => navigate(`/inquiry/${inquiryId}?tab=products`)}
      />

      {showNewTask && (
        <TaskDialog
          open={showNewTask}
          onOpenChange={setShowNewTask}
          context={{ customerId: customer.id }}
          onSaved={() => { setTaskRefresh(k => k + 1); fetchAll(); }}
        />
      )}
    </AppLayout>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">{icon}{label}</div>
        <div className="text-xl font-bold tabular-nums truncate">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

type EditProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: Customer;
  onSaved: () => void;
};

function EditCustomerDialog({ open, onOpenChange, customer, onSaved }: EditProps) {
  const [form, setForm] = useState<Customer>(customer);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setForm(customer); }, [open, customer]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('customers').update({
      name: form.name.trim(),
      email: form.email?.trim() || null,
      phone: form.phone?.trim() || null,
      company: form.company?.trim() || null,
      source: form.source?.trim() || null,
      linkedin_url: form.linkedin_url?.trim() || null,
      lead_score: form.lead_score ?? 0,
      lead_status: form.lead_status,
      last_contacted_at: form.last_contacted_at || null,
      notes: form.notes?.trim() || null,
    }).eq('id', customer.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Customer updated');
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit customer</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Name *"><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Company"><Input value={form.company ?? ''} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Email"><Input value={form.email ?? ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Phone"><Input value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></Field>
          </div>
          <Field label="LinkedIn"><Input value={form.linkedin_url ?? ''} onChange={e => setForm(f => ({ ...f, linkedin_url: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Source"><Input value={form.source ?? ''} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} /></Field>
            <Field label="Lead Score">
              <Input type="number" value={form.lead_score ?? 0} onChange={e => setForm(f => ({ ...f, lead_score: parseInt(e.target.value) || 0 }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Lead Status">
              <Select value={form.lead_status} onValueChange={(v) => setForm(f => ({ ...f, lead_status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="churned">Churned</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Last contacted">
              <Input
                type="date"
                value={form.last_contacted_at ? new Date(form.last_contacted_at).toISOString().slice(0, 10) : ''}
                onChange={e => setForm(f => ({ ...f, last_contacted_at: e.target.value ? new Date(e.target.value).toISOString() : null }))}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={3} value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
