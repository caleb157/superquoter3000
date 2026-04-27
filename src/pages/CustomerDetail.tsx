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
import { ArrowLeft, Plus, FileText, ListTodo, Clock } from 'lucide-react';
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

  const updateField = async (patch: Partial<Customer>) => {
    if (!customer) return;
    const prev = customer;
    setCustomer({ ...customer, ...patch } as Customer);
    const { error } = await supabase.from('customers').update(patch).eq('id', customer.id);
    if (error) {
      setCustomer(prev);
      toast.error(error.message);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate('/customers')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        {/* Header — inline editable */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <InlineText
              value={customer.company || ''}
              placeholder="Company name"
              className="text-xl sm:text-2xl font-bold tracking-tight"
              onSave={(v) => updateField({ company: v.trim() || null })}
            />
            <InlineSelect
              value={customer.lead_status}
              options={[
                { value: 'lead', label: 'Lead' },
                { value: 'active', label: 'Active' },
                { value: 'won', label: 'Won' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'churned', label: 'Churned' },
              ]}
              onSave={(v) => updateField({ lead_status: v })}
              renderDisplay={() => <LeadStatusBadge status={customer.lead_status} />}
            />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs sm:text-sm text-muted-foreground">
            <InlineText value={customer.name || ''} placeholder="Contact name" onSave={(v) => updateField({ name: v.trim() || customer.company || 'Customer' })} />
            <InlineText value={customer.email || ''} placeholder="Email" onSave={(v) => updateField({ email: v.trim() || null })} />
            <InlineText value={customer.phone || ''} placeholder="Phone" onSave={(v) => updateField({ phone: v.trim() || null })} />
            <InlineText value={customer.source || ''} placeholder="Source" onSave={(v) => updateField({ source: v.trim() || null })} />
            <InlineText value={customer.linkedin_url || ''} placeholder="LinkedIn URL" onSave={(v) => updateField({ linkedin_url: v.trim() || null })} />
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

        {/* Editable details card */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DetailField label="Company">
                <Input value={customer.company ?? ''} onChange={(e) => setCustomer(c => c ? { ...c, company: e.target.value } : c)}
                  onBlur={(e) => updateField({ company: e.target.value.trim() || null })} />
              </DetailField>
              <DetailField label="Contact name">
                <Input value={customer.name ?? ''} onChange={(e) => setCustomer(c => c ? { ...c, name: e.target.value } : c)}
                  onBlur={(e) => updateField({ name: e.target.value.trim() || customer.company || 'Customer' })} />
              </DetailField>
              <DetailField label="Email">
                <Input type="email" value={customer.email ?? ''} onChange={(e) => setCustomer(c => c ? { ...c, email: e.target.value } : c)}
                  onBlur={(e) => updateField({ email: e.target.value.trim() || null })} />
              </DetailField>
              <DetailField label="Phone">
                <Input value={customer.phone ?? ''} onChange={(e) => setCustomer(c => c ? { ...c, phone: e.target.value } : c)}
                  onBlur={(e) => updateField({ phone: e.target.value.trim() || null })} />
              </DetailField>
              <DetailField label="LinkedIn URL">
                <Input value={customer.linkedin_url ?? ''} onChange={(e) => setCustomer(c => c ? { ...c, linkedin_url: e.target.value } : c)}
                  onBlur={(e) => updateField({ linkedin_url: e.target.value.trim() || null })} />
              </DetailField>
              <DetailField label="Source">
                <Input value={customer.source ?? ''} onChange={(e) => setCustomer(c => c ? { ...c, source: e.target.value } : c)}
                  onBlur={(e) => updateField({ source: e.target.value.trim() || null })} />
              </DetailField>
              <DetailField label="Lead status">
                <Select value={customer.lead_status} onValueChange={(v) => updateField({ lead_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="churned">Churned</SelectItem>
                  </SelectContent>
                </Select>
              </DetailField>
              <DetailField label="Lead score">
                <Input type="number" value={customer.lead_score ?? 0}
                  onChange={(e) => setCustomer(c => c ? { ...c, lead_score: parseInt(e.target.value) || 0 } : c)}
                  onBlur={(e) => updateField({ lead_score: parseInt(e.target.value) || 0 })} />
              </DetailField>
              <DetailField label="Last contacted">
                <Input type="date"
                  value={customer.last_contacted_at ? new Date(customer.last_contacted_at).toISOString().slice(0, 10) : ''}
                  onChange={(e) => updateField({ last_contacted_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </DetailField>
              <DetailField label="Notes" className="sm:col-span-2">
                <Textarea rows={3} value={customer.notes ?? ''}
                  onChange={(e) => setCustomer(c => c ? { ...c, notes: e.target.value } : c)}
                  onBlur={(e) => updateField({ notes: e.target.value.trim() || null })} />
              </DetailField>
            </div>
          </CardContent>
        </Card>

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

function DetailField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function InlineText({
  value, placeholder, onSave, className,
}: { value: string; placeholder?: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        className={cn('h-7 px-2 py-0', className)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        'text-left rounded px-1 -mx-1 hover:bg-muted/60 transition-colors max-w-full truncate',
        !value && 'text-muted-foreground/60 italic',
        className,
      )}
    >
      {value || placeholder || '—'}
    </button>
  );
}

function InlineSelect({
  value, options, onSave, renderDisplay,
}: {
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => void;
  renderDisplay?: () => React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={(v) => { if (v !== value) onSave(v); }}>
      <SelectTrigger className="h-auto border-none p-0 bg-transparent shadow-none focus:ring-0 hover:bg-muted/60 rounded px-1 -mx-1 [&>svg]:hidden gap-0">
        {renderDisplay ? renderDisplay() : <SelectValue />}
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

