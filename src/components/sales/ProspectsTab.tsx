// Prospects: every company from the list runs (full TAM, filtered TAM, persona lists, weekly picks, trade, Waalaxy, Apollo),
// searched and paged on the server. Move a company up or down a tier by hand (kept through re-scores, logged), pin it,
// exclude it, or put it into the pipeline. The Load file button brings in a whole list run in one go.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowDown, ArrowUp, Ban, ChevronDown, ExternalLink, Pin, PinOff, RotateCcw, Search, Send, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Batcher, LIST_KIND_LABELS, LIST_KIND_ORDER, PROSPECT_STATUS_LABELS, PROSPECT_TIERS, TAG_LABELS, TIER_LABELS,
  filtersToParams, moveTier, paramsToFilters, searchArgs, splitLines, typeLabel,
  type LoadBatch, type ProspectFilters, type ProspectStatus, type ProspectTier,
} from '@/lib/sales/prospects';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;
const PAGE = 50;

type Facet = { v: string; n: number };
type ListFacet = { id: string; name: string; kind: string; n: number; run_date: string | null; description: string | null };
type Facets = { total: number; in_crm: number; lists: ListFacet[]; types: Facet[]; tiers: Facet[]; countries: Facet[]; tags: Facet[]; status: Facet[] };
export type ProspectRow = {
  id: string; name: string; domain: string | null; website: string | null; country: string | null; state: string | null; city: string | null;
  prospect_type: string | null; tags: string[] | null; score: number | null; tier: string | null; rank: number | null; tier_override: string | null;
  pinned: boolean; effective_tier: ProspectTier; status: ProspectStatus; excluded_reason: string | null; customer_id: string | null; dnc: boolean;
  people_count: number; best_contact: string | null; best_contact_title: string | null; trade_shipments: number | null; trade_value_2025: number | null;
  employees: number | null; linkedin_url: string | null; email: string | null; sources: string[] | null; products: string | null; lists: string[] | null;
};

const TIER_COLOR: Record<string, string> = {
  A: 'bg-success/15 text-success', B: 'bg-primary/15 text-primary', C: 'bg-warning/15 text-warning', D: 'bg-muted text-muted-foreground', X: 'bg-destructive/10 text-destructive',
};
const money = (v: number | null | undefined) => (v == null ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
const n = (v: number) => v.toLocaleString('en-US');

export function ProspectsTab() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<ProspectFilters>(() => paramsToFilters(k => params.get(k)));
  const [qInput, setQInput] = useState(filters.q ?? '');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ProspectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [loader, setLoader] = useState(false);
  const reqId = useRef(0);

  const loadFacets = async () => {
    const { data, error } = await db.rpc('prospect_facets');
    if (error) { setMissing(true); return; }
    setFacets(data);
  };
  useEffect(() => { void loadFacets(); }, []);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setFilters(f => (f.q ?? '') === qInput ? f : { ...f, q: qInput }), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // keep filters in the URL so a view can be bookmarked
  useEffect(() => {
    setParams(p => {
      for (const k of [...p.keys()]) if (k === 'pq' || k.startsWith('p_')) p.delete(k);
      for (const [k, v] of Object.entries(filtersToParams(filters))) p.set(k, v);
      return p;
    }, { replace: true });
    setPage(0);
  }, [filters]);

  const search = async () => {
    const id = ++reqId.current;
    setLoading(true);
    const { data, error } = await db.rpc('search_prospects', searchArgs(filters, page, PAGE));
    if (id !== reqId.current) return;
    setLoading(false);
    if (error) { if (/function|does not exist/i.test(error.message)) setMissing(true); else toast.error(error.message); return; }
    setRows(data?.rows ?? []); setTotal(data?.total ?? 0);
  };
  useEffect(() => { void search(); }, [filters, page]);

  const set = (patch: Partial<ProspectFilters>) => setFilters(f => ({ ...f, ...patch }));
  const toggle = (key: 'lists' | 'types' | 'tiers' | 'countries' | 'tags' | 'status', v: string) =>
    setFilters(f => { const cur = f[key] ?? []; return { ...f, [key]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }; });
  const listName = useMemo(() => new Map((facets?.lists ?? []).map(l => [l.id, l])), [facets]);
  const weekly = (facets?.lists ?? []).filter(l => l.kind === 'weekly_outreach').sort((a, b) => (b.run_date ?? '').localeCompare(a.run_date ?? '')).slice(0, 2);
  const groups = useMemo(() => LIST_KIND_ORDER.map(k => ({ kind: k, lists: (facets?.lists ?? []).filter(l => l.kind === k) })).filter(g => g.lists.length), [facets]);
  const active = (filters.lists?.length ?? 0) + (filters.types?.length ?? 0) + (filters.tiers?.length ?? 0) + (filters.countries?.length ?? 0) +
    (filters.tags?.length ?? 0) + (filters.status?.length ?? 0) + (filters.inCrm != null ? 1 : 0) + (filters.hasPeople != null ? 1 : 0) + (filters.q ? 1 : 0);

  const patchRow = (id: string, patch: Partial<ProspectRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const move = async (r: ProspectRow, dir: number) => {
    const to = moveTier(r.effective_tier, dir);
    if (to === r.effective_tier) return;
    patchRow(r.id, { effective_tier: to, tier_override: to });
    const { error } = await db.rpc('set_prospect_rank', { p_id: r.id, p_move: dir, p_reason: 'Moved by hand on the Prospects page' });
    if (error) { toast.error(error.message); patchRow(r.id, { effective_tier: r.effective_tier, tier_override: r.tier_override }); }
  };
  const pin = async (r: ProspectRow) => {
    patchRow(r.id, { pinned: !r.pinned });
    const { error } = await db.rpc('set_prospect_rank', { p_id: r.id, p_pinned: !r.pinned, p_reason: r.pinned ? 'Unpinned' : 'Pinned to the top of its tier' });
    if (error) { toast.error(error.message); patchRow(r.id, { pinned: r.pinned }); }
  };

  if (missing) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">The Prospects tables are not in the database yet. They arrive when this release's migration is applied.</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      {/* headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Head label="Companies in Prospects" value={facets ? n(facets.total) : '…'} />
        <Head label="Passed the fit gate" value={facets ? n(listName.get('tam-filtered')?.n ?? 0) : '…'} onClick={() => set({ lists: ['tam-filtered'] })} />
        <Head label="Tier A" value={facets ? n(facets.tiers.find(t => t.v === 'A')?.n ?? 0) : '…'} onClick={() => set({ tiers: ['A'] })} />
        <Head label="Already in the CRM" value={facets ? n(facets.in_crm) : '…'} onClick={() => set({ inCrm: true })} />
        <Card className="flex items-center justify-center"><CardContent className="p-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLoader(true)}><Upload className="h-4 w-4" /> Load file</Button>
        </CardContent></Card>
      </div>

      {weekly.length > 0 && (
        <Card><CardContent className="py-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">This week's outreach</span>
          {weekly.map(l => (
            <Button key={l.id} size="sm" variant={filters.lists?.length === 1 && filters.lists[0] === l.id ? 'default' : 'outline'} className="h-7"
              onClick={() => setFilters({ lists: [l.id], sort: 'rank' })}>{l.name} · {n(l.n)}</Button>
          ))}
          <span className="text-xs text-muted-foreground">The Monday list run picks these. Move anyone up or down and the next run keeps your call.</span>
        </CardContent></Card>
      )}

      {/* filters */}
      <Card><CardContent className="py-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Search name, website, city, products, contact…" className="pl-8 h-9" />
          </div>
          <Multi label="Lists" options={groups.flatMap(g => g.lists.map(l => ({ v: l.id, label: l.name, n: l.n, group: LIST_KIND_LABELS[g.kind] ?? g.kind })))} value={filters.lists} onToggle={v => toggle('lists', v)} />
          <Multi label="Type" options={(facets?.types ?? []).map(t => ({ v: t.v, label: typeLabel(t.v), n: t.n }))} value={filters.types} onToggle={v => toggle('types', v)} />
          <Multi label="Tier" options={PROSPECT_TIERS.map(t => ({ v: t, label: TIER_LABELS[t], n: facets?.tiers.find(x => x.v === t)?.n ?? 0 }))} value={filters.tiers} onToggle={v => toggle('tiers', v)} />
          <Multi label="Country" options={(facets?.countries ?? []).map(t => ({ v: t.v, label: t.v, n: t.n }))} value={filters.countries} onToggle={v => toggle('countries', v)} />
          <Multi label="Tags" options={(facets?.tags ?? []).map(t => ({ v: t.v, label: TAG_LABELS[t.v] ?? t.v, n: t.n }))} value={filters.tags} onToggle={v => toggle('tags', v)} />
          <Multi label="Status" options={(facets?.status ?? []).map(t => ({ v: t.v, label: PROSPECT_STATUS_LABELS[t.v as ProspectStatus] ?? t.v, n: t.n }))} value={filters.status} onToggle={v => toggle('status', v)} />
          <Select value={filters.inCrm == null ? 'any' : String(filters.inCrm)} onValueChange={v => set({ inCrm: v === 'any' ? null : v === 'true' })}>
            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="any">In CRM or not</SelectItem><SelectItem value="true">Already in CRM</SelectItem><SelectItem value="false">Not in CRM yet</SelectItem></SelectContent>
          </Select>
          <Select value={filters.hasPeople == null ? 'any' : String(filters.hasPeople)} onValueChange={v => set({ hasPeople: v === 'any' ? null : v === 'true' })}>
            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="any">People or not</SelectItem><SelectItem value="true">Has a contact</SelectItem><SelectItem value="false">No contact yet</SelectItem></SelectContent>
          </Select>
          <Select value={filters.sort ?? 'rank'} onValueChange={v => set({ sort: v as ProspectFilters['sort'] })}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="rank">Best first</SelectItem><SelectItem value="trade">Biggest India imports</SelectItem><SelectItem value="name">Name A to Z</SelectItem><SelectItem value="recent">Recently changed</SelectItem></SelectContent>
          </Select>
          {active > 0 && <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={() => { setQInput(''); setFilters({ sort: 'rank' }); }}><X className="h-3.5 w-3.5" /> Clear</Button>}
        </div>
        {active > 0 && (
          <div className="flex flex-wrap gap-1">
            {(filters.lists ?? []).map(v => <Chip key={v} label={listName.get(v)?.name ?? v} onX={() => toggle('lists', v)} />)}
            {(filters.types ?? []).map(v => <Chip key={v} label={typeLabel(v)} onX={() => toggle('types', v)} />)}
            {(filters.tiers ?? []).map(v => <Chip key={v} label={`Tier ${v}`} onX={() => toggle('tiers', v)} />)}
            {(filters.countries ?? []).map(v => <Chip key={v} label={v} onX={() => toggle('countries', v)} />)}
            {(filters.tags ?? []).map(v => <Chip key={v} label={TAG_LABELS[v] ?? v} onX={() => toggle('tags', v)} />)}
            {(filters.status ?? []).map(v => <Chip key={v} label={PROSPECT_STATUS_LABELS[v as ProspectStatus] ?? v} onX={() => toggle('status', v)} />)}
          </div>
        )}
        {!filters.status?.length && !(filters.lists ?? []).includes('tam-raw') && (
          <p className="text-[11px] text-muted-foreground">Companies that failed the fit gate are hidden. Pick "Full TAM" in Lists, or Excluded in Status, to see them.</p>
        )}
      </CardContent></Card>

      {/* results */}
      <Card><CardContent className="p-0">
        <div className="flex items-center justify-between px-3 py-2 text-sm border-b">
          <span className="text-muted-foreground">{loading ? 'Searching…' : `${n(total)} ${total === 1 ? 'company' : 'companies'}`}</span>
          <Pager page={page} total={total} onPage={setPage} />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-[118px]">Tier</TableHead><TableHead>Company</TableHead><TableHead>Type</TableHead><TableHead>Where</TableHead>
              <TableHead className="text-right">Score</TableHead><TableHead className="text-right">India imports 2025</TableHead><TableHead>Best contact</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                  {facets?.total === 0 ? 'Nothing loaded yet. Use Load file with the pdhq-prospects file from the list run.' : 'No company matches these filters.'}
                </TableCell></TableRow>
              )}
              {rows.map(r => (
                <TableRow key={r.id} className={cn('cursor-pointer', r.dnc && 'opacity-60')} onClick={() => setOpen(r.id)}>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      <TierBadge r={r} />
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Move up a tier" disabled={r.effective_tier === 'A'} onClick={() => move(r, 1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Move down a tier" disabled={r.effective_tier === 'D'} onClick={() => move(r, -1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className={cn('h-6 w-6', r.pinned ? 'text-primary' : 'text-muted-foreground/50')} title={r.pinned ? 'Unpin' : 'Pin to the top of its tier'} onClick={() => pin(r)}><Pin className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.domain ?? '—'}{(r.tags ?? []).includes('responsive') && <span className="ml-1.5 text-success">· responsive</span>}{(r.tags ?? []).includes('top_priority') && <span className="ml-1.5 text-primary">· buys from Jodhpur</span>}</div>
                  </TableCell>
                  <TableCell className="text-xs">{typeLabel(r.prospect_type)}</TableCell>
                  <TableCell className="text-xs">{[r.state, r.country].filter(Boolean).join(', ') || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.score ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.trade_value_2025)}</TableCell>
                  <TableCell className="text-xs max-w-[200px]">
                    {r.best_contact ? <><div className="truncate">{r.best_contact}</div><div className="text-muted-foreground truncate">{r.best_contact_title}{r.people_count > 1 ? ` · +${r.people_count - 1}` : ''}</div></> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}><StatusCell r={r} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {total > PAGE && <div className="flex justify-end px-3 py-2 border-t"><Pager page={page} total={total} onPage={setPage} /></div>}
      </CardContent></Card>

      <ProspectSheet id={open} onClose={() => setOpen(null)} lists={listName} onChanged={(id, patch) => { patchRow(id, patch); }} />
      <LoadDialog open={loader} onOpenChange={setLoader} onDone={() => { void loadFacets(); void search(); }} />
    </div>
  );
}

function Head({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <Card className={cn(onClick && 'cursor-pointer hover:bg-muted/40')} onClick={onClick}>
      <CardContent className="py-3"><div className="text-lg font-semibold tabular-nums">{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></CardContent>
    </Card>
  );
}

function Chip({ label, onX }: { label: string; onX: () => void }) {
  return <Badge variant="secondary" className="gap-1 pr-1 text-[11px]">{label}<button onClick={onX} aria-label={`Remove ${label}`}><X className="h-3 w-3" /></button></Badge>;
}

type Opt = { v: string; label: string; n?: number; group?: string };
function Multi({ label, options, value, onToggle }: { label: string; options: Opt[]; value?: string[]; onToggle: (v: string) => void }) {
  const [q, setQ] = useState('');
  const sel = value ?? [];
  const shown = options.filter(o => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  let lastGroup: string | undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-9 gap-1', sel.length && 'border-primary text-primary')}>{label}{sel.length ? ` (${sel.length})` : ''}<ChevronDown className="h-3.5 w-3.5" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        {options.length > 8 && <Input value={q} onChange={e => setQ(e.target.value)} placeholder={`Find ${label.toLowerCase()}…`} className="h-8 mb-2" />}
        <div className="max-h-80 overflow-y-auto space-y-0.5">
          {shown.length === 0 && <div className="text-xs text-muted-foreground p-2">Nothing here yet.</div>}
          {shown.map(o => {
            const head = o.group && o.group !== lastGroup ? o.group : null; lastGroup = o.group;
            return (
              <div key={o.v}>
                {head && <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-2 pb-0.5">{head}</div>}
                <label className="flex items-center gap-2 text-sm px-1 py-1 rounded hover:bg-muted cursor-pointer">
                  <Checkbox checked={sel.includes(o.v)} onCheckedChange={() => onToggle(o.v)} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.n != null && <span className="text-xs text-muted-foreground tabular-nums">{n(o.n)}</span>}
                </label>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const last = Math.max(0, Math.ceil(total / PAGE) - 1);
  if (total <= PAGE) return null;
  return (
    <div className="flex items-center gap-1 text-xs">
      <Button variant="ghost" size="sm" className="h-7" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="tabular-nums text-muted-foreground">{n(page * PAGE + 1)}–{n(Math.min(total, (page + 1) * PAGE))} of {n(total)}</span>
      <Button variant="ghost" size="sm" className="h-7" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

function TierBadge({ r }: { r: Pick<ProspectRow, 'effective_tier' | 'tier' | 'tier_override'> }) {
  const manual = r.tier_override && r.tier_override !== r.tier;
  return (
    <Badge variant="secondary" className={cn('text-[11px] w-7 justify-center', TIER_COLOR[r.effective_tier])}
      title={manual ? `Set by hand to ${r.effective_tier} (the score says ${r.tier ?? 'D'})` : TIER_LABELS[r.effective_tier]}>
      {r.effective_tier}{manual ? '•' : ''}
    </Badge>
  );
}

function StatusCell({ r }: { r: ProspectRow }) {
  if (r.dnc) return <span className="text-xs text-destructive inline-flex items-center gap-1"><Ban className="h-3 w-3" /> Do not contact</span>;
  if (r.customer_id) return <Link to={`/customers/${r.customer_id}?tab=sales`} className="text-xs text-primary hover:underline">In CRM</Link>;
  return <span className={cn('text-xs', r.status === 'excluded' && 'text-muted-foreground')} title={r.excluded_reason ?? undefined}>{PROSPECT_STATUS_LABELS[r.status]}{r.status === 'excluded' && r.excluded_reason ? `: ${r.excluded_reason}` : ''}</span>;
}

// ---------- one company ----------
type Person = { id: string; full_name: string; title: string | null; linkedin_url: string | null; email: string | null; location: string | null; source: string | null; outreach_state: string | null; decision_maker: boolean | null; contact_id: string | null; dnc: boolean };
type Event = { id: string; kind: string; from_value: string | null; to_value: string | null; reason: string | null; actor: string | null; occurred_at: string };

function ProspectSheet({ id, onClose, lists, onChanged }: { id: string | null; onClose: () => void; lists: Map<string, ListFacet>; onChanged: (id: string, patch: Partial<ProspectRow>) => void }) {
  const [p, setP] = useState<(ProspectRow & { data: Record<string, unknown>; industry: string | null; revenue: string | null; phone: string | null; trade_last_shipment: string | null; created_at: string }) | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [memberOf, setMemberOf] = useState<{ list_id: string; list_rank: number | null }[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (pid: string) => {
    const [a, b, c, d] = await Promise.all([
      db.from('prospects').select('*').eq('id', pid).maybeSingle(),
      db.from('prospect_people').select('id, full_name, title, linkedin_url, email, location, source, outreach_state, decision_maker, contact_id, dnc').eq('prospect_id', pid).order('decision_maker', { ascending: false }).limit(100),
      db.from('prospect_events').select('id, kind, from_value, to_value, reason, actor, occurred_at').eq('prospect_id', pid).order('occurred_at', { ascending: false }).limit(50),
      db.from('prospect_list_members').select('list_id, list_rank').eq('prospect_id', pid),
    ]);
    setP(a.data); setPeople(b.data ?? []); setEvents(c.data ?? []); setMemberOf(d.data ?? []);
  };
  useEffect(() => { setP(null); setReason(''); if (id) void load(id); }, [id]);

  const rank = async (args: Record<string, unknown>, patch: Partial<ProspectRow>) => {
    if (!p) return;
    setBusy(true);
    const { data, error } = await db.rpc('set_prospect_rank', { p_id: p.id, p_reason: reason.trim() || 'Changed by hand on the Prospects page', ...args });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const next = { ...patch, effective_tier: data?.effective_tier ?? p.effective_tier, tier_override: data?.tier_override ?? null, pinned: data?.pinned ?? p.pinned };
    setP({ ...p, ...next }); onChanged(p.id, next); setReason(''); void load(p.id);
  };
  const setStatus = async (status: ProspectStatus) => {
    if (!p) return;
    setBusy(true);
    const patch = { status, excluded_reason: status === 'excluded' ? (reason.trim() || 'Excluded by hand') : null };
    const { error } = await db.from('prospects').update(patch).eq('id', p.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setP({ ...p, ...patch }); onChanged(p.id, patch); setReason(''); void load(p.id);
  };
  const promote = async () => {
    if (!p) return;
    setBusy(true);
    const { data, error } = await db.rpc('promote_prospect', { p_id: p.id, p_reason: reason.trim() || null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data?.created_account ? `Added to the pipeline as Queued, with ${data.contacts_added} contacts` : 'Linked to the account already in the CRM');
    const patch = { customer_id: data?.customer_id ?? null, status: 'promoted' as ProspectStatus };
    setP({ ...p, ...patch }); onChanged(p.id, patch); void load(p.id);
  };
  const note = async () => {
    if (!p || !reason.trim()) return;
    const { error } = await db.from('prospect_events').insert({ prospect_id: p.id, kind: 'note', reason: reason.trim() });
    if (error) { toast.error(error.message); return; }
    setReason(''); void load(p.id);
  };

  const facts = p ? Object.entries(p.data ?? {}).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) : [];
  return (
    <Sheet open={!!id} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {!p ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div> : (
          <div className="space-y-4">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2"><TierBadge r={p} />{p.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap gap-x-3 gap-y-1">
                {p.domain && <a className="text-primary inline-flex items-center gap-1" href={p.website || `https://${p.domain}`} target="_blank" rel="noreferrer">{p.domain}<ExternalLink className="h-3 w-3" /></a>}
                {p.linkedin_url && <a className="text-primary" href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
                <span>{[p.city, p.state, p.country].filter(Boolean).join(', ')}</span>
                <span>{typeLabel(p.prospect_type)}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-3 gap-2 text-sm">
              <Fact k="Score" v={p.score ?? '—'} /><Fact k="Rank in run" v={p.rank ?? '—'} /><Fact k="Employees" v={p.employees ?? '—'} />
              <Fact k="India imports 2025" v={money(p.trade_value_2025)} /><Fact k="Shipments" v={p.trade_shipments ?? '—'} /><Fact k="Last shipment" v={p.trade_last_shipment ?? '—'} />
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your call</div>
              {p.dnc && <p className="text-sm text-destructive flex items-center gap-1"><Ban className="h-4 w-4" /> Do not contact. Nobody sends to this company.</p>}
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why (optional, saved with the change)" className="h-8" />
              <div className="flex flex-wrap gap-1.5">
                {(['A', 'B', 'C', 'D'] as const).map(t => (
                  <Button key={t} size="sm" variant={p.effective_tier === t ? 'default' : 'outline'} className="h-7 w-9" disabled={busy} onClick={() => rank({ p_tier: t }, {})}>{t}</Button>
                ))}
                {p.tier_override && <Button size="sm" variant="ghost" className="h-7 gap-1" disabled={busy} onClick={() => rank({ p_tier: 'auto' }, {})}><RotateCcw className="h-3.5 w-3.5" /> Back to score ({p.tier ?? 'D'})</Button>}
                <Button size="sm" variant="outline" className="h-7 gap-1" disabled={busy} onClick={() => rank({ p_pinned: !p.pinned }, {})}>{p.pinned ? <><PinOff className="h-3.5 w-3.5" /> Unpin</> : <><Pin className="h-3.5 w-3.5" /> Pin</>}</Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.customer_id
                  ? <Button size="sm" asChild className="h-7"><Link to={`/customers/${p.customer_id}?tab=sales`}>Open in CRM</Link></Button>
                  : <Button size="sm" className="h-7 gap-1" disabled={busy || p.dnc} onClick={promote}><Send className="h-3.5 w-3.5" /> Put in pipeline</Button>}
                {p.status === 'excluded'
                  ? <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setStatus('new')}>Restore</Button>
                  : <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setStatus('excluded')}>Exclude</Button>}
                {p.status !== 'excluded' && !p.customer_id && (['researching', 'ready'] as const).filter(s => s !== p.status).map(s => (
                  <Button key={s} size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setStatus(s)}>Mark {PROSPECT_STATUS_LABELS[s].toLowerCase()}</Button>
                ))}
                <Button size="sm" variant="ghost" className="h-7" disabled={!reason.trim()} onClick={note}>Save as note</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Status: {PROSPECT_STATUS_LABELS[p.status]}{p.excluded_reason ? ` (${p.excluded_reason})` : ''}. A tier you set stays when the list run re-scores.</p>
            </div>

            <Section title={`People (${people.length})`}>
              {people.length === 0 && <p className="text-sm text-muted-foreground">No contact found yet.</p>}
              {people.map(x => (
                <div key={x.id} className={cn('text-sm border-t first:border-t-0 py-1.5', x.dnc && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{x.full_name}</span>
                    {x.decision_maker && <Badge variant="secondary" className="text-[10px]">decision maker</Badge>}
                    {x.outreach_state && <Badge variant="outline" className="text-[10px]">{x.outreach_state}</Badge>}
                    {x.dnc && <Badge variant="secondary" className="text-[10px] bg-destructive/15 text-destructive">do not contact</Badge>}
                    <span className="text-[11px] text-muted-foreground ml-auto">{x.source}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{x.title}{x.location ? ` · ${x.location}` : ''}</div>
                  <div className="text-xs flex gap-3">
                    {x.email && <span>{x.email}</span>}
                    {x.linkedin_url && <a className="text-primary" href={x.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
                  </div>
                </div>
              ))}
            </Section>

            <Section title="On these lists">
              <div className="flex flex-wrap gap-1">
                {memberOf.map(m => <Badge key={m.list_id} variant="outline" className="text-[11px]">{lists.get(m.list_id)?.name ?? m.list_id}{m.list_rank ? ` · #${m.list_rank}` : ''}</Badge>)}
                {memberOf.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
              </div>
            </Section>

            {p.products && <Section title="What they import"><p className="text-xs text-muted-foreground whitespace-pre-line">{p.products.split(' | ').join('\n')}</p></Section>}

            {facts.length > 0 && (
              <Section title="Everything else we know">
                <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
                  {facts.flatMap(([k, v]) => [<span key={`k${k}`} className="text-muted-foreground">{k.replace(/_/g, ' ')}</span>, <span key={`v${k}`} className="break-words">{Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>])}
                </div>
              </Section>
            )}

            <Section title="History">
              {events.length === 0 && <p className="text-sm text-muted-foreground">No changes by hand yet.</p>}
              {events.map(e => (
                <div key={e.id} className="text-xs border-t first:border-t-0 py-1 flex flex-wrap gap-x-2">
                  <span className="text-muted-foreground w-24 shrink-0" title={format(new Date(e.occurred_at), 'd MMM yyyy, HH:mm')}>{formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true })}</span>
                  <span className="font-medium">{e.kind === 'note' ? 'Note' : e.kind === 'tier' ? `Tier ${e.from_value ?? '—'} → ${e.to_value ?? 'score'}` : `${e.kind}: ${e.from_value ?? '—'} → ${e.to_value ?? '—'}`}</span>
                  {e.reason && <span className="text-muted-foreground">{e.reason}</span>}
                  {e.actor && <span className="text-muted-foreground ml-auto">{e.actor}</span>}
                </div>
              ))}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Fact({ k, v }: { k: string; v: string | number }) {
  return <div className="rounded-md bg-muted/40 px-2 py-1.5"><div className="text-[11px] text-muted-foreground">{k}</div><div className="font-medium tabular-nums">{v}</div></div>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-1"><div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>{children}</div>;
}

// ---------- load file ----------
const CHECKPOINT = 'pdhq.prospects.load';
type Checkpoint = { file: string; size: number; done: number };
const readCheckpoint = (): Checkpoint | null => { try { return JSON.parse(localStorage.getItem(CHECKPOINT) ?? 'null'); } catch { return null; } };
const writeCheckpoint = (c: Checkpoint | null) => { try { if (c) localStorage.setItem(CHECKPOINT, JSON.stringify(c)); else localStorage.removeItem(CHECKPOINT); } catch { /* private window */ } };

async function* readRecords(file: File) {
  let stream: ReadableStream<Uint8Array> = file.stream();
  if (file.name.endsWith('.gz')) stream = stream.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const out = splitLines(rest + value);
    rest = out.rest;
    yield* out.lines;
  }
  if (rest.trim()) yield* splitLines(rest + '\n').lines;
}

function LoadDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, lists: 0, created: 0, updated: 0, linked: 0, people: 0, phase: '' });
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const stop = useRef(false);
  const cp = readCheckpoint();
  const resumeFrom = file && cp && cp.file === file.name && cp.size === file.size ? cp.done : 0;

  const run = async () => {
    if (!file) return;
    setRunning(true); setError(null); setFinished(false); stop.current = false;
    const from = resumeFrom;
    const st = { done: from, total: 0, lists: 0, created: 0, updated: 0, linked: 0, people: 0, phase: 'Counting…' };
    setProgress({ ...st });
    try {
      // first pass: count records so the bar means something (fast, no network)
      let total = 0; for await (const _ of readRecords(file)) total++;
      st.total = total; st.phase = from ? 'Picking up where it stopped…' : 'Loading…'; setProgress({ ...st });
      const source = file.name.replace(/\.jsonl(\.gz)?$/, '');
      const send = async (b: LoadBatch) => {
        if (b.start + b.rows.length <= from) return;   // already loaded before a stop
        const rows = b.start < from ? b.rows.slice(from - b.start) : b.rows;
        let res;
        if (b.kind === 'lists') {
          res = await db.rpc('upsert_prospect_lists', { p_lists: rows });
          if (!res.error && from === 0) {
            // a fresh load replaces each list's members, so a re-run does not leave old picks behind
            for (const l of rows) { const r = await db.rpc('import_prospects', { p_list_id: l.id, p_rows: [], p_source: source, p_replace_list: true }); if (r.error) throw new Error(r.error.message); }
          }
          if (!res.error) st.lists += rows.length;
        } else if (b.kind === 'prospects') {
          res = await db.rpc('import_prospects', { p_list_id: null, p_rows: rows, p_source: source, p_replace_list: false });
          if (!res.error) { st.created += res.data?.created ?? 0; st.updated += res.data?.updated ?? 0; st.linked += res.data?.linked_to_accounts ?? 0; }
        } else {
          res = await db.rpc('import_prospect_people', { p_rows: rows, p_source: source });
          if (!res.error) st.people += (res.data?.created ?? 0) + (res.data?.updated ?? 0);
        }
        if (res.error) throw new Error(res.error.message);
        st.done = b.start + b.rows.length;
        st.phase = b.kind === 'people' ? 'Loading people…' : b.kind === 'prospects' ? 'Loading companies…' : 'Loading lists…';
        writeCheckpoint({ file: file.name, size: file.size, done: st.done });
        setProgress({ ...st });
      };
      const batcher = new Batcher(500);
      for await (const rec of readRecords(file)) {
        if (stop.current) throw new Error('Stopped. Choose the same file again to pick up where it stopped.');
        const b = batcher.push(rec);
        if (b) await send(b);
      }
      const last = batcher.flush(); if (last) await send(last);
      st.phase = 'Counting list members…'; setProgress({ ...st });
      await db.rpc('refresh_prospect_counts');
      writeCheckpoint(null);
      st.phase = 'Done'; st.done = st.total; setProgress({ ...st });
      setFinished(true); onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <Dialog open={open} onOpenChange={o => { if (!running) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Load a list run</DialogTitle>
          <DialogDescription>
            Pick the pdhq-prospects file the list run writes (DKT GTM › playbooks › prospect-list-building › runs › date › pdhq). Companies already here are updated, not doubled. Accounts already in the CRM are linked, and do not contact carries over. Tiers you set by hand are kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input type="file" accept=".gz,.jsonl,application/gzip" disabled={running} onChange={e => { setFile(e.target.files?.[0] ?? null); setFinished(false); setError(null); }} />
          {file && !running && !finished && <p className="text-xs text-muted-foreground">{file.name} · {(file.size / 1e6).toFixed(1)} MB{resumeFrom ? ` · the last load stopped at record ${n(resumeFrom)}; this picks up from there` : ''}. It takes a few minutes. Keep this tab open.</p>}
          {(running || finished || progress.done > 0) && (
            <div className="space-y-1.5">
              <Progress value={pct} />
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                <span>{progress.phase}</span><span className="tabular-nums">{n(progress.done)} of {n(progress.total)} records</span>
              </div>
              <div className="text-xs flex flex-wrap gap-x-3">
                <span>{n(progress.lists)} lists</span><span>{n(progress.created)} new companies</span><span>{n(progress.updated)} updated</span><span>{n(progress.linked)} linked to CRM accounts</span><span>{n(progress.people)} people</span>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {finished && <p className="text-sm text-success">Loaded. The lists and filters now show the new run.</p>}
        </div>
        <DialogFooter>
          {running
            ? <Button variant="outline" onClick={() => { stop.current = true; }}>Stop</Button>
            : <>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>{finished ? 'Close' : 'Cancel'}</Button>
                {!finished && <Button disabled={!file} onClick={run} className="gap-1.5"><Upload className="h-4 w-4" />{resumeFrom ? 'Resume load' : 'Load'}</Button>}
              </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
