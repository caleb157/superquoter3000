import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Package2, Search, Clock } from 'lucide-react';
import { differenceInDays, parseISO, format } from 'date-fns';
import { GenerateSampleDialog } from '@/components/GenerateSampleDialog';
import { cn } from '@/lib/utils';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

type Sample = {
  id: string;
  product_id: string | null;
  customer_rfq_id: string | null;
  vendor_id: string | null;
  vendor: { name: string } | null;
  status: string;
  requested_date: string | null;
  completed_at: string | null;
  created_at: string;
};

type Inquiry = { id: string; rfq_number: string; title: string | null; customer_id: string | null; status: string };
type Customer = { id: string; name: string; company: string | null };
type Product = { id: string; name: string };

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

type SortKey = 'newest' | 'oldest' | 'inquiry' | 'days';

function daysToSample(s: Sample): number | null {
  if (!s.completed_at || !s.requested_date) return null;
  return differenceInDays(parseISO(s.completed_at), parseISO(s.requested_date));
}

export default function SamplesList() {
  const navigate = useNavigate();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  const fetchAll = async () => {
    const [sampleRes, inqRes, custRes, prodRes] = await Promise.all([
      (supabase as any).from('samples').select('*, vendor:vendors(name)').order('created_at', { ascending: false }),
      supabase.from('customer_rfqs').select('id, rfq_number, title, customer_id, status'),
      supabase.from('customers').select('id, name, company'),
      supabase.from('products').select('id, name'),
    ]);
    setSamples((sampleRes.data || []) as Sample[]);
    setInquiries((inqRes.data || []) as Inquiry[]);
    setCustomers((custRes.data || []) as Customer[]);
    setProducts((prodRes.data || []) as Product[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const inquiryById = useMemo(() => Object.fromEntries(inquiries.map(i => [i.id, i])), [inquiries]);
  const customerById = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);
  const productById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: samples.length };
    samples.forEach(s => { c[s.status] = (c[s.status] || 0) + 1; });
    return c;
  }, [samples]);

  // Metrics
  const pending = samples.filter(s => s.status === 'pending');
  const pendingWithVendor = pending.filter(s => s.vendor_id).length;
  const pendingWithoutVendor = pending.length - pendingWithVendor;

  const completedDays = samples
    .filter(s => s.status === 'completed')
    .map(daysToSample)
    .filter((d): d is number => d !== null);
  const avgDays = completedDays.length
    ? completedDays.reduce((a, b) => a + b, 0) / completedDays.length
    : null;

  // Filter / search / sort
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = samples.filter(s => statusFilter === 'all' || s.status === statusFilter);
    if (q) {
      list = list.filter(s => {
        const product = s.product_id ? productById[s.product_id] : null;
        const inq = s.customer_rfq_id ? inquiryById[s.customer_rfq_id] : null;
        const productName = product?.name?.toLowerCase() ?? '';
        const vendorName = (s.vendor?.name ?? '').toLowerCase();
        const inqNumber = (inq?.rfq_number ?? '').toLowerCase();
        return productName.includes(q) || vendorName.includes(q) || inqNumber.includes(q);
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'newest': return b.created_at.localeCompare(a.created_at);
        case 'oldest': return a.created_at.localeCompare(b.created_at);
        case 'inquiry': {
          const ai = a.customer_rfq_id ? inquiryById[a.customer_rfq_id]?.rfq_number ?? '' : '';
          const bi = b.customer_rfq_id ? inquiryById[b.customer_rfq_id]?.rfq_number ?? '' : '';
          return ai.localeCompare(bi);
        }
        case 'days': {
          const ad = daysToSample(a) ?? Infinity;
          const bd = daysToSample(b) ?? Infinity;
          return bd - ad;
        }
      }
    });
    return sorted;
  }, [samples, statusFilter, search, sortKey, inquiryById, productById]);

  const activeInquiries = useMemo(
    () => inquiries.filter(i => i.status !== 'cancelled').map(i => ({ id: i.id, rfq_number: i.rfq_number, title: i.title })),
    [inquiries],
  );

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-serif font-medium tracking-tight flex items-center gap-2"><Package2 className="h-5 w-5" /> Samples</h1>
          <Button size="sm" className="ml-auto gap-1.5" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Sample
          </Button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Samples Pending</div>
              <div className="text-3xl font-bold tabular-nums mt-1">{pending.length}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {pendingWithVendor} with vendor · {pendingWithoutVendor} without
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> Avg Time-to-Sample
              </div>
              <div className="text-3xl font-bold tabular-nums mt-1">
                {avgDays !== null ? `${avgDays.toFixed(1)} days` : '—'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {completedDays.length} completed sample{completedDays.length === 1 ? '' : 's'}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search product, vendor, inquiry…"
              className="h-9 pl-7 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(f => {
              const active = statusFilter === f.key;
              const n = counts[f.key] ?? 0;
              return (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition',
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted text-muted-foreground border-border',
                  )}
                >
                  <span>{f.label}</span>
                  <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-primary-foreground/20' : 'bg-muted')}>{n}</span>
                </button>
              );
            })}
          </div>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-9 w-[140px] text-xs ml-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest" className="text-xs">Newest</SelectItem>
              <SelectItem value="oldest" className="text-xs">Oldest</SelectItem>
              <SelectItem value="inquiry" className="text-xs">Inquiry #</SelectItem>
              <SelectItem value="days" className="text-xs">Days-to-sample</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : visible.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Package2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No samples match these filters.</p>
          </CardContent></Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden md:block"><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs">Inquiry</TableHead>
                  <TableHead className="text-xs">Customer</TableHead>
                  <TableHead className="text-xs">Vendor</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Requested</TableHead>
                  <TableHead className="text-xs">Completed</TableHead>
                  <TableHead className="text-xs text-right">Days</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {visible.map(s => {
                    const product = s.product_id ? productById[s.product_id] : null;
                    const inq = s.customer_rfq_id ? inquiryById[s.customer_rfq_id] : null;
                    const cust = inq?.customer_id ? customerById[inq.customer_id] : null;
                    const days = daysToSample(s);
                    return (
                      <TableRow
                        key={s.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => s.product_id && navigate(`/product/${s.product_id}?tab=sample-log`)}
                      >
                        <TableCell className="text-sm">{product?.name ?? '—'}</TableCell>
                        <TableCell className="text-xs font-mono">{inq?.rfq_number ?? '—'}</TableCell>
                        <TableCell className="text-xs">{cust?.name ?? cust?.company ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.vendor?.name ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn('text-[10px]', STATUS_COLOR[s.status])}>{s.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.requested_date ? format(parseISO(s.requested_date), 'MMM d, yyyy') : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.completed_at ? format(parseISO(s.completed_at), 'MMM d, yyyy') : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {days !== null ? `${days}d` : (s.status === 'cancelled' ? '' : '—')}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {visible.map(s => {
                const product = s.product_id ? productById[s.product_id] : null;
                const inq = s.customer_rfq_id ? inquiryById[s.customer_rfq_id] : null;
                const cust = inq?.customer_id ? customerById[inq.customer_id] : null;
                const days = daysToSample(s);
                return (
                  <Card
                    key={s.id}
                    className="cursor-pointer active:bg-accent/50"
                    onClick={() => s.product_id && navigate(`/product/${s.product_id}?tab=sample-log`)}
                  >
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm truncate">{product?.name ?? '—'}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {s.vendor?.name ?? 'No vendor'}
                            {inq?.rfq_number && <span> · {inq.rfq_number}</span>}
                            {(cust?.name || cust?.company) && <span> · {cust?.name ?? cust?.company}</span>}
                          </div>
                        </div>
                        <Badge variant="secondary" className={cn('text-[10px] shrink-0', STATUS_COLOR[s.status])}>{s.status}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                        <span>
                          {s.requested_date ? format(parseISO(s.requested_date), 'MMM d') : '—'}
                          {s.completed_at && <span> → {format(parseISO(s.completed_at), 'MMM d')}</span>}
                        </span>
                        <span>{days !== null ? `${days}d` : ''}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      <GenerateSampleDialog
        open={showNew}
        onOpenChange={setShowNew}
        inquiryOptions={activeInquiries}
        onCreated={fetchAll}
      />
    </AppLayout>
  );
}
