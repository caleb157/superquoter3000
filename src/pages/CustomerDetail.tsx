import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation, Link } from 'react-router-dom';
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
import { ArrowLeft, Plus, FileText, ListTodo, Clock, History } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { StageSelect } from '@/components/sales/StageSelect';
import { moveAccountStage } from '@/components/sales/AccountActions';
import { ALL_SALES_STAGES, SALES_STAGE_LABELS, type SalesStage } from '@/lib/sales/sales-core';
import { CreateInquiryDialog } from '@/components/CreateInquiryDialog';
import { TaskList } from '@/components/TaskList';
import { TaskDialog } from '@/components/TaskDialog';
import { EditHistoryDialog } from '@/components/EditHistoryDialog';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/use-document-title';

import { INQUIRY_STATUS_COLORS, statusLabel } from '@/lib/inquiry-status';
import { SalesAccountPanel } from '@/components/sales/SalesAccountPanel';
import { ACCOUNTS_PATH, accountBackTarget } from '@/lib/sales/account-link';

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  linkedin_url: string | null;
  sales_stage: string | null;
  not_now_until: string | null;
  dnc: boolean;
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
  const location = useLocation();
  // Set once on arrival: tab switches and stage moves on this page must not lose where Back goes.
  const [backTo] = useState(() => accountBackTarget(location.state));
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'inquiries';

  const [customer, setCustomer] = useState<Customer | null>(null);
  useDocumentTitle(customer ? customer.name : null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showNewInquiry, setShowNewInquiry] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [salesKey, setSalesKey] = useState(0);

  useKeyboardShortcuts({ onNewItem: () => setShowNewInquiry(true) });

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

  // The one status: the sales stage. Same move as the Sales tab (Not now gets a date, the move is logged).
  const changeStage = async (next: SalesStage) => {
    if (!customer) return;
    if (await moveAccountStage(customer, next)) {
      const { data } = await supabase.from('customers').select('*').eq('id', customer.id).maybeSingle();
      if (data) setCustomer(data as unknown as Customer);
      setSalesKey(k => k + 1);
    }
  };

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
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          {/* Back goes to the page this account was opened from (Needs you, Pipeline, Accounts, Tasks...), else Sales > Accounts. */}
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" title={`Back to ${backTo.label}`} onClick={() => {
            const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
            const cameFrom = (location.state as { from?: unknown } | null)?.from;
            if (cameFrom) navigate(backTo.path);
            else if (idx > 0) navigate(-1);
            else navigate(ACCOUNTS_PATH);
          }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <PageBreadcrumbs
            canonical={backTo.path === ACCOUNTS_PATH || !backTo.path.startsWith('/sales')
              ? [{ label: 'Sales', to: '/sales' }, { label: 'Accounts', to: ACCOUNTS_PATH }]
              : [{ label: 'Sales', to: '/sales' }, { label: backTo.label, to: backTo.path }]}
            current={customer.company || customer.name || 'Customer'}
          />
          {isAdmin && (
            <div className="ml-auto">
              <ConfirmDeleteButton
                itemLabel={customer.company || customer.name || 'customer'}
                description="Its inquiries stay but lose their customer link, and its tasks are deleted."
                onConfirm={async () => {
                  const { error } = await (supabase as any).from('customers').delete().eq('id', customer.id);
                  if (error) throw new Error(error.message);
                  navigate(ACCOUNTS_PATH, { replace: true });
                }}
              />
            </div>
          )}
        </div>

        {/* Header — inline editable */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <InlineText
              value={customer.company || ''}
              placeholder="Company name"
              className="text-xl sm:text-2xl font-bold tracking-tight"
              onSave={(v) => updateField({ company: v.trim() || null })}
            />
            <StageSelect badge stage={customer.sales_stage} dnc={customer.dnc} onChange={changeStage} />
            {customer.sales_stage === 'not_now' && customer.not_now_until && (
              <span className="text-xs text-muted-foreground">until {customer.not_now_until}</span>
            )}
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
              <DetailField label="Sales stage">
                <div className="flex items-center gap-1">
                  <StageSelect stage={customer.sales_stage} dnc={customer.dnc} onChange={changeStage} className="h-9 text-sm w-full" />
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                    title="Stage history (backdate)"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <History className="h-4 w-4" />
                  </Button>
                </div>
              </DetailField>
              {customer.sales_stage === 'not_now' ? (
                <DetailField label="Not now until">
                  <Input type="date" value={customer.not_now_until ?? ''}
                    onChange={(e) => { if (e.target.value) updateField({ not_now_until: e.target.value }); }} />
                </DetailField>
              ) : <div className="hidden sm:block" />}
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
              { value: 'sales', label: 'Sales' },
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
                              <span className={cn('px-2 py-0.5 rounded text-[11px] font-medium',
                                INQUIRY_STATUS_COLORS[i.status] || 'bg-muted')}>{statusLabel(i.status)}</span>
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
                          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium shrink-0',
                            INQUIRY_STATUS_COLORS[i.status] || 'bg-muted')}>{statusLabel(i.status)}</span>
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

          <TabsContent value="sales" className="mt-3">
            <SalesAccountPanel key={salesKey} customerId={customer.id} onStageChanged={fetchAll} />
          </TabsContent>
        </Tabs>
      </div>

      <CreateInquiryDialog
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

      <EditHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        config={{
          table: 'sales_stage_events',
          parentColumn: 'customer_id',
          parentId: customer.id,
          options: [...ALL_SALES_STAGES],
          optionLabels: SALES_STAGE_LABELS,
          valueColumn: 'to_stage',
          fromColumn: 'from_stage',
          noteColumn: 'reason',
          label: `${customer.company || customer.name}: sales stage`,
        }}
      />
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
