// Traction page: the 19 channels on a bullseye Caleb can switch, the top 5 ideas per channel,
// communities worth joining, and real inquiries per channel (the inner ring's pass mark).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, ChevronRight, ExternalLink, ListPlus, Plus, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  COMMUNITY_STATUSES, IDEA_STATUSES, IDEA_STATUS_LABELS, INNER_RING_DEADLINE, INNER_RING_MAX, RING_LABELS, RINGS,
  canMoveRing, inquiriesPerChannel, orderIdeas, type Ring,
} from '@/lib/sales/traction';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

type Channel = { id: number; name: string; ring: Ring; sort_order: number; fit: number | null; cost: string | null; test_ends: string | null; map_note: string | null; ring_changed_at: string | null; ring_changed_by: string | null };
type Idea = { id: string; channel_id: number; rank: number; title: string; pitch: string | null; free_or_paid: string; hours_per_week: number | null; status: string; decision_note: string | null; task_id: string | null; soonest_inquiry: string | null };
type Community = { id: string; name: string; grp: string | null; audience: string | null; cost: string | null; promotion_allowed: string | null; link: string | null; status: string; priority: string | null; high_value: boolean; interaction_plan: string | null; who_acts: string | null; next_touch: string | null; notes: string | null };
type RingEvent = { id: string; channel_id: number; from_ring: string | null; to_ring: string; reason: string | null; actor: string | null; occurred_at: string };

const RING_STYLE: Record<Ring, string> = {
  inner: 'bg-primary text-primary-foreground', engine: 'bg-success/20 text-success', promising: 'bg-primary/15 text-primary', long_shot: 'bg-muted text-muted-foreground', off: 'bg-muted text-muted-foreground line-through',
};
const STATUS_STYLE: Record<string, string> = { approved: 'bg-success/15 text-success', running: 'bg-primary/15 text-primary', proposed: 'bg-warning/15 text-warning', done: 'bg-muted', dropped: 'bg-muted line-through', not_for_now: 'bg-muted text-muted-foreground' };
const short = (name: string) => name.replace(/\s*\(.*\)$/, '');

export function TractionTab() {
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [events, setEvents] = useState<RingEvent[]>([]);
  const [inquiries, setInquiries] = useState<{ source_channel: string | null; status: string }[]>([]);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [move, setMove] = useState<{ channel: Channel; to: Ring } | null>(null);
  const [comFilter, setComFilter] = useState<string>('open');
  const [editCom, setEditCom] = useState<Community | null>(null);
  const [newIdea, setNewIdea] = useState<number | null>(null);

  const load = async () => {
    const [c, i, m, e, q] = await Promise.all([
      db.from('traction_channels').select('*').order('sort_order'),
      db.from('traction_ideas').select('id, channel_id, rank, title, pitch, free_or_paid, hours_per_week, status, decision_note, task_id, soonest_inquiry').order('rank'),
      db.from('communities').select('*').order('priority', { nullsFirst: false }).order('name'),
      db.from('traction_ring_events').select('*').order('occurred_at', { ascending: false }).limit(30),
      db.from('customer_rfqs').select('source_channel, status'),
    ]);
    if (c.error) { setMissing(true); return; }
    setChannels(c.data ?? []); setIdeas(i.data ?? []); setCommunities(m.data ?? []); setEvents(e.data ?? []); setInquiries(q.data ?? []);
  };
  useEffect(() => { void load(); }, []);

  const perChannel = useMemo(() => inquiriesPerChannel(channels, inquiries), [channels, inquiries]);
  const ideasBy = useMemo(() => {
    const m = new Map<number, Idea[]>();
    for (const i of orderIdeas(ideas)) (m.get(i.channel_id) ?? m.set(i.channel_id, []).get(i.channel_id)!).push(i);
    return m;
  }, [ideas]);
  const byRing = (r: Ring) => channels.filter(c => c.ring === r);
  const inner = byRing('inner');

  if (missing) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">The Traction tables are not in the database yet. They arrive when this release's migration is applied.</CardContent></Card>;

  const requestMove = (c: Channel, to: string) => {
    const ok = canMoveRing(channels, c.id, to);
    if (!ok.ok) { toast.error(ok.reason); return; }
    setMove({ channel: c, to: to as Ring });
  };
  const doMove = async (reason: string) => {
    if (!move) return;
    const { error } = await db.from('traction_channels').update({ ring: move.to, ring_reason: reason || null, ring_changed_by: user?.email ?? 'pd-hq', test_ends: move.to === 'inner' ? (move.channel.test_ends ?? INNER_RING_DEADLINE) : move.channel.test_ends }).eq('id', move.channel.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${short(move.channel.name)} moved to ${RING_LABELS[move.to]}`);
    setMove(null); void load();
  };
  const patchIdea = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from('traction_ideas').update(patch).eq('id', id);
    if (error) toast.error(error.message); else void load();
  };
  const ideaToTask = async (idea: Idea) => {
    const ch = channels.find(c => c.id === idea.channel_id);
    const proj = await db.from('projects').select('id, name').eq('name', 'Sales Office').maybeSingle();
    const row: Record<string, unknown> = {
      title: `Sales · Channels: ${idea.title}`.slice(0, 500), description: `${idea.pitch ?? ''}\n\nTraction channel: ${ch?.name ?? idea.channel_id}`.trim(),
      status: 'open', priority: 'normal', assignee: 'CQ', due_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), source_event: 'traction_idea',
      ...(proj.data ? { association_type: 'project', association_id: proj.data.id, association_label: proj.data.name } : {}),
    };
    const t = await db.from('tasks').insert(row).select('id').single();
    if (t.error) { toast.error(t.error.message); return; }
    await patchIdea(idea.id, { task_id: t.data.id, status: idea.status === 'idea' || idea.status === 'proposed' ? 'approved' : idea.status });
    toast.success('Task created on Sales Office and the idea marked approved');
  };
  const patchCommunity = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from('communities').update(patch).eq('id', id);
    if (error) toast.error(error.message); else void load();
  };

  const shownCommunities = communities.filter(c => comFilter === 'all' ? true : comFilter === 'open' ? c.status !== 'dropped' && c.priority !== 'X' : comFilter === 'high' ? c.high_value : c.status === comFilter);
  const innerInquiries = inner.reduce((n, c) => n + (perChannel.counts.get(c.id) ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-4">
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-auto">Bullseye</h3>
              <span className="text-xs text-muted-foreground">Inner ring {inner.length} of {INNER_RING_MAX} · judged {format(new Date(INNER_RING_DEADLINE), 'd MMM yyyy')}</span>
            </div>
            <Bullseye channels={channels} counts={perChannel.counts} onPick={id => setOpen(id)} />
            <p className="text-[11px] text-muted-foreground">Click a channel to see its ideas. Switch rings from the list. The channel job proposes moves; only you make them.</p>
          </CardContent>
        </Card>
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Mini label="Inner-ring inquiries" value={innerInquiries} hint={`target: real buyer inquiries by ${format(new Date(INNER_RING_DEADLINE), 'd MMM')}`} />
            <Mini label="All tagged inquiries" value={[...perChannel.counts.values()].reduce((a, b) => a + b, 0)} />
            <Mini label="Inquiries with no channel" value={perChannel.untagged} hint="tag them on the inquiry" />
            <Mini label="Ideas approved or running" value={ideas.filter(i => i.status === 'approved' || i.status === 'running').length} />
          </div>
          <Card>
            <CardContent className="p-0 divide-y">
              {(['inner', 'engine', 'promising', 'long_shot', 'off'] as Ring[]).flatMap(r => byRing(r)).map(c => {
                const list = ideasBy.get(c.id) ?? [];
                const top = list.filter(i => !['done', 'dropped'].includes(i.status)).slice(0, 5);
                const isOpen = open === c.id;
                return (
                  <div key={c.id} className={cn(isOpen && 'bg-muted/30')}>
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <button className="flex items-center gap-1.5 text-left font-medium text-sm mr-auto min-w-0" onClick={() => setOpen(isOpen ? null : c.id)}>
                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                        <span className="truncate">{c.name}</span>
                      </button>
                      <span className="text-xs text-muted-foreground">{top.length} ideas · {perChannel.counts.get(c.id) ?? 0} inquiries{c.fit != null ? ` · fit ${c.fit}/5` : ''}{c.cost ? ` · ${c.cost}` : ''}</span>
                      <Select value={c.ring} onValueChange={v => requestMove(c, v)}>
                        <SelectTrigger className={cn('h-7 w-40 text-xs', RING_STYLE[c.ring])}><SelectValue /></SelectTrigger>
                        <SelectContent>{RINGS.map(r => <SelectItem key={r} value={r}>{RING_LABELS[r]}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2">
                        {c.map_note && <p className="text-xs text-muted-foreground">Map: {c.map_note}{c.test_ends ? ` · test ends ${format(new Date(c.test_ends), 'd MMM yyyy')}` : ''}</p>}
                        {list.map((i, n) => (
                          <div key={i.id} className={cn('rounded-md border bg-card p-2 space-y-1', n >= 5 && 'opacity-70')}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs tabular-nums text-muted-foreground w-5">#{i.rank}</span>
                              <span className="text-sm font-medium flex-1 min-w-0">{i.title}</span>
                              {i.free_or_paid === 'paid' && <Badge variant="outline" className="text-[10px]">Paid</Badge>}
                              {i.hours_per_week != null && <span className="text-[11px] text-muted-foreground">{i.hours_per_week} h/wk</span>}
                              <Select value={i.status} onValueChange={v => patchIdea(i.id, { status: v })}>
                                <SelectTrigger className={cn('h-7 w-36 text-xs', STATUS_STYLE[i.status])}><SelectValue /></SelectTrigger>
                                <SelectContent>{IDEA_STATUSES.map(s => <SelectItem key={s} value={s}>{IDEA_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                              </Select>
                              <Input type="number" min={1} max={99} className="h-7 w-14 text-xs" defaultValue={i.rank} title="Rank" onBlur={e => { const r = Number(e.target.value); if (r && r !== i.rank) void patchIdea(i.id, { rank: r }); }} />
                              {i.task_id
                                ? <Badge variant="secondary" className="text-[10px] bg-success/15 text-success">Task made</Badge>
                                : <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => ideaToTask(i)}><ListPlus className="h-3.5 w-3.5" /> Task</Button>}
                            </div>
                            {i.pitch && i.pitch !== i.title && <p className="text-xs text-muted-foreground pl-7">{i.pitch}</p>}
                            {i.decision_note && <p className="text-[11px] text-muted-foreground pl-7 italic">{i.decision_note}</p>}
                          </div>
                        ))}
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setNewIdea(c.id)}><Plus className="h-3.5 w-3.5" /> Add idea</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-auto">Communities worth joining ({shownCommunities.length})</h3>
            <Select value={comFilter} onValueChange={setComFilter}>
              <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Not dropped or skipped</SelectItem><SelectItem value="high">High value</SelectItem>
                {COMMUNITY_STATUSES.map(s => <SelectItem key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</SelectItem>)}
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Community</th><th className="py-1 pr-2 font-medium">Group</th><th className="py-1 pr-2 font-medium">Priority</th><th className="py-1 pr-2 font-medium">Status</th><th className="py-1 pr-2 font-medium">How we show up</th><th className="py-1 pr-2 font-medium">Next touch</th>
              </tr></thead>
              <tbody>
                {shownCommunities.map(c => (
                  <tr key={c.id} className="border-t align-top">
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1">
                        <button title="High value" onClick={() => patchCommunity(c.id, { high_value: !c.high_value })}><Star className={cn('h-3.5 w-3.5', c.high_value ? 'fill-warning text-warning' : 'text-muted-foreground')} /></button>
                        <span className="font-medium">{c.name}</span>
                        {c.link && /^https?:/.test(c.link) && <a href={c.link} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 text-muted-foreground" /></a>}
                      </div>
                      {c.audience && <div className="text-[11px] text-muted-foreground line-clamp-2">{c.audience}</div>}
                    </td>
                    <td className="py-1.5 pr-2 text-xs">{c.grp}</td>
                    <td className="py-1.5 pr-2 text-xs">{c.priority ?? '—'}</td>
                    <td className="py-1.5 pr-2">
                      <Select value={c.status} onValueChange={v => patchCommunity(c.id, { status: v })}>
                        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{COMMUNITY_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 pr-2 text-xs max-w-xs">
                      <button className="text-left hover:underline" onClick={() => setEditCom(c)}>{c.interaction_plan || <span className="text-muted-foreground">Add a plan</span>}</button>
                    </td>
                    <td className="py-1.5 pr-2 text-xs">{c.next_touch ? format(new Date(c.next_touch), 'd MMM') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {events.length > 0 && (
        <Card><CardContent className="pt-4 space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ring moves</h3>
          {events.map(e => (
            <div key={e.id} className="text-xs text-muted-foreground">
              {format(new Date(e.occurred_at), 'd MMM yyyy')}: <span className="text-foreground font-medium">{short(channels.find(c => c.id === e.channel_id)?.name ?? String(e.channel_id))}</span> {e.from_ring ? `${RING_LABELS[e.from_ring as Ring] ?? e.from_ring} → ` : ''}{RING_LABELS[e.to_ring as Ring] ?? e.to_ring}{e.reason ? ` · ${e.reason}` : ''}{e.actor ? ` · ${e.actor}` : ''}
            </div>
          ))}
        </CardContent></Card>
      )}

      {move && <ReasonDialog title={`Move ${short(move.channel.name)} to ${RING_LABELS[move.to]}`} onCancel={() => setMove(null)} onSave={doMove} />}
      {editCom && <CommunityDialog community={editCom} onClose={() => setEditCom(null)} onSave={async p => { await patchCommunity(editCom.id, p); setEditCom(null); }} />}
      {newIdea != null && <NewIdeaDialog channelId={newIdea} nextRank={(ideasBy.get(newIdea)?.length ?? 0) + 1} onClose={() => setNewIdea(null)} onSaved={() => { setNewIdea(null); void load(); }} />}
    </div>
  );
}

/** Three rings and a centre: inner (testing now), promising, long shot; the always-on engine sits in the middle. */
function Bullseye({ channels, counts, onPick }: { channels: Channel[]; counts: Map<number, number>; onPick: (id: number) => void }) {
  const size = 440, c = size / 2;
  const radii = { engine: 46, inner: 100, promising: 150, long_shot: 196 } as const;
  const place = (list: Channel[], r0: number, r1: number, offset = 0) => list.map((ch, i) => {
    const a = offset + (i / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = (r0 + r1) / 2;
    return { ch, x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  });
  const dots = [
    ...place(channels.filter(x => x.ring === 'engine'), 0, 0),
    ...place(channels.filter(x => x.ring === 'inner'), radii.engine, radii.inner, 0.3),
    ...place(channels.filter(x => x.ring === 'promising'), radii.inner, radii.promising, 0.55),
    ...place(channels.filter(x => x.ring === 'long_shot'), radii.promising, radii.long_shot, 0.2),
  ];
  return (
    <svg viewBox={`-60 0 ${size + 120} ${size}`} className="w-full h-auto" role="img" aria-label="Traction bullseye">
      <circle cx={c} cy={c} r={radii.long_shot} className="fill-muted/40 stroke-border" />
      <circle cx={c} cy={c} r={radii.promising} className="fill-primary/5 stroke-border" />
      <circle cx={c} cy={c} r={radii.inner} className="fill-primary/15 stroke-primary/40" />
      <circle cx={c} cy={c} r={radii.engine} className="fill-success/15 stroke-success/40" />
      <text x={c} y={c - radii.long_shot + 14} textAnchor="middle" className="fill-muted-foreground text-[10px] uppercase tracking-wider">Long shot</text>
      <text x={c} y={c - radii.promising + 14} textAnchor="middle" className="fill-muted-foreground text-[10px] uppercase tracking-wider">Promising</text>
      <text x={c} y={c - radii.inner + 14} textAnchor="middle" className="fill-primary text-[10px] uppercase tracking-wider font-semibold">Inner ring</text>
      {dots.map(({ ch, x, y }) => {
        const n = counts.get(ch.id) ?? 0;
        const label = short(ch.name).replace(' (direct outreach)', '');
        const isInner = ch.ring === 'inner' || ch.ring === 'engine';
        // Labels point away from the centre so neighbouring rings don't print over each other.
        const dx = (x - c) / Math.max(1, Math.hypot(x - c, y - c));
        const side = isInner ? 0 : dx > 0.35 ? 1 : dx < -0.35 ? -1 : 0;
        return (
          <g key={ch.id} className="cursor-pointer" onClick={() => onPick(ch.id)}>
            <circle cx={x} cy={y} r={isInner ? 6 : 4} className={isInner ? 'fill-primary' : 'fill-muted-foreground'} />
            {n > 0 && <text x={x + 8} y={y - 6} className="fill-success text-[10px] font-semibold">{n}</text>}
            <text x={x + side * (isInner ? 9 : 7)} y={side ? y + 3.5 : y + (isInner ? 17 : 14)} textAnchor={side > 0 ? 'start' : side < 0 ? 'end' : 'middle'} className={cn('text-[10px]', isInner ? 'fill-foreground font-semibold' : 'fill-muted-foreground')}>
              {label.length > 20 ? label.slice(0, 19) + '…' : label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Mini({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return <Card><CardContent className="py-3"><div className="text-lg font-semibold tabular-nums">{value}</div><div className="text-[11px] text-muted-foreground">{label}</div>{hint && <div className="text-[10px] text-muted-foreground/80">{hint}</div>}</CardContent></Card>;
}

function ReasonDialog({ title, onCancel, onSave }: { title: string; onCancel: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={v => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Why? (logged with the move)" value={reason} onChange={e => setReason(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSave(reason.trim())} />
        <DialogFooter><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button onClick={() => onSave(reason.trim())}>Move it</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommunityDialog({ community, onClose, onSave }: { community: Community; onClose: () => void; onSave: (p: Record<string, unknown>) => void }) {
  const [plan, setPlan] = useState(community.interaction_plan ?? '');
  const [who, setWho] = useState(community.who_acts ?? '');
  const [next, setNext] = useState(community.next_touch ?? '');
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{community.name}</DialogTitle></DialogHeader>
        {community.notes && <p className="text-xs text-muted-foreground">{community.notes}{community.promotion_allowed ? ` · Promotion: ${community.promotion_allowed}` : ''}</p>}
        <Textarea rows={5} placeholder="How we show up, how often, who posts. Never posting as Caleb without his yes." value={plan} onChange={e => setPlan(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Who acts (e.g. Claude drafts, Caleb posts)" value={who} onChange={e => setWho(e.target.value)} />
          <Input type="date" value={next} onChange={e => setNext(e.target.value)} />
        </div>
        <DialogFooter><Button onClick={() => onSave({ interaction_plan: plan.trim() || null, who_acts: who.trim() || null, next_touch: next || null })}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewIdeaDialog({ channelId, nextRank, onClose, onSaved }: { channelId: number; nextRank: number; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [pitch, setPitch] = useState('');
  const [paid, setPaid] = useState(false);
  const save = async () => {
    const { error } = await db.from('traction_ideas').insert({ channel_id: channelId, rank: nextRank, title: title.trim(), pitch: pitch.trim() || null, free_or_paid: paid ? 'paid' : 'free', status: paid ? 'not_for_now' : 'idea', proposed_at: new Date().toISOString().slice(0, 10) });
    if (error) { toast.error(error.message); return; }
    onSaved();
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New idea</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="The idea in one line" value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea rows={4} placeholder="Pitch and pass mark" value={pitch} onChange={e => setPitch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> Costs money (logged as not for now)</label>
        <DialogFooter><Button disabled={!title.trim()} onClick={save}>Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
