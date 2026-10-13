import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, Images, Search, X } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { TaskDialog } from '@/components/TaskDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { cn } from '@/lib/utils';
import {
  filterMediaItems, loadMediaItems, MEDIA_SOURCES,
  type InquiryRef, type MediaItem, type MediaSource,
} from '@/lib/media-gallery';

const PAGE = 60;

const SOURCE_STYLE: Record<MediaSource, string> = {
  product: 'bg-info/90',
  assembly: 'bg-highlight/90',
  sample: 'bg-warning/90',
  task: 'bg-success/90',
};
const SOURCE_WORD: Record<MediaSource, string> = { product: 'Product', assembly: 'Assembly', sample: 'Sample', task: 'Task' };
const OPEN_WORD: Record<MediaSource, string> = { product: 'Open product', assembly: 'Open assembly', sample: 'Open sample request', task: 'Open task' };

/** Every photo in the app in one grid, newest first, linking back to its record. */
export default function MediaGallery() {
  useDocumentTitle('Media Gallery');
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [inquiries, setInquiries] = useState<InquiryRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState('');
  const [sources, setSources] = useState<MediaSource[]>([]);
  const [inquiryId, setInquiryId] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadMediaItems()
      .then(r => { if (alive) { setItems(r.items); setInquiries(r.inquiries); } })
      .catch(e => { if (alive) setError(e?.message ?? 'Could not load photos'); });
    return () => { alive = false; };
  }, [reloadKey]);

  const filtered = useMemo(() => filterMediaItems(items ?? [], {
    sources, search, inquiryId: inquiryId === 'all' ? null : inquiryId, from: from || null, to: to || null,
  }), [items, sources, search, inquiryId, from, to]);

  useEffect(() => { setShown(PAGE); }, [sources, search, inquiryId, from, to]);

  const counts = useMemo(() => {
    const c: Record<MediaSource, number> = { product: 0, assembly: 0, sample: 0, task: 0 };
    for (const m of items ?? []) c[m.source]++;
    return c;
  }, [items]);

  // Load the next page as the bottom of the grid scrolls into view.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) setShown(n => Math.min(n + PAGE, filtered.length));
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  const visible = filtered.slice(0, shown);
  const groups = useMemo(() => {
    const out: { month: string; rows: { item: MediaItem; index: number }[] }[] = [];
    visible.forEach((item, index) => {
      const month = format(new Date(item.date), 'MMMM yyyy');
      if (out.at(-1)?.month !== month) out.push({ month, rows: [] });
      out.at(-1)!.rows.push({ item, index });
    });
    return out;
  }, [visible]);

  const toggleSource = (s: MediaSource) =>
    setSources(cur => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]);
  const hasFilters = !!(search || sources.length || inquiryId !== 'all' || from || to);
  const clearFilters = () => { setSearch(''); setSources([]); setInquiryId('all'); setFrom(''); setTo(''); };

  const current = openIndex != null ? filtered[openIndex] : null;
  const step = useCallback((d: number) => {
    setOpenIndex(i => {
      if (i == null) return i;
      const n = Math.max(0, Math.min(filtered.length - 1, i + d));
      if (n >= shown) setShown(s => s + PAGE);
      return n;
    });
  }, [filtered.length, shown]);

  useEffect(() => {
    if (openIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, step]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="page-title flex items-center gap-2"><Images className="h-5 w-5 text-muted-foreground" /> Media Gallery</h1>
            <p className="text-sm text-muted-foreground">
              Every photo on products, assemblies, samples and tasks, newest first. Click one to see it large and open its record.
            </p>
          </div>
          {items && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {hasFilters ? `${filtered.length.toLocaleString()} of ${items.length.toLocaleString()}` : items.length.toLocaleString()} photos
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search SKU, name, task, inquiry, customer"
              className="pl-8 h-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MEDIA_SOURCES.map(s => {
              const on = sources.includes(s.key);
              return (
                <Button
                  key={s.key} size="sm" variant={on ? 'default' : 'outline'} className="h-9 gap-1.5"
                  onClick={() => toggleSource(s.key)} aria-pressed={on}
                >
                  <span className={cn('h-2 w-2 rounded-full', SOURCE_STYLE[s.key])} />
                  {s.label}
                  {items && <span className={cn('text-xs tabular-nums', on ? 'opacity-80' : 'text-muted-foreground')}>{counts[s.key]}</span>}
                </Button>
              );
            })}
          </div>
          <Select value={inquiryId} onValueChange={setInquiryId}>
            <SelectTrigger className="h-9 w-full sm:w-60 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All inquiries</SelectItem>
              {inquiries.map(i => (
                <SelectItem key={i.id} value={i.id}>
                  {i.rfq_number}{i.title ? ` · ${i.title}` : ''}{i.customer ? ` (${i.customer})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-[9.5rem]" aria-label="From date" />
            <span>to</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-[9.5rem]" aria-label="To date" />
          </div>
          {hasFilters && (
            <Button size="sm" variant="ghost" className="h-9 gap-1" onClick={clearFilters}><X className="h-4 w-4" /> Clear</Button>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            Could not load photos: {error}{' '}
            <Button size="sm" variant="outline" className="ml-2" onClick={() => setReloadKey(k => k + 1)}>Try again</Button>
          </div>
        )}

        {!items && !error && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Array.from({ length: 18 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
          </div>
        )}

        {items && filtered.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {items.length === 0 ? 'No photos have been uploaded yet.' : 'No photos match these filters.'}
          </div>
        )}

        {groups.map(g => (
          <section key={g.month} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground sticky top-0 z-10 bg-background/95 backdrop-blur py-1">{g.month}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {g.rows.map(({ item, index }) => (
                <Tile key={item.key} item={item} onOpen={() => setOpenIndex(index)} />
              ))}
            </div>
          </section>
        ))}
        {shown < filtered.length && (
          <div ref={sentinel} className="flex justify-center py-4">
            <Button variant="outline" size="sm" onClick={() => setShown(n => n + PAGE)}>Show more</Button>
          </div>
        )}
      </div>

      <Dialog open={current != null} onOpenChange={o => { if (!o) setOpenIndex(null); }}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden gap-0">
          {current && (
            <div className="grid md:grid-cols-[1fr_18rem]">
              <div className="relative bg-black/90 flex items-center justify-center min-h-[50vh] max-h-[80vh]">
                <img src={current.url} alt={current.title} className="max-h-[80vh] max-w-full object-contain" />
                <Button
                  size="icon" variant="secondary" className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full opacity-80"
                  onClick={() => step(-1)} disabled={openIndex === 0} aria-label="Previous photo"
                ><ChevronLeft className="h-5 w-5" /></Button>
                <Button
                  size="icon" variant="secondary" className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full opacity-80"
                  onClick={() => step(1)} disabled={openIndex === filtered.length - 1} aria-label="Next photo"
                ><ChevronRight className="h-5 w-5" /></Button>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <Badge className={cn('text-white border-0', SOURCE_STYLE[current.source])}>{SOURCE_WORD[current.source]}</Badge>
                <DialogTitle className="text-base leading-snug">{current.title}</DialogTitle>
                <dl className="space-y-1.5 text-muted-foreground">
                  {current.sku && <Row label="SKU" value={<span className="font-mono text-foreground">{current.sku}</span>} />}
                  {current.detail && <Row label={current.source === 'task' ? 'Status' : 'Sample'} value={current.detail} />}
                  {current.inquiryId && (
                    <Row label="Inquiry" value={
                      <Link to={`/inquiry/${current.inquiryId}`} className="text-primary hover:underline">
                        {current.inquiryNumber}{current.inquiryTitle ? ` · ${current.inquiryTitle}` : ''}
                      </Link>
                    } />
                  )}
                  {current.customer && <Row label="Customer" value={current.customer} />}
                  <Row label="Date" value={format(new Date(current.date), 'd MMM yyyy')} />
                </dl>
                <div className="flex flex-col gap-2 pt-2">
                  {current.source === 'task' ? (
                    <Button size="sm" onClick={() => setTaskId(current.parentId)}>{OPEN_WORD.task}</Button>
                  ) : current.href ? (
                    <Button size="sm" asChild><Link to={current.href}>{OPEN_WORD[current.source]}</Link></Button>
                  ) : null}
                  <Button size="sm" variant="outline" asChild>
                    <a href={current.url} target="_blank" rel="noreferrer" className="gap-1.5"><ExternalLink className="h-3.5 w-3.5" /> Full size</a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums pt-1">
                  {(openIndex ?? 0) + 1} of {filtered.length} · use ← → to browse
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TaskDialog
        open={taskId != null}
        onOpenChange={o => { if (!o) setTaskId(null); }}
        taskId={taskId ?? undefined}
        onSaved={() => setReloadKey(k => k + 1)}
      />
    </AppLayout>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0">{label}</dt>
      <dd className="min-w-0 text-foreground break-words">{value}</dd>
    </div>
  );
}

function Tile({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button" onClick={onOpen}
      className="group relative aspect-square overflow-hidden rounded-lg border bg-muted text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      title={[item.title, item.sku, item.inquiryNumber].filter(Boolean).join(' · ')}
    >
      {broken ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageOff className="h-6 w-6" /></div>
      ) : (
        <img
          src={item.url} alt={item.title} loading="lazy" decoding="async" onError={() => setBroken(true)}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      )}
      <span className={cn('absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-white', SOURCE_STYLE[item.source])}>
        {SOURCE_WORD[item.source]}
      </span>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-2 pb-1.5 pt-6 text-white">
        <p className="truncate text-xs font-medium">{item.title}</p>
        <p className="truncate text-[10px] opacity-80">{[item.sku, item.inquiryNumber].filter(Boolean).join(' · ') || ' '}</p>
      </div>
    </button>
  );
}
