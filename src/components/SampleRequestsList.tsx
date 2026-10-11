import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { computeSampleClock, type SampleClock } from '@/lib/sample-requests';

type RequestRow = {
  id: string;
  request_number: string;
  customer_rfq_id: string | null;
  requested_date: string;
  customer_requested_date: string | null;
  required_by_date: string | null;
  notes: string | null;
  created_at: string;
  samples: Array<{ id: string; status: string; completed_at: string | null; product: { name: string } | null }>;
};

const TONE: Record<string, string> = {
  neutral: 'text-muted-foreground',
  amber: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-600 dark:text-red-400',
  done: 'text-emerald-700 dark:text-emerald-400',
};

const FILTERS = [
  { key: 'open', label: 'Waiting' },
  { key: 'received', label: 'All received' },
  { key: 'all', label: 'All' },
] as const;

const fmtDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString() : '—');

/** Sample requests, newest first. With `inquiryId` it lists that inquiry's requests only. */
export function SampleRequestsList({ inquiryId, refreshKey }: { inquiryId?: string; refreshKey?: number }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [inquiries, setInquiries] = useState<Record<string, { rfq_number: string; title: string | null; customer: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = usePersistentState<string>(inquiryId ? 'sampleRequests.inquiryFilter' : 'sampleRequests.filter', inquiryId ? 'all' : 'open');
  const [search, setSearch] = usePersistentState<string>('sampleRequests.search', '');

  useEffect(() => {
    (async () => {
      setLoading(true);
      let query = (supabase as any).from('sample_requests')
        .select('id, request_number, customer_rfq_id, requested_date, customer_requested_date, required_by_date, notes, created_at, samples(id, status, completed_at, product:products(name))')
        .order('requested_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (inquiryId) query = query.eq('customer_rfq_id', inquiryId);
      const { data } = await query;
      const list = (data ?? []) as RequestRow[];
      setRows(list);
      if (!inquiryId) {
        const ids = Array.from(new Set(list.map(r => r.customer_rfq_id).filter(Boolean))) as string[];
        if (ids.length) {
          const { data: inqs } = await (supabase as any).from('customer_rfqs')
            .select('id, rfq_number, title, customers(name, company)').in('id', ids);
          const map: Record<string, { rfq_number: string; title: string | null; customer: string | null }> = {};
          ((inqs ?? []) as any[]).forEach(i => {
            map[i.id] = { rfq_number: i.rfq_number, title: i.title, customer: i.customers?.company || i.customers?.name || null };
          });
          setInquiries(map);
        }
      }
      setLoading(false);
    })();
  }, [inquiryId, refreshKey]);

  const withClock = useMemo(() => rows.map(r => ({ r, clock: computeSampleClock(r, r.samples ?? []) })), [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withClock.filter(({ r, clock }) => {
      if (filter === 'open' && clock.state !== 'open') return false;
      if (filter === 'received' && clock.state !== 'received') return false;
      if (!q) return true;
      const inq = r.customer_rfq_id ? inquiries[r.customer_rfq_id] : null;
      return [r.request_number, inq?.rfq_number, inq?.title, inq?.customer, ...(r.samples ?? []).map(s => s.product?.name)]
        .filter(Boolean).join('\n').toLowerCase().includes(q);
    });
  }, [withClock, filter, search, inquiries]);

  const count = (key: string) => withClock.filter(({ clock }) => key === 'all' || clock.state === key).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn('rounded-full border px-3 py-1 text-xs', filter === f.key ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
          >
            {f.label} <span className="opacity-60">{count(f.key)}</span>
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Search request, inquiry, customer, product..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? 'No sample requests yet. Tick products on an inquiry and press Request samples.' : 'Nothing matches.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Request</TableHead>
                  {!inquiryId && <TableHead className="text-xs">Inquiry</TableHead>}
                  <TableHead className="text-xs">Products</TableHead>
                  <TableHead className="text-xs">Requested</TableHead>
                  <TableHead className="text-xs">Required by</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(({ r, clock }) => {
                  const inq = r.customer_rfq_id ? inquiries[r.customer_rfq_id] : null;
                  const names = (r.samples ?? []).filter(s => s.status !== 'cancelled').map(s => s.product?.name).filter(Boolean) as string[];
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/samples/${r.id}`)}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{r.request_number}</TableCell>
                      {!inquiryId && (
                        <TableCell className="text-xs">
                          {inq ? <><div className="font-mono">{inq.rfq_number}</div><div className="text-muted-foreground">{inq.customer ?? inq.title}</div></> : '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-xs max-w-[280px]">
                        <span className="line-clamp-2">{names.slice(0, 4).join(', ')}{names.length > 4 ? ` +${names.length - 4} more` : ''}</span>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.requested_date)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.required_by_date)}</TableCell>
                      <TableCell className={cn('text-xs', TONE[clock.tone])}>
                        <ClockText clock={clock} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClockText({ clock }: { clock: SampleClock }) {
  if (clock.state === 'empty') return <span>No samples</span>;
  return (
    <span>
      <span className="font-medium tabular-nums">{clock.received} of {clock.total} received</span>
      <span className="block opacity-80">{clock.label.replace(/, \d+ of \d+ received$/, '')}</span>
    </span>
  );
}
