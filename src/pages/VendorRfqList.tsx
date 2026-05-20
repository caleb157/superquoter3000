import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, FileText, Trash2 } from 'lucide-react';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  responded: 'bg-amber-100 text-amber-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const TYPE_LABELS: Record<string, string> = {
  boxes: 'Boxes', chemicals: 'Chemicals', hardware: 'Hardware',
  raw_pieces: 'Raw Pieces', custom: 'Custom',
};

const VendorRfqList = () => {
  const navigate = useNavigate();
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const [responses, setResponses] = useState<any[]>([]);

  const fetchAll = async () => {
    const [rfqRes, itemRes, inqRes, custRes, respRes] = await Promise.all([
      (supabase as any).from('vendor_rfqs').select('*').order('created_at', { ascending: false }),
      (supabase as any).from('vendor_rfq_line_items').select('vendor_rfq_id, quantity, estimated_cost, target_price'),
      (supabase as any).from('customer_rfqs').select('id, rfq_number, title, customer_id'),
      (supabase as any).from('customers').select('id, name'),
      (supabase as any).from('vendor_rfq_responses').select('vendor_rfq_id, quoted_unit_price'),
    ]);
    setRfqs(rfqRes.data || []);
    setLineItems(itemRes.data || []);
    setInquiries(inqRes.data || []);
    setCustomers(custRes.data || []);
    setResponses(respRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const inquiryMap = useMemo(() => {
    const m: Record<string, any> = {};
    inquiries.forEach(p => { m[p.id] = p; });
    return m;
  }, [inquiries]);

  const customerMap = useMemo(() => {
    const m: Record<string, any> = {};
    customers.forEach(c => { m[c.id] = c; });
    return m;
  }, [customers]);

  const inquiryLabel = (id: string | null | undefined) => {
    if (!id) return '';
    const i = inquiryMap[id];
    return i ? `${i.rfq_number} — ${i.title || 'Untitled'}` : '';
  };
  const customerName = (inquiryId: string | null | undefined) => {
    const inq = inquiryId ? inquiryMap[inquiryId] : null;
    const c = inq?.customer_id ? customerMap[inq.customer_id] : null;
    return c?.name || '';
  };

  const itemAgg = useMemo(() => {
    const m: Record<string, { count: number; estTotal: number }> = {};
    lineItems.forEach((li: any) => {
      if (!m[li.vendor_rfq_id]) m[li.vendor_rfq_id] = { count: 0, estTotal: 0 };
      m[li.vendor_rfq_id].count++;
      m[li.vendor_rfq_id].estTotal += (li.estimated_cost || 0) * (li.quantity || 0);
    });
    return m;
  }, [lineItems]);

  const respAgg = useMemo(() => {
    const m: Record<string, number> = {};
    responses.forEach((r: any) => {
      if (r.quoted_unit_price != null) m[r.vendor_rfq_id] = (m[r.vendor_rfq_id] || 0) + 1;
    });
    return m;
  }, [responses]);

  const filtered = useMemo(() => {
    return rfqs.filter((r: any) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (typeFilter !== 'all' && r.rfq_type !== typeFilter) return false;
      const searchLower = search.toLowerCase();
      if (search && !(
        (r.rfq_number || '').toLowerCase().includes(searchLower) ||
        (r.title || '').toLowerCase().includes(searchLower) ||
        (r.vendor_name || '').toLowerCase().includes(searchLower) ||
        inquiryLabel(r.customer_rfq_id).toLowerCase().includes(searchLower) ||
        customerName(r.customer_rfq_id).toLowerCase().includes(searchLower)
      )) return false;
      return true;
    });
  }, [rfqs, search, statusFilter, typeFilter, inquiryMap, customerMap]);

  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort({ storageKey: 'rfq-list' });

  const sortedRfqs = useMemo(() => sortItems(filtered, {
    rfq_number: (r: any) => r.rfq_number || '',
    rfq_type: (r: any) => r.rfq_type,
    inquiry: (r: any) => inquiryLabel(r.customer_rfq_id),
    customer: (r: any) => customerName(r.customer_rfq_id),
    vendor: (r: any) => r.vendor_name || '',
    items: (r: any) => itemAgg[r.id]?.count || 0,
    est_total: (r: any) => itemAgg[r.id]?.estTotal || 0,
    status: (r: any) => r.status,
    created_at: (r: any) => r.created_at,
  }), [filtered, sortItems, inquiryMap, customerMap, itemAgg]);

  const deleteRfq = async (rfqId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this Vendor RFQ?')) return;
    const { error } = await (supabase as any).from('vendor_rfqs').delete().eq('id', rfqId);
    if (error) { toast.error(error.message); return; }
    toast.success('Vendor RFQ deleted');
    fetchAll();
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-bold">Vendor RFQs</h1>
        </div>
        <div className="grid grid-cols-2 md:flex md:items-center gap-2 md:gap-3">
          <div className="relative col-span-2 md:flex-1 md:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search Vendor RFQs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="md:w-32 h-9 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="md:w-32 h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : sortedRfqs.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No Vendor RFQs yet. Generate one from an inquiry.</p>
          </CardContent></Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader label="Vendor RFQ #" column="rfq_number" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader label="Type" column="rfq_type" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader label="Inquiry" column="inquiry" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader label="Customer" column="customer" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader label="Vendor" column="vendor" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader label="Items" column="items" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                      <SortableHeader label="Est. Total" column="est_total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                      <SortableHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                      <SortableHeader label="Date" column="created_at" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                      <TableHead className="text-xs w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRfqs.map((r: any) => {
                      const agg = itemAgg[r.id] || { count: 0, estTotal: 0 };
                      return (
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/vendor-rfq/${r.id}`)}>
                          <TableCell className="text-xs font-medium">{r.rfq_number || '—'}</TableCell>
                          <TableCell className="text-xs">{TYPE_LABELS[r.rfq_type] || r.rfq_type}</TableCell>
                          <TableCell className="text-xs">{inquiryLabel(r.customer_rfq_id) || '—'}</TableCell>
                          <TableCell className="text-xs">{customerName(r.customer_rfq_id) || '—'}</TableCell>
                          <TableCell className="text-xs">{r.vendor_name || '—'}</TableCell>
                          <TableCell className="text-xs text-right">{agg.count}</TableCell>
                          <TableCell className="text-xs text-right">{agg.estTotal > 0 ? fmt.inr(agg.estTotal) : '—'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge className={STATUS_COLORS[r.status] || ''} variant="secondary">{r.status}</Badge>
                              {respAgg[r.id] > 0 && (
                                <span className="text-[10px] text-muted-foreground">💬 {respAgg[r.id]}/{agg.count} priced</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">
                            {new Date(r.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => deleteRfq(r.id, e)}>
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {sortedRfqs.map((r: any) => {
                const agg = itemAgg[r.id] || { count: 0, estTotal: 0 };
                return (
                  <Card key={r.id} className="cursor-pointer active:bg-muted/40" onClick={() => navigate(`/vendor-rfq/${r.id}`)}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-mono font-medium">{r.rfq_number || '—'}</span>
                            <Badge className={STATUS_COLORS[r.status] || ''} variant="secondary">{r.status}</Badge>
                            {respAgg[r.id] > 0 && (
                              <span className="text-[10px] text-muted-foreground">💬 {respAgg[r.id]}/{agg.count}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {TYPE_LABELS[r.rfq_type] || r.rfq_type}
                            {r.vendor_name && <span> · {r.vendor_name}</span>}
                          </div>
                          {r.customer_rfq_id && (
                            <div className="text-xs truncate mt-0.5">{inquiryLabel(r.customer_rfq_id)}</div>
                          )}
                          {customerName(r.customer_rfq_id) && (
                            <div className="text-[11px] text-muted-foreground truncate">{customerName(r.customer_rfq_id)}</div>
                          )}
                        </div>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                          onClick={(e) => deleteRfq(r.id, e)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 border-t">
                        <div>
                          <div className="text-muted-foreground">Items</div>
                          <div className="font-medium">{agg.count}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Est. Total</div>
                          <div className="font-medium">{agg.estTotal > 0 ? fmt.inr(agg.estTotal) : '—'}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Date</div>
                          <div className="font-medium">{new Date(r.created_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default VendorRfqList;
