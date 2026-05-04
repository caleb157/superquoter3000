import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Trash2, Pencil } from 'lucide-react';
import { differenceInDays, parseISO, format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ReceivedRfsList } from '@/components/ReceivedRfsList';

type Sample = {
  id: string;
  product_id: string | null;
  vendor: { name: string } | null;
  status: string;
  requested_date: string | null;
  completed_at: string | null;
  required_by_date: string | null;
  dimensions_inch: string | null;
  finish: string | null;
  notes: string | null;
  product?: { name: string; sku: string | null } | null;
};

const STATUSES = ['pending', 'completed', 'cancelled'] as const;

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function timeToSample(s: Sample): string {
  if (s.status === 'cancelled') return '';
  if (!s.completed_at || !s.requested_date) return '—';
  const days = differenceInDays(parseISO(s.completed_at), parseISO(s.requested_date));
  return `${days}d`;
}

export function InquirySamplesTab({ inquiryId, refreshKey }: { inquiryId: string; refreshKey: number }) {
  const navigate = useNavigate();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [filter, setFilter] = useState<string>('all');

  const fetchSamples = async () => {
    const { data } = await (supabase as any)
      .from('samples')
      .select('*, product:products(name, sku), vendor:vendors(name)')
      .eq('customer_rfq_id', inquiryId)
      .order('created_at', { ascending: false });
    setSamples((data ?? []) as Sample[]);
  };

  useEffect(() => { fetchSamples(); }, [inquiryId, refreshKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: samples.length };
    samples.forEach(s => { c[s.status] = (c[s.status] || 0) + 1; });
    return c;
  }, [samples]);

  const filtered = useMemo(
    () => filter === 'all' ? samples : samples.filter(s => s.status === filter),
    [samples, filter],
  );

  const setStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase.from('samples').update({ status: newStatus }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    fetchSamples();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this sample?')) return;
    const { error } = await supabase.from('samples').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Sample deleted');
    fetchSamples();
  };

  if (samples.length === 0) {
    return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No samples yet.</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => {
          const active = filter === f.key;
          const n = counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-muted text-muted-foreground border-border',
              )}
            >
              <span>{f.label}</span>
              <span className={cn(
                'rounded-full px-1.5 text-[10px] tabular-nums',
                active ? 'bg-primary-foreground/20' : 'bg-muted',
              )}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Product</TableHead>
            <TableHead className="text-xs">Vendor</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Requested</TableHead>
            <TableHead className="text-xs">Completed</TableHead>
            <TableHead className="text-xs text-right">Time-to-sample</TableHead>
            <TableHead className="text-xs w-20"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map(s => (
              <TableRow key={s.id}>
                <TableCell className="text-sm">
                  {s.product?.name ? (
                    <button className="hover:underline text-left flex flex-col items-start" onClick={() => navigate(`/product/${s.product_id}?tab=sample-log`)}>
                      <span>{s.product.name}</span>
                      {s.product.sku && <span className="italic text-[11px] font-normal text-muted-foreground/70">{s.product.sku}</span>}
                    </button>
                  ) : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.vendor?.name ?? '—'}</TableCell>
                <TableCell>
                  <Select value={s.status} onValueChange={(v) => setStatus(s.id, v)}>
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue>
                        <Badge variant="secondary" className={cn('text-[10px]', STATUS_COLOR[s.status])}>{s.status}</Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(st => <SelectItem key={st} value={st} className="text-xs">{st}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {s.requested_date ? format(parseISO(s.requested_date), 'MMM d, yyyy') : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {s.completed_at ? format(parseISO(s.completed_at), 'MMM d, yyyy') : '—'}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">{timeToSample(s)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(`/product/${s.product_id}?tab=sample-log`)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => remove(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {filtered.map(s => (
          <Card
            key={s.id}
            className="cursor-pointer active:bg-accent/50"
            onClick={() => s.product_id && navigate(`/product/${s.product_id}?tab=sample-log`)}
          >
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{s.product?.name ?? '—'}</div>
                  {s.product?.sku && <div className="italic text-[11px] text-muted-foreground/70 truncate">{s.product.sku}</div>}
                  <div className="text-[11px] text-muted-foreground truncate">
                    {s.vendor?.name ?? 'No vendor'}
                  </div>
                </div>
                <div onClick={e => e.stopPropagation()}>
                  <Select value={s.status} onValueChange={(v) => setStatus(s.id, v)}>
                    <SelectTrigger className="h-9 w-28 text-xs">
                      <SelectValue>
                        <Badge variant="secondary" className={cn('text-[10px]', STATUS_COLOR[s.status])}>{s.status}</Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(st => <SelectItem key={st} value={st} className="text-xs">{st}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>
                  {s.requested_date ? format(parseISO(s.requested_date), 'MMM d') : '—'}
                  {s.completed_at && <span> → {format(parseISO(s.completed_at), 'MMM d')}</span>}
                </span>
                <span className="flex items-center gap-1">
                  <span>{timeToSample(s)}</span>
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9 text-destructive -mr-2"
                    onClick={(e) => { e.stopPropagation(); remove(s.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
