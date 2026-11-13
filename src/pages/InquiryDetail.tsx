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
import { ArrowLeft, ChevronDown, ExternalLink, FolderOpen, Pencil, Plus, Save, History } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CostingSheet } from '@/components/costing-workspace/CostingSheet';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ArchivedProductsCard } from '@/components/ArchivedProductsCard';
import { InquiryStatusCards } from '@/components/InquiryStatusCards';
import { InquiryFobCard } from '@/components/InquiryFobCard';
import { InquiryProductsTab, type ProductFilterKey } from '@/components/InquiryProductsTab';
import { InquiryProjectionTab } from '@/components/InquiryProjectionTab';
import { InquiryQuotesTab } from '@/components/InquiryQuotesTab';
import { InquirySamplesTab } from '@/components/InquirySamplesTab';
import { InquiryVendorRfqSheets } from '@/components/vendor-rfq/InquiryVendorRfqSheets';
import { InquiryAssembliesTab } from '@/components/InquiryAssembliesTab';
import { InquiryActivityFeed } from '@/components/InquiryActivityFeed';
import { TaskList } from '@/components/TaskList';
import { TaskDialog } from '@/components/TaskDialog';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { EditHistoryDialog } from '@/components/EditHistoryDialog';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useScrollRestoration } from '@/hooks/use-persistent-state';

import { STATUS_OPTIONS, INQUIRY_STATUS_COLORS as STATUS_COLOR, statusLabel } from '@/lib/inquiry-status';
import { InquiryClockStrip } from '@/components/InquiryClockStrip';
import { RepeatOfLink } from '@/components/RepeatOrderPicker';
import { InquirySampleClockStrip } from '@/components/InquirySampleClockStrip';
import { customerFullLabel } from '@/lib/customer-name';
const VALID_TABS = ['costing', 'products', 'assemblies', 'samples', 'tasks', 'quotes', 'projection', 'settings'] as const;
type TabKey = typeof VALID_TABS[number];
const TAB_OPTIONS: { value: TabKey; label: string }[] = [
  { value: 'costing', label: 'Costing' },
  { value: 'products', label: 'Development' },
  { value: 'assemblies', label: 'Assemblies' },
  { value: 'samples', label: 'Samples' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'quotes', label: 'Quotes' },
  { value: 'projection', label: 'Projection' },
  { value: 'settings', label: 'Settings' },
];
/** The costing sheet needs room: it is the first tab on a computer, the product list on a phone. */
const wideScreen = () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 768px)').matches;

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [inquiry, setInquiry] = useState<any | null>(null);
  useDocumentTitle(inquiry ? `${inquiry.rfq_number}${inquiry.title ? ` — ${inquiry.title}` : ''}` : null);
  const [customer, setCustomer] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  useScrollRestoration(`inquiry.${id ?? 'none'}.${searchParams.get('tab') ?? 'products'}.scroll`, !loading);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [productFilter, setProductFilter] = useState<ProductFilterKey>('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  // Not on the Costing tab: there a letter typed on a cell starts editing it.
  useKeyboardShortcuts({ onNewItem: () => { if (activeTab !== 'costing') setTaskDialogOpen(true); } });
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [editingDrive, setEditingDrive] = useState(false);
  const [driveDraft, setDriveDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  // Settings draft
  const [settingsDraft, setSettingsDraft] = useState<any>(null);

  // The old Summary tab's details all live under Settings now.
  const tabParam = (searchParams.get('tab') === 'summary' ? 'settings' : searchParams.get('tab')) as TabKey | null;
  const stageParam = searchParams.get('stage');
  const activeTab: TabKey = tabParam && VALID_TABS.includes(tabParam) ? tabParam : stageParam || !wideScreen() ? 'products' : 'costing';
  const setActiveTab = (t: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    if (t !== 'products') { next.delete('stage'); setProductFilter('all'); }
    if (t !== 'costing') { next.delete('sku'); next.delete('view'); }
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
    const inqRes = await (supabase as any).from('customer_rfqs').select('*').eq('id', id).maybeSingle();
    setInquiry(inqRes.data);
    setSettingsDraft(inqRes.data);
    if (inqRes.data?.customer_id) {
      const { data: c } = await (supabase as any).from('customers').select('*').eq('id', inqRes.data.customer_id).maybeSingle();
      setCustomer(c);
    }
    setLoading(false);
  };

  useEffect(() => { fetchInquiry(); }, [id]);

  const updateField = async (patch: any) => {
    // Auto-populate PO fields the first time the inquiry flips to 'po'
    const isPoTransition = patch.status === 'po' && inquiry?.status !== 'po' && !!id;
    if (isPoTransition) {
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

    // Snapshot live FOB/GPM into the projection on PO transition so they
    // become the locked, editable values from this point on.
    if (isPoTransition && id) {
      try {
        const { computeProductPriceAndCost } = await import('@/lib/product-pricing');
        const { computeInquiryFinancials } = await import('@/lib/inquiry-financials');
        const { data: prods } = await (supabase as any)
          .from('products')
          .select('id, quantity')
          .eq('customer_rfq_id', id)
          .is('archived_at', null);
        const ids = (prods || []).map((p: any) => p.id);
        if (ids.length) {
          const priceMap = await computeProductPriceAndCost(ids);
          const live = computeInquiryFinancials(prods as any, priceMap);
          if (live.fobRevenueUsd > 0) {
            await (supabase as any)
              .from('inquiry_projections')
              .upsert(
                {
                  inquiry_id: id,
                  projected_fob_revenue_usd: Math.round(live.fobRevenueUsd * 100) / 100,
                  project_gpm: Math.round(live.gpm * 10000) / 10000,
                },
                { onConflict: 'inquiry_id' },
              );
          }
        }
      } catch (e: any) {
        console.warn('Failed to snapshot live projection on PO transition', e);
      }
    }
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
      assigned_to: settingsDraft.assigned_to?.trim() || null,
      target_completion_date: settingsDraft.target_completion_date || null,
      requirements: settingsDraft.requirements?.trim() || null,
      notes: settingsDraft.notes?.trim() || null,
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

  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/inquiries');
  };
  const titleEl = editingTitle ? (
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
      className="page-title cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 inline-flex min-w-0 items-center gap-2 group"
      onClick={() => { setTitleDraft(inquiry.title ?? ''); setEditingTitle(true); }}
    >
      <span className="truncate">{inquiry.title || 'Untitled Inquiry'}</span>
      <Pencil className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-50" />
    </h1>
  );
  // The Google Drive folder: a chip in the header (it used to be a card above every tab).
  const driveChip = (
    <Popover open={editingDrive} onOpenChange={o => { setEditingDrive(o); if (o) setDriveDraft(inquiry.drive_url ?? ''); }}>
      <span className="inline-flex shrink-0 items-center rounded-full border text-xs">
        {inquiry.drive_url ? (
          <a href={inquiry.drive_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 py-1 pl-2.5 pr-1 font-medium text-primary hover:underline">
            <FolderOpen className="h-3.5 w-3.5" /> Drive <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        <PopoverTrigger asChild>
          {inquiry.drive_url
            ? <button className="py-1 pl-1 pr-2 text-muted-foreground hover:text-foreground" aria-label="Change the Drive folder link"><Pencil className="h-3 w-3" /></button>
            : <button className="inline-flex items-center gap-1 px-2.5 py-1 text-muted-foreground hover:text-foreground"><FolderOpen className="h-3.5 w-3.5" /> Add Drive folder</button>}
        </PopoverTrigger>
      </span>
      <PopoverContent align="start" className="w-[420px] space-y-2 p-3">
        <Label className="text-xs">Google Drive folder link</Label>
        <Input
          value={driveDraft}
          onChange={e => setDriveDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveDriveUrl(); }}
          placeholder="https://drive.google.com/drive/folders/..."
          autoFocus
          className="h-8 text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingDrive(false)}>Cancel</Button>
          <Button size="sm" className="h-8" onClick={saveDriveUrl}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
  const statusMenu = (
    <>
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
    </>
  );
  const tabBar = <ResponsiveTabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)} options={TAB_OPTIONS} />;
  const dialogs = (
    <>
      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        context={{ inquiryId: id }}
        onSaved={() => setTaskRefresh(k => k + 1)}
      />
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
    </>
  );

  // Costing: the sheet takes the whole screen, with a one-line inquiry header and the tab bar above it.
  if (activeTab === 'costing') {
    return (
      <AppLayout>
        <CostingSheet
          inquiryId={id!}
          onInquiryPatched={inq => { setInquiry((i: any) => ({ ...i, ...inq })); setSettingsDraft((d: any) => (d ? { ...d, ...inq } : d)); setRefreshKey(k => k + 1); }}
          lead={actions => (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)} className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Button variant="ghost" size="icon" className="h-8 w-8 -ml-1 shrink-0" onClick={goBack} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Button>
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {titleEl}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{inquiry.rfq_number}</span>
                  {customer && (
                    <button className="hidden min-w-0 truncate text-sm text-muted-foreground hover:text-foreground hover:underline md:block" onClick={() => navigate('/customers')}>
                      {customerFullLabel(customer)}
                    </button>
                  )}
                  {driveChip}
                </div>
                <div className="flex shrink-0 items-center gap-2">{actions}{statusMenu}</div>
              </div>
              {tabBar}
            </Tabs>
          )}
        />
        {dialogs}
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" onClick={goBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <PageBreadcrumbs
            canonical={[{ label: 'Inquiries', to: '/inquiries' }]}
            current={inquiry.title || inquiry.rfq_number}
          />
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm text-muted-foreground">{inquiry.rfq_number}</span>
              {driveChip}
            </div>
            {titleEl}
            {customer && (
              <button
                className="block text-sm text-muted-foreground hover:text-foreground hover:underline mt-1"
                onClick={() => navigate('/customers')}
              >
                {customerFullLabel(customer)}
              </button>
            )}
            <RepeatOfLink inquiryId={inquiry.repeat_of_inquiry_id} />
          </div>
          <div className="flex items-center gap-2">{statusMenu}</div>
        </div>

        {/* Tabs: the bar sits right under the inquiry name so it's always within reach. */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)} className="space-y-4">
          {tabBar}

          <InquiryClockStrip
            inquiryId={id!}
            receivedDate={inquiry.received_date ?? null}
            createdAt={inquiry.created_at ?? null}
            quotedDate={inquiry.quoted_date ?? null}
            status={inquiry.status ?? null}
            refreshKey={refreshKey}
            onQuotedDateChange={date => updateField({ quoted_date: date })}
          />
          <InquirySampleClockStrip inquiryId={id!} refreshKey={refreshKey} />

          {/* Stage counts and the FOB roll-up belong to the product list. */}
          {activeTab === 'products' && (
            <>
              <InquiryStatusCards
                inquiryId={id!}
                refreshKey={refreshKey}
                onCardClick={(filter) => {
                  setProductFilter(filter);
                  setActiveTab('products');
                }}
              />
              <InquiryFobCard inquiryId={id!} refreshKey={refreshKey} />
            </>
          )}

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
            <InquiryVendorRfqSheets inquiryId={id!} refreshKey={refreshKey} />
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
                <div className="md:col-span-2 text-xs text-muted-foreground">
                  Received {inquiry.received_date ?? '—'}. Quoting currency, exchange rate, shipping type, overheads and the other costing assumptions are on the{' '}
                  <button className="text-primary hover:underline" onClick={() => setActiveTab('costing')}>Costing tab</button>, above the sheet.
                </div>
                <div className="md:col-span-2">
                  <Button onClick={saveSettings} size="sm" className="gap-1.5"><Save className="h-3.5 w-3.5" /> Save</Button>
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
              <ArchivedProductsCard inquiryId={id!} onChange={() => setRefreshKey(k => k + 1)} />
          </TabsContent>
        </Tabs>
      </div>

      {dialogs}
    </AppLayout>
  );
}
