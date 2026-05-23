import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ResponsiveTabs } from '@/components/ResponsiveTabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowLeft, ChevronDown, ExternalLink, FolderOpen, Pencil, Plus, Save, X, History } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { InquiryStatusCards } from '@/components/InquiryStatusCards';
import { InquiryProductsTab, type ProductFilterKey } from '@/components/InquiryProductsTab';
import { InquiryProjectionTab } from '@/components/InquiryProjectionTab';
import { InquiryQuotesTab } from '@/components/InquiryQuotesTab';
import { InquirySamplesTab } from '@/components/InquirySamplesTab';
import { InquiryAssembliesTab } from '@/components/InquiryAssembliesTab';
import { InquiryActivityFeed } from '@/components/InquiryActivityFeed';
import { TaskList } from '@/components/TaskList';
import { TaskDialog } from '@/components/TaskDialog';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { EditHistoryDialog } from '@/components/EditHistoryDialog';
import { CurrencyCombobox } from '@/components/CurrencyCombobox';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

import { STATUS_OPTIONS, INQUIRY_STATUS_COLORS as STATUS_COLOR, statusLabel } from '@/lib/inquiry-status';
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'];
const VALID_TABS = ['products', 'assemblies', 'tasks', 'quotes', 'samples', 'projection', 'settings', 'summary'] as const;
type TabKey = typeof VALID_TABS[number];

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [inquiry, setInquiry] = useState<any | null>(null);
  const [customer, setCustomer] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [productFilter, setProductFilter] = useState<ProductFilterKey>('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  useKeyboardShortcuts({ onNewItem: () => setTaskDialogOpen(true) });
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [editingDrive, setEditingDrive] = useState(false);
  const [driveDraft, setDriveDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  // Settings draft
  const [settingsDraft, setSettingsDraft] = useState<any>(null);
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);

  const tabParam = searchParams.get('tab') as TabKey | null;
  const stageParam = searchParams.get('stage');
  const activeTab: TabKey = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'products';
  const setActiveTab = (t: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    if (t !== 'products') { next.delete('stage'); setProductFilter('all'); }
    setSearchParams(next, { replace: true });
  };

  // Apply ?stage=<key> on mount / when it changes (only when on products tab)
  useEffect(() => {
    if (activeTab === 'products' && stageParam) {
      setProductFilter(stageParam as ProductFilterKey);
    }
  }, [activeTab, stageParam]);

  const fetchInquiry = async () => {
    if (!id) return;
    const [inqRes, stRes, entRes] = await Promise.all([
      (supabase as any).from('customer_rfqs').select('*').eq('id', id).maybeSingle(),
      (supabase as any).from('shipping_types').select('id, name').order('name'),
      (supabase as any).from('company_entities').select('id, name').order('name'),
    ]);
    setInquiry(inqRes.data);
    setSettingsDraft(inqRes.data);
    setShippingTypes(stRes.data || []);
    setEntities(entRes.data || []);
    if (inqRes.data?.customer_id) {
      const { data: c } = await (supabase as any).from('customers').select('*').eq('id', inqRes.data.customer_id).maybeSingle();
      setCustomer(c);
    }
    setLoading(false);
  };

  useEffect(() => { fetchInquiry(); }, [id]);

  const updateField = async (patch: any) => {
    if (patch.status === 'paused') patch = { priority: 'low', ...patch };
    // Auto-populate PO fields the first time the inquiry flips to 'po'
    if (patch.status === 'po' && inquiry?.status !== 'po' && id) {
      const fill: any = {};
      if (!inquiry?.po_received_date) {
        fill.po_received_date = new Date().toISOString().slice(0, 10);
      }
      if (inquiry?.po_total_value_usd == null) {
        const { data: latest } = await (supabase as any)
          .from('quote_snapshots')
          .select('totals, currency, created_at')
          .eq('customer_rfq_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const totalsAny = latest?.totals as any;
        const grand = totalsAny?.grand_total;
        if (latest && (latest.currency ?? 'USD') === 'USD' && typeof grand === 'number') {
          fill.po_total_value_usd = grand;
        }
      }
      patch = { ...fill, ...patch };
    }
    const { error } = await (supabase as any).from('customer_rfqs').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setInquiry((i: any) => ({ ...i, ...patch }));
    setSettingsDraft((d: any) => d ? { ...d, ...patch } : d);
  };

  const saveTitle = async () => {
    const t = titleDraft.trim();
    await updateField({ title: t || null });
    setEditingTitle(false);
    toast.success('Title updated');
  };

  const saveDriveUrl = async () => {
    const v = driveDraft.trim();
    if (v && !/^https?:\/\//i.test(v)) {
      toast.error('Enter a valid URL starting with http(s)://');
      return;
    }
    await updateField({ drive_url: v || null });
    setEditingDrive(false);
    toast.success(v ? 'Drive link saved' : 'Drive link removed');
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    const patch = {
      title: settingsDraft.title?.trim() || null,
      status: settingsDraft.status,
      priority: settingsDraft.status === 'paused' ? 'low' : settingsDraft.priority,
      assigned_to: settingsDraft.assigned_to?.trim() || null,
      target_completion_date: settingsDraft.target_completion_date || null,
      requirements: settingsDraft.requirements?.trim() || null,
      notes: settingsDraft.notes?.trim() || null,
      exchange_rate_override: settingsDraft.exchange_rate_override === '' || settingsDraft.exchange_rate_override == null
        ? null : Number(settingsDraft.exchange_rate_override),
      quoting_currency_rate_override: settingsDraft.quoting_currency_rate_override === '' || settingsDraft.quoting_currency_rate_override == null
        ? null : Number(settingsDraft.quoting_currency_rate_override),
      markup_percent_override: settingsDraft.markup_percent_override === '' || settingsDraft.markup_percent_override == null
        ? null : Number(settingsDraft.markup_percent_override),
      shipping_type_id_override: settingsDraft.shipping_type_id_override || null,
      quoting_entity_id: settingsDraft.quoting_entity_id || null,
      quoting_currency: settingsDraft.quoting_currency || null,
      indirect_overhead_monthly_override: settingsDraft.indirect_overhead_monthly_override === '' || settingsDraft.indirect_overhead_monthly_override == null ? null : Number(settingsDraft.indirect_overhead_monthly_override),
      total_available_mh_per_month_override: settingsDraft.total_available_mh_per_month_override === '' || settingsDraft.total_available_mh_per_month_override == null ? null : Number(settingsDraft.total_available_mh_per_month_override),
      packaging_cost_per_cbm_override: settingsDraft.packaging_cost_per_cbm_override === '' || settingsDraft.packaging_cost_per_cbm_override == null ? null : Number(settingsDraft.packaging_cost_per_cbm_override),
      auto_transport_cost_per_cbm_override: settingsDraft.auto_transport_cost_per_cbm_override === '' || settingsDraft.auto_transport_cost_per_cbm_override == null ? null : Number(settingsDraft.auto_transport_cost_per_cbm_override),
      local_transport_cost_per_cbm_override: settingsDraft.local_transport_cost_per_cbm_override === '' || settingsDraft.local_transport_cost_per_cbm_override == null ? null : Number(settingsDraft.local_transport_cost_per_cbm_override),
      po_received_date: settingsDraft.po_received_date || null,
      po_total_value_usd: settingsDraft.po_total_value_usd === '' || settingsDraft.po_total_value_usd == null ? null : Number(settingsDraft.po_total_value_usd),
      payment_terms_deposit_pct: settingsDraft.payment_terms_deposit_pct === '' || settingsDraft.payment_terms_deposit_pct == null ? null : Number(settingsDraft.payment_terms_deposit_pct),
      payment_terms_deposit_due_days: settingsDraft.payment_terms_deposit_due_days === '' || settingsDraft.payment_terms_deposit_due_days == null ? null : Number(settingsDraft.payment_terms_deposit_due_days),
      payment_terms_balance_due_days: settingsDraft.payment_terms_balance_due_days === '' || settingsDraft.payment_terms_balance_due_days == null ? null : Number(settingsDraft.payment_terms_balance_due_days),
      po_estimated_ship_date: settingsDraft.po_estimated_ship_date || null,
    };
    const { error } = await (supabase as any).from('customer_rfqs').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setInquiry({ ...inquiry, ...patch });
    toast.success('Saved');
  };

  if (loading || !inquiry) {
    return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading...</div></AppLayout>;
  }

  const statusKnown = STATUS_OPTIONS.includes(inquiry.status);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate('/inquiries')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm text-muted-foreground">{inquiry.rfq_number}</span>
              <Badge variant="outline" className="text-[10px] capitalize">{inquiry.priority}</Badge>
            </div>
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                  autoFocus
                  className="h-8 text-lg font-bold"
                />
                <Button size="sm" onClick={saveTitle}>Save</Button>
              </div>
            ) : (
              <h1
                className="text-xl font-serif font-medium tracking-tight cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 inline-flex items-center gap-2 group"
                onClick={() => { setTitleDraft(inquiry.title ?? ''); setEditingTitle(true); }}
              >
                {inquiry.title || 'Untitled Inquiry'}
                <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-50" />
              </h1>
            )}
            {customer && (
              <button
                className="text-sm text-muted-foreground hover:text-foreground hover:underline mt-1"
                onClick={() => navigate('/customers')}
              >
                {customer.name}{customer.company ? ` · ${customer.company}` : ''}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className={cn('gap-1.5', statusKnown && STATUS_COLOR[inquiry.status])}>
                  {statusLabel(inquiry.status)} <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {STATUS_OPTIONS.map(s => (
                  <DropdownMenuItem key={s} onClick={() => updateField({ status: s })}>{statusLabel(s)}</DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => setHistoryOpen(true)} className="border-t mt-1 pt-1.5">
                  <History className="h-3.5 w-3.5 mr-2" /> Edit history…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDeleteButton
              itemLabel={`inquiry ${inquiry.rfq_number}`}
              description={`This permanently removes inquiry ${inquiry.rfq_number} and all of its products, quotes, samples, and tasks. This cannot be undone.`}
              onConfirm={async () => {
                const { error } = await (supabase as any).from('customer_rfqs').delete().eq('id', id);
                if (error) throw error;
                navigate('/');
              }}
            />
          </div>
        </div>

        {/* Google Drive folder link */}
        <Card>
          <CardContent className="py-2.5 px-3 flex items-center gap-2 text-sm">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground shrink-0">Drive folder:</span>
            {editingDrive ? (
              <>
                <Input
                  value={driveDraft}
                  onChange={e => setDriveDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveDriveUrl(); if (e.key === 'Escape') setEditingDrive(false); }}
                  placeholder="https://drive.google.com/drive/folders/..."
                  autoFocus
                  className="h-8 text-sm flex-1 min-w-0"
                />
                <Button size="sm" className="h-8" onClick={saveDriveUrl}>Save</Button>
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingDrive(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : inquiry.drive_url ? (
              <>
                <a
                  href={inquiry.drive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 truncate text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span className="truncate">{inquiry.drive_url}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <Button
                  size="sm" variant="ghost" className="h-8 px-2"
                  onClick={() => { setDriveDraft(inquiry.drive_url ?? ''); setEditingDrive(true); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <button
                className="flex-1 text-left text-muted-foreground hover:text-foreground italic"
                onClick={() => { setDriveDraft(''); setEditingDrive(true); }}
              >
                Add a Google Drive folder link…
              </button>
            )}
          </CardContent>
        </Card>

        {/* Status cards */}
        <InquiryStatusCards
          inquiryId={id!}
          refreshKey={refreshKey}
          onCardClick={(filter) => {
            setProductFilter(filter);
            setActiveTab('products');
          }}
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <ResponsiveTabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabKey)}
            options={[
              { value: 'products', label: 'Products' },
              { value: 'assemblies', label: 'Assemblies' },
              { value: 'tasks', label: 'Tasks' },
              { value: 'quotes', label: 'Quotes' },
              { value: 'samples', label: 'Samples' },
              { value: 'projection', label: 'Projection' },
              { value: 'settings', label: 'Settings' },
              { value: 'summary', label: 'Summary' },
            ]}
          />

          <TabsContent value="summary" className="mt-3 space-y-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Inquiry metadata</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><Label className="text-xs text-muted-foreground">Target completion</Label><div>{inquiry.target_completion_date ?? '—'}</div></div>
                <div><Label className="text-xs text-muted-foreground">Priority</Label><div className="capitalize">{inquiry.priority}</div></div>
                <div><Label className="text-xs text-muted-foreground">Assigned to</Label><div>{inquiry.assigned_to ?? '—'}</div></div>
                <div><Label className="text-xs text-muted-foreground">Received</Label><div>{inquiry.received_date}</div></div>
                <div className="md:col-span-2"><Label className="text-xs text-muted-foreground">Requirements</Label><div className="whitespace-pre-wrap">{inquiry.requirements ?? '—'}</div></div>
                <div className="md:col-span-2"><Label className="text-xs text-muted-foreground">Notes</Label><div className="whitespace-pre-wrap">{inquiry.notes ?? '—'}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recent activity</CardTitle></CardHeader>
              <CardContent><InquiryActivityFeed inquiryId={id!} limit={10} /></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="products" className="mt-3">
            <InquiryProductsTab
              inquiryId={id!}
              initialFilter={productFilter}
              onFilterChange={setProductFilter}
              onChange={() => setRefreshKey(k => k + 1)}
              refreshKey={refreshKey}
            />
          </TabsContent>

          <TabsContent value="assemblies" className="mt-3">
            <InquiryAssembliesTab inquiryId={id!} />
          </TabsContent>

          <TabsContent value="tasks" className="mt-3 space-y-3">
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5" onClick={() => setTaskDialogOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Task
              </Button>
            </div>
            <Card><CardContent className="pt-4">
              <TaskList inquiryId={id!} status="all" sort="due_date" showAnchorLinks={false} refreshKey={taskRefresh} />
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="quotes" className="mt-3">
            <InquiryQuotesTab inquiryId={id!} refreshKey={refreshKey} />
          </TabsContent>

          <TabsContent value="samples" className="mt-3">
            <InquirySamplesTab inquiryId={id!} refreshKey={refreshKey} />
          </TabsContent>

          <TabsContent value="projection" className="mt-3">
            <InquiryProjectionTab inquiryId={id!} />
          </TabsContent>


          <TabsContent value="settings" className="mt-3 space-y-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Inquiry settings</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Title</Label>
                  <Input value={settingsDraft?.title ?? ''} onChange={e => setSettingsDraft({ ...settingsDraft, title: e.target.value })} className="h-9 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={settingsDraft?.status ?? 'active'} onValueChange={v => setSettingsDraft({ ...settingsDraft, status: v })}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                      {!STATUS_OPTIONS.includes(settingsDraft?.status) && settingsDraft?.status && (
                        <SelectItem value={settingsDraft.status} className="capitalize">{settingsDraft.status}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Priority</Label>
                  <Select value={settingsDraft?.priority ?? 'normal'} onValueChange={v => setSettingsDraft({ ...settingsDraft, priority: v })}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITY_OPTIONS.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Assigned to</Label>
                  <Input value={settingsDraft?.assigned_to ?? ''} onChange={e => setSettingsDraft({ ...settingsDraft, assigned_to: e.target.value })} className="h-9 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Target completion</Label>
                  <Input type="date" value={settingsDraft?.target_completion_date ?? ''} onChange={e => setSettingsDraft({ ...settingsDraft, target_completion_date: e.target.value })} className="h-9 mt-1" />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Requirements</Label>
                  <Textarea rows={3} value={settingsDraft?.requirements ?? ''} onChange={e => setSettingsDraft({ ...settingsDraft, requirements: e.target.value })} className="text-sm mt-1" />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Notes</Label>
                  <Textarea rows={2} value={settingsDraft?.notes ?? ''} onChange={e => setSettingsDraft({ ...settingsDraft, notes: e.target.value })} className="text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Quoting entity</Label>
                  <Select
                    value={settingsDraft?.quoting_entity_id ?? '__none__'}
                    onValueChange={v => setSettingsDraft({ ...settingsDraft, quoting_entity_id: v === '__none__' ? null : v })}
                  >
                    <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Pick at quote time" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Pick at quote time —</SelectItem>
                      {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Quoting currency</Label>
                  <div className="mt-1">
                    <CurrencyCombobox
                      value={settingsDraft?.quoting_currency ?? 'USD'}
                      onChange={v => setSettingsDraft({ ...settingsDraft, quoting_currency: v })}
                    />
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Button onClick={saveSettings} size="sm" className="gap-1.5"><Save className="h-3.5 w-3.5" /> Save</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Costing overrides</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Optional. Leave blank to use global defaults / per-product values.</p>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Exchange rate (INR per USD)</Label>
                  <Input
                    type="number" step="0.01" placeholder="Global default"
                    value={settingsDraft?.exchange_rate_override ?? ''}
                    onChange={e => setSettingsDraft({ ...settingsDraft, exchange_rate_override: e.target.value })}
                    className="h-9 mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Used by costing display (₹↔$).</p>
                </div>
                {settingsDraft?.quoting_currency && settingsDraft.quoting_currency !== 'INR' && settingsDraft.quoting_currency !== 'USD' && (
                  <div>
                    <Label className="text-xs">Quote FX (INR per {settingsDraft.quoting_currency})</Label>
                    <Input
                      type="number" step="0.0001" placeholder="Currencies table default"
                      value={settingsDraft?.quoting_currency_rate_override ?? ''}
                      onChange={e => setSettingsDraft({ ...settingsDraft, quoting_currency_rate_override: e.target.value })}
                      className="h-9 mt-1"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Frozen into generated quotes for this currency.</p>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Uniform NPM % (overrides per product)</Label>
                  <Input
                    type="number" step="0.1" placeholder="Per-product default" min={0} max={99.9}
                    value={
                      settingsDraft?.markup_percent_override == null || settingsDraft?.markup_percent_override === ''
                        ? ''
                        : (Number(settingsDraft.markup_percent_override) / (1 + Number(settingsDraft.markup_percent_override)) * 100).toFixed(1)
                    }
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '') { setSettingsDraft({ ...settingsDraft, markup_percent_override: null }); return; }
                      const npm = Number(v) / 100;
                      if (!isFinite(npm) || npm < 0 || npm >= 1) return;
                      const markup = npm >= 1 ? null : npm / (1 - npm);
                      setSettingsDraft({ ...settingsDraft, markup_percent_override: markup });
                    }}
                    className="h-9 mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Net Profit Margin. Stored internally as markup multiplier.</p>
                </div>
                <div>
                  <Label className="text-xs">Shipping type override</Label>
                  <Select
                    value={settingsDraft?.shipping_type_id_override ?? '__none__'}
                    onValueChange={v => setSettingsDraft({ ...settingsDraft, shipping_type_id_override: v === '__none__' ? null : v })}
                  >
                    <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Per-product default" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Use per-product —</SelectItem>
                      {shippingTypes.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Indirect overhead / month (₹)</Label>
                  <Input type="number" step="1" placeholder="Global default"
                    value={settingsDraft?.indirect_overhead_monthly_override ?? ''}
                    onChange={e => setSettingsDraft({ ...settingsDraft, indirect_overhead_monthly_override: e.target.value })}
                    className="h-9 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Total available MH / month</Label>
                  <Input type="number" step="1" placeholder="Global default"
                    value={settingsDraft?.total_available_mh_per_month_override ?? ''}
                    onChange={e => setSettingsDraft({ ...settingsDraft, total_available_mh_per_month_override: e.target.value })}
                    className="h-9 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Packaging cost / CBM (₹)</Label>
                  <Input type="number" step="1" placeholder="Global default"
                    value={settingsDraft?.packaging_cost_per_cbm_override ?? ''}
                    onChange={e => setSettingsDraft({ ...settingsDraft, packaging_cost_per_cbm_override: e.target.value })}
                    className="h-9 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Auto transport cost / CBM (₹)</Label>
                  <Input type="number" step="1" placeholder="Global default"
                    value={settingsDraft?.auto_transport_cost_per_cbm_override ?? ''}
                    onChange={e => setSettingsDraft({ ...settingsDraft, auto_transport_cost_per_cbm_override: e.target.value })}
                    className="h-9 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Local transport cost / CBM (₹)</Label>
                  <Input type="number" step="1" placeholder="Global default"
                    value={settingsDraft?.local_transport_cost_per_cbm_override ?? ''}
                    onChange={e => setSettingsDraft({ ...settingsDraft, local_transport_cost_per_cbm_override: e.target.value })}
                    className="h-9 mt-1" />
                </div>
                <div className="md:col-span-3">
                  <Button onClick={saveSettings} size="sm" className="gap-1.5"><Save className="h-3.5 w-3.5" /> Save overrides</Button>
                </div>
              </CardContent>
            </Card>
            {inquiry.status === 'po' && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">PO & Payment Terms</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Used by the cashflow forecast on the Sales analytics dashboard.</p>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">PO received date</Label>
                    <Input type="date" value={settingsDraft?.po_received_date ?? ''}
                      onChange={e => setSettingsDraft({ ...settingsDraft, po_received_date: e.target.value })}
                      className="h-9 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">PO total value (USD)</Label>
                    <Input type="number" step="0.01" placeholder="0.00"
                      value={settingsDraft?.po_total_value_usd ?? ''}
                      onChange={e => setSettingsDraft({ ...settingsDraft, po_total_value_usd: e.target.value })}
                      className="h-9 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Estimated ship date</Label>
                    <Input type="date" value={settingsDraft?.po_estimated_ship_date ?? ''}
                      onChange={e => setSettingsDraft({ ...settingsDraft, po_estimated_ship_date: e.target.value })}
                      className="h-9 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Deposit %</Label>
                    <Input type="number" step="1" placeholder="30"
                      value={settingsDraft?.payment_terms_deposit_pct ?? ''}
                      onChange={e => setSettingsDraft({ ...settingsDraft, payment_terms_deposit_pct: e.target.value })}
                      className="h-9 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Deposit due (days after PO)</Label>
                    <Input type="number" step="1" placeholder="0"
                      value={settingsDraft?.payment_terms_deposit_due_days ?? ''}
                      onChange={e => setSettingsDraft({ ...settingsDraft, payment_terms_deposit_due_days: e.target.value })}
                      className="h-9 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Balance due (days after PO)</Label>
                    <Input type="number" step="1" placeholder="70"
                      value={settingsDraft?.payment_terms_balance_due_days ?? ''}
                      onChange={e => setSettingsDraft({ ...settingsDraft, payment_terms_balance_due_days: e.target.value })}
                      className="h-9 mt-1" />
                  </div>
                  <div className="md:col-span-3">
                    <Button onClick={saveSettings} size="sm" className="gap-1.5"><Save className="h-3.5 w-3.5" /> Save PO terms</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Inquiry history</CardTitle></CardHeader>
              <CardContent><InquiryActivityFeed inquiryId={id!} limit={50} /></CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        context={{ inquiryId: id }}
        onSaved={() => setTaskRefresh(k => k + 1)}
      />

      {inquiry && (
        <EditHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          config={{
            table: 'inquiry_status_events',
            parentColumn: 'inquiry_id',
            parentId: inquiry.id,
            options: STATUS_OPTIONS,
            valueColumn: 'to_status',
            fromColumn: 'from_status',
            label: `${inquiry.rfq_number} — status`,
          }}
        />
      )}
    </AppLayout>
  );
}
