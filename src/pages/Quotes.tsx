import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { Copy, RefreshCw, Loader2, Search, CalendarIcon, X, ExternalLink, Eye, Pencil } from 'lucide-react';
import { EditQuoteLinesDialog } from '@/components/EditQuoteLinesDialog';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';

const STATUS_OPTIONS = ['draft', 'sent', 'approved', 'expired'];

const Quotes = () => {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<Record<string, { rfq_number: string; title: string | null }>>({});
  const [entities, setEntities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectionsSnap, setSelectionsSnap] = useState<any | null>(null);
  const [editSnap, setEditSnap] = useState<any | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterInquiry, setFilterInquiry] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterEntity, setFilterEntity] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<any>({
    storageKey: 'quotes-sort',
  });

  const fetchData = async () => {
    setLoading(true);
    const [snapRes, inqRes, entRes] = await Promise.all([
      (supabase as any).from('quote_snapshots').select('*').order('created_at', { ascending: false }),
      (supabase as any).from('customer_rfqs').select('id, rfq_number, title'),
      (supabase as any).from('company_entities').select('id, name'),
    ]);

    setSnapshots(snapRes.data || []);

    const inqMap: Record<string, { rfq_number: string; title: string | null }> = {};
    (inqRes.data || []).forEach((i: any) => { inqMap[i.id] = { rfq_number: i.rfq_number, title: i.title }; });
    setInquiries(inqMap);

    const entMap: Record<string, string> = {};
    (entRes.data || []).forEach((e: any) => { entMap[e.id] = e.name; });
    setEntities(entMap);

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const statusVariant = (status: string) => {
    switch (status) {
      case 'approved': return 'default';
      case 'sent': return 'secondary';
      case 'expired': return 'destructive';
      case 'draft': return 'outline';
      default: return 'outline';
    }
  };

  const updateStatus = async (snapId: string, newStatus: string) => {
    const updates: any = { status: newStatus };
    if (newStatus === 'approved') updates.approved_at = new Date().toISOString();
    if (newStatus === 'sent') updates.sent_at = new Date().toISOString();

    const { error } = await (supabase as any).from('quote_snapshots').update(updates).eq('id', snapId);
    if (error) { toast.error('Failed to update status'); return; }
    setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, ...updates } : s));
    toast.success(`Quote marked as ${newStatus}`);
  };

  const deleteQuote = async (snapId: string) => {
    const { error } = await (supabase as any).from('quote_snapshots').delete().eq('id', snapId);
    if (error) throw new Error(error.message);
    setSnapshots(prev => prev.filter(s => s.id !== snapId));
  };

  const inquiryLabel = (id: string | null | undefined) => {
    if (!id) return '';
    const i = inquiries[id];
    return i ? `${i.rfq_number} — ${i.title || 'Untitled'}` : '';
  };

  const filtered = useMemo(() => {
    let result = snapshots.filter(snap => {
      if (search) {
        const s = search.toLowerCase();
        const inqName = inquiryLabel(snap.customer_rfq_id);
        const quoteNum = snap.quote_number || '';
        if (!quoteNum.toLowerCase().includes(s) && !inqName.toLowerCase().includes(s)) return false;
      }
      if (filterInquiry !== 'all' && snap.customer_rfq_id !== filterInquiry) return false;
      if (filterStatus !== 'all' && (snap.status || 'draft') !== filterStatus) return false;
      if (filterEntity !== 'all' && snap.entity_id !== filterEntity) return false;
      if (dateFrom) {
        const created = new Date(snap.created_at);
        if (created < dateFrom) return false;
      }
      if (dateTo) {
        const created = new Date(snap.created_at);
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        if (created > endOfDay) return false;
      }
      return true;
    });

    const getters: Record<string, (s: any) => string | number> = {
      quote_number: (s) => (s.quote_number || '').toLowerCase(),
      inquiry: (s) => inquiryLabel(s.customer_rfq_id).toLowerCase(),
      entity: (s) => (entities[s.entity_id] || '').toLowerCase(),
      date: (s) => new Date(s.created_at).getTime(),
      valid_until: (s) => s.valid_until ? new Date(s.valid_until).getTime() : 0,
      skus: (s) => (s.totals as any)?.sku_count || 0,
      qty: (s) => (s.totals as any)?.total_qty || 0,
      cbm: (s) => (s.totals as any)?.total_cbm || 0,
      total: (s) => (s.totals as any)?.grand_total || 0,
      status: (s) => STATUS_OPTIONS.indexOf(s.status || 'draft'),
    };

    return sortItems(result, getters);
  }, [snapshots, search, filterInquiry, filterStatus, filterEntity, dateFrom, dateTo, inquiries, entities, sortColumn, sortDirection]);

  const inquiryList = useMemo(() => {
    const ids = new Set(snapshots.map(s => s.customer_rfq_id).filter(Boolean));
    return Array.from(ids).map(id => ({ id: id as string, name: inquiryLabel(id) || 'Unknown' })).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshots, inquiries]);

  const entityList = useMemo(() => {
    const ids = new Set(snapshots.map(s => s.entity_id).filter(Boolean));
    return Array.from(ids).map(id => ({ id, name: entities[id] || 'Unknown' })).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshots, entities]);

  const hasActiveFilters = search || filterInquiry !== 'all' || filterStatus !== 'all' || filterEntity !== 'all' || dateFrom || dateTo;

  const clearFilters = () => {
    setSearch('');
    setFilterInquiry('all');
    setFilterStatus('all');
    setFilterEntity('all');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold">All Quotes</h1>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 lg:flex lg:items-center gap-2 lg:gap-3 lg:flex-wrap mb-4">
          <div className="relative col-span-2 lg:flex-1 lg:min-w-[180px] lg:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search quote # or inquiry..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={filterInquiry} onValueChange={setFilterInquiry}>
            <SelectTrigger className="lg:w-48 h-9 text-xs"><SelectValue placeholder="All Inquiries" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Inquiries</SelectItem>
              {inquiryList.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterEntity} onValueChange={setFilterEntity}>
            <SelectTrigger className="lg:w-40 h-9 text-xs"><SelectValue placeholder="All Entities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entities</SelectItem>
              {entityList.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="lg:w-36 h-9 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-9 text-xs gap-1.5 lg:min-w-[120px] justify-start", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateFrom ? format(dateFrom, 'MMM d, yyyy') : 'From date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-9 text-xs gap-1.5 lg:min-w-[120px] justify-start", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateTo ? format(dateTo, 'MMM d, yyyy') : 'To date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1 col-span-2 lg:col-span-1" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

        {loading ? (
          <Card><CardContent className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent></Card>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            {snapshots.length === 0
              ? 'No quotes generated yet. Generate one from an inquiry\'s products tab.'
              : 'No quotes match the current filters.'}
          </CardContent></Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader column="quote_number" label="Quote #" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader column="inquiry" label="Inquiry" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader column="entity" label="Entity" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader column="date" label="Date" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader column="valid_until" label="Valid Until" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader column="skus" label="SKUs" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                      <SortableHeader column="qty" label="Qty" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                      <SortableHeader column="cbm" label="CBM" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                      <SortableHeader column="total" label="Total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                      <TableHead className="text-xs">Currency</TableHead>
                      <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <TableHead className="text-xs">Viewed</TableHead>
                      <TableHead className="text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((snap: any) => {
                      const totals = (snap.totals || {}) as any;
                      const sym = snap.currency === 'INR' ? '₹' : '$';
                      const viewedAt = snap.viewed_at ? new Date(snap.viewed_at).toLocaleDateString() : '—';
                      const approvedAt = snap.approved_at ? new Date(snap.approved_at).toLocaleDateString() : null;

                      return (
                        <TableRow key={snap.id}>
                          <TableCell className="text-xs font-mono font-medium">{snap.quote_number || '—'}</TableCell>
                          <TableCell className="text-xs">
                            {snap.customer_rfq_id ? (
                              <Link to={`/inquiry/${snap.customer_rfq_id}`} className="text-primary hover:underline">
                                {inquiryLabel(snap.customer_rfq_id) || 'Inquiry'}
                              </Link>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {snap.entity_id ? entities[snap.entity_id] || '—' : '—'}
                          </TableCell>
                          <TableCell className="text-xs">{new Date(snap.created_at).toLocaleDateString()}</TableCell>
                          <TableCell className="text-xs">
                            {snap.valid_until ? new Date(snap.valid_until).toLocaleDateString() : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-right">{totals.sku_count ?? '—'}</TableCell>
                          <TableCell className="text-xs text-right">{totals.total_qty?.toLocaleString() ?? '—'}</TableCell>
                          <TableCell className="text-xs text-right">{totals.total_cbm != null ? Number(totals.total_cbm).toFixed(2) : '—'}</TableCell>
                          <TableCell className="text-xs text-right font-medium">
                            {totals.grand_total != null
                              ? `${sym}${Number(totals.grand_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </TableCell>
                          <TableCell className="text-xs">{snap.currency || 'USD'}</TableCell>
                          <TableCell>
                            <Select value={snap.status || 'draft'} onValueChange={v => updateStatus(snap.id, v)}>
                              <SelectTrigger className="h-7 w-24 text-[10px] p-1">
                                <Badge variant={statusVariant(snap.status) as any} className="text-[10px]">
                                  {snap.status || 'draft'}
                                </Badge>
                              </SelectTrigger>
                              <SelectContent>
                                {STATUS_OPTIONS.map(s => (
                                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {approvedAt && (
                              <p className="text-[9px] text-muted-foreground mt-0.5">Approved {approvedAt}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{viewedAt}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {snap.share_token && (
                                <>
                                  <Button
                                    variant="ghost" size="sm" className="text-xs h-7 gap-1"
                                    onClick={() => {
                                      const url = `${window.location.origin}/quote/${snap.share_token}`;
                                      navigator.clipboard.writeText(url);
                                      toast.success('Share link copied!');
                                    }}
                                  >
                                    <Copy className="h-3 w-3" /> Link
                                  </Button>
                                  <Button
                                    variant="ghost" size="sm" className="text-xs h-7 gap-1"
                                    asChild
                                  >
                                    <Link to={`/quote/${snap.share_token}`} target="_blank">
                                      <ExternalLink className="h-3 w-3" /> Preview
                                    </Link>
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="ghost" size="sm" className="text-xs h-7 gap-1"
                                onClick={() => setEditSnap(snap)}
                              >
                                <Pencil className="h-3 w-3" /> Edit
                              </Button>
                              {snap.customer_selections && (
                                <Button
                                  variant="ghost" size="sm" className="text-xs h-7 gap-1"
                                  onClick={() => setSelectionsSnap(snap)}
                                >
                                  <Eye className="h-3 w-3" /> Selections
                                </Button>
                              )}
                              <ConfirmDeleteButton
                                itemLabel={`quote ${snap.quote_number || ''}`.trim()}
                                description="This permanently removes the quote snapshot. The originating inquiry and products are not affected. This cannot be undone."
                                onConfirm={() => deleteQuote(snap.id)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {filtered.map((snap: any) => {
                const totals = (snap.totals || {}) as any;
                const sym = snap.currency === 'INR' ? '₹' : '$';
                return (
                  <Card key={snap.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-mono font-medium truncate">{snap.quote_number || '—'}</div>
                          {snap.customer_rfq_id && (
                            <Link to={`/inquiry/${snap.customer_rfq_id}`} className="text-xs text-primary hover:underline block truncate">
                              {inquiryLabel(snap.customer_rfq_id) || 'Inquiry'}
                            </Link>
                          )}
                          {snap.entity_id && (
                            <div className="text-[10px] text-muted-foreground truncate">{entities[snap.entity_id]}</div>
                          )}
                        </div>
                        <Badge variant={statusVariant(snap.status) as any} className="text-[10px] shrink-0">
                          {snap.status || 'draft'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <div className="text-muted-foreground">Total</div>
                          <div className="font-medium">
                            {totals.grand_total != null
                              ? `${sym}${Number(totals.grand_total).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                              : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Qty</div>
                          <div className="font-medium">{totals.total_qty?.toLocaleString() ?? '—'}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Date</div>
                          <div className="font-medium">{new Date(snap.created_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <div className="flex gap-1 pt-1 border-t flex-wrap">
                        {snap.share_token && (
                          <>
                            <Button
                              variant="ghost" size="sm" className="text-[11px] h-7 gap-1"
                              onClick={() => {
                                const url = `${window.location.origin}/quote/${snap.share_token}`;
                                navigator.clipboard.writeText(url);
                                toast.success('Share link copied!');
                              }}
                            >
                              <Copy className="h-3 w-3" /> Link
                            </Button>
                            <Button variant="ghost" size="sm" className="text-[11px] h-7 gap-1" asChild>
                              <Link to={`/quote/${snap.share_token}`} target="_blank">
                                <ExternalLink className="h-3 w-3" /> Open
                              </Link>
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost" size="sm" className="text-[11px] h-7 gap-1"
                          onClick={() => setEditSnap(snap)}
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        {snap.customer_selections && (
                          <Button
                            variant="ghost" size="sm" className="text-[11px] h-7 gap-1"
                            onClick={() => setSelectionsSnap(snap)}
                          >
                            <Eye className="h-3 w-3" /> Selections
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {/* Customer Selections Dialog */}
        <Dialog open={!!selectionsSnap} onOpenChange={(open) => !open && setSelectionsSnap(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Customer Selections</DialogTitle>
              <DialogDescription>
                {selectionsSnap?.quote_number || 'Quote'} — {inquiryLabel(selectionsSnap?.customer_rfq_id) || 'Inquiry'}
              </DialogDescription>
            </DialogHeader>
            {selectionsSnap?.customer_selections ? (
              <div className="space-y-4">
                {selectionsSnap.customer_selections.draft_saved_at && (
                  <p className="text-xs text-muted-foreground">
                    Last saved: {new Date(selectionsSnap.customer_selections.draft_saved_at).toLocaleString()}
                  </p>
                )}
                {selectionsSnap.customer_selections.summary?.confirmed_at && (
                  <Badge className="bg-emerald-600 text-xs">
                    Confirmed {new Date(selectionsSnap.customer_selections.summary.confirmed_at).toLocaleString()}
                  </Badge>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs">SKU</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs">Variant</TableHead>
                      <TableHead className="text-xs text-right">Line Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectionsSnap.customer_selections.products || []).map((p: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{p.name}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{p.sku || '—'}</TableCell>
                        <TableCell className="text-xs text-right font-medium">{p.quantity?.toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{p.selectedVariant || '—'}</TableCell>
                        <TableCell className="text-xs text-right">
                          {p.line_total != null
                            ? `${selectionsSnap.currency === 'INR' ? '₹' : '$'}${Number(p.line_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No customer selections saved yet.</p>
            )}
          </DialogContent>
        </Dialog>

        <EditQuoteLinesDialog
          open={!!editSnap}
          onOpenChange={(o) => !o && setEditSnap(null)}
          snapshot={editSnap}
          onSaved={(patch) => {
            // Merge optimistic patch into local state so the row updates instantly,
            // then refetch in the background to pick up any server-side changes.
            setSnapshots(prev =>
              prev.map(s => s.id === patch.id ? { ...s, products: patch.products, totals: patch.totals, ...(patch.payment_terms !== undefined ? { payment_terms: patch.payment_terms } : {}) } : s),
            );
            setEditSnap(prev => prev && prev.id === patch.id ? { ...prev, products: patch.products, totals: patch.totals, ...(patch.payment_terms !== undefined ? { payment_terms: patch.payment_terms } : {}) } : prev);
            fetchData();
          }}
        />
      </div>
    </AppLayout>
  );
};

export default Quotes;
