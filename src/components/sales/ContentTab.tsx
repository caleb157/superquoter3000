// Content: every piece (posts, articles, case studies, charts, drip notes), the posting calendar with
// A/B tags and scores, and which post variant is winning on qualified comments.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { format, startOfWeek } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONTENT_KINDS, CONTENT_STATUSES, MIN_POSTS_PER_VARIANT, SLOT_STATUSES, postExperiments } from '@/lib/sales/traction';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

type Piece = { id: string; slug: string | null; title: string; kind: string; pillar: string | null; status: string; body: string | null; format_note: string | null; proof: string | null; target_search: string | null; parent_id: string | null; notes: string | null; source: string | null; updated_at: string };
type Slot = { id: string; piece_id: string; channel: string; slot_date: string; slot_time_ct: string | null; status: string; variant: string | null; test_id: string | null; post_url: string | null; impressions: number | null; reactions: number | null; comments: number | null; qualified_comments: number | null; profile_views_3d: number | null; accepts_3d: number | null };

const STATUS_STYLE: Record<string, string> = { approved: 'bg-success/15 text-success', scheduled: 'bg-primary/15 text-primary', posted: 'bg-primary text-primary-foreground', review: 'bg-warning/15 text-warning', dropped: 'bg-muted line-through' };
const label = (s: string) => s.replace('_', ' ').replace(/^./, m => m.toUpperCase());

export function ContentTab() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState('open');
  const [edit, setEdit] = useState<Piece | null>(null);
  const [score, setScore] = useState<Slot | null>(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const [p, s] = await Promise.all([
      db.from('content_pieces').select('*').order('created_at'),
      db.from('content_slots').select('*').order('slot_date'),
    ]);
    if (p.error) { setMissing(true); return; }
    setPieces(p.data ?? []); setSlots(s.data ?? []);
  };
  useEffect(() => { void load(); }, []);

  const pieceBy = useMemo(() => new Map(pieces.map(p => [p.id, p])), [pieces]);
  const weeks = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = format(startOfWeek(new Date(s.slot_date + 'T12:00:00'), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    return [...m.entries()];
  }, [slots]);
  const tests = useMemo(() => postExperiments(slots), [slots]);
  const counts = useMemo(() => Object.fromEntries(CONTENT_STATUSES.map(s => [s, pieces.filter(p => p.status === s).length])), [pieces]);
  const shown = pieces.filter(p => filter === 'all' ? true : filter === 'open' ? !['posted', 'dropped'].includes(p.status) : p.status === filter);

  if (missing) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">The Content tables are not in the database yet. They arrive when this release's migration is applied.</CardContent></Card>;

  const patchPiece = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from('content_pieces').update(patch).eq('id', id);
    if (error) toast.error(error.message); else void load();
  };
  const patchSlot = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from('content_slots').update(patch).eq('id', id);
    if (error) toast.error(error.message); else void load();
  };
  const today = new Date().toISOString().slice(0, 10);
  const nextPosts = slots.filter(s => s.slot_date >= today && s.status !== 'skipped').length;
  const unscored = slots.filter(s => s.status === 'posted' && s.qualified_comments == null).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Mini label="Pieces" value={pieces.length} />
        <Mini label="Waiting for your review" value={(counts.draft ?? 0) + (counts.review ?? 0)} />
        <Mini label="Approved, not yet out" value={(counts.approved ?? 0) + (counts.scheduled ?? 0)} />
        <Mini label="Upcoming slots" value={nextPosts} />
        <Mini label="Posted, not scored" value={unscored} warn={unscored > 0} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Posting calendar (LinkedIn, your profile, 8:00 AM Texas)</h3>
            {weeks.length === 0 && <p className="text-sm text-muted-foreground">No slots yet.</p>}
            {weeks.map(([wk, list]) => (
              <div key={wk} className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">Week of {format(new Date(wk + 'T12:00:00'), 'd MMM yyyy')}</div>
                {list.map(s => {
                  const p = pieceBy.get(s.piece_id);
                  return (
                    <div key={s.id} className={cn('flex flex-wrap items-center gap-2 rounded-md border p-1.5 text-sm', s.slot_date < today && s.status === 'planned' && 'border-warning/50')}>
                      <span className="text-xs w-20 shrink-0 text-muted-foreground">{format(new Date(s.slot_date + 'T12:00:00'), 'EEE d MMM')}</span>
                      <button className="flex-1 min-w-0 truncate text-left hover:underline" onClick={() => p && setEdit(p)}>{p?.title ?? 'Missing piece'}</button>
                      {p?.pillar && <span className="text-[10px] text-muted-foreground">{p.pillar}</span>}
                      <Input className="h-6 w-14 text-[11px] px-1" placeholder="Var" defaultValue={s.variant ?? ''} title="Variant" onBlur={e => e.target.value !== (s.variant ?? '') && patchSlot(s.id, { variant: e.target.value.trim() || null })} />
                      <Input className="h-6 w-20 text-[11px] px-1" placeholder="Test" defaultValue={s.test_id ?? ''} title="Test id" onBlur={e => e.target.value !== (s.test_id ?? '') && patchSlot(s.id, { test_id: e.target.value.trim() || null })} />
                      <Select value={s.status} onValueChange={v => patchSlot(s.id, { status: v })}>
                        <SelectTrigger className={cn('h-6 w-24 text-[11px]', s.status === 'posted' && 'bg-primary/10')}><SelectValue /></SelectTrigger>
                        <SelectContent>{SLOT_STATUSES.map(x => <SelectItem key={x} value={x}>{label(x)}</SelectItem>)}</SelectContent>
                      </Select>
                      {s.status === 'posted' && <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setScore(s)}>{s.qualified_comments != null ? `${s.qualified_comments} qualified` : 'Score'}</Button>}
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Post A/B tests (judged on qualified comments)</h3>
              {tests.length === 0
                ? <p className="text-sm text-muted-foreground">No scored test posts yet. Tag slots with a test and a variant (A, B), mark them posted, then score them. A winner needs {MIN_POSTS_PER_VARIANT} posts on each side and a clear gap.</p>
                : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] uppercase text-muted-foreground"><th className="font-medium">Test</th><th className="font-medium">Variant</th><th className="font-medium text-right">Posts</th><th className="font-medium text-right">Qualified / post</th><th className="font-medium text-right">Profile views</th><th className="font-medium text-right">Accepts</th></tr></thead>
                    <tbody>{tests.map(t => (
                      <tr key={t.test + t.variant} className="border-t">
                        <td>{t.test}</td><td>{t.variant} {t.winner && <Trophy className="inline h-3.5 w-3.5 text-warning" />}</td>
                        <td className="text-right tabular-nums">{t.posts}{!t.enough && <span className="text-[10px] text-muted-foreground"> /{MIN_POSTS_PER_VARIANT}</span>}</td>
                        <td className="text-right tabular-nums">{t.perPost.toFixed(1)}</td><td className="text-right tabular-nums">{t.views}</td><td className="text-right tabular-nums">{t.accepts}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-auto">Pieces ({shown.length})</h3>
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="open">Not posted yet</SelectItem>{CONTENT_STATUSES.map(s => <SelectItem key={s} value={s}>{label(s)} ({counts[s] ?? 0})</SelectItem>)}<SelectItem value="all">All</SelectItem></SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Piece</Button>
              </div>
              {shown.map(p => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 border-t pt-1.5 text-sm">
                  <Badge variant="outline" className="text-[10px]">{label(p.kind)}</Badge>
                  <button className="flex-1 min-w-0 truncate text-left hover:underline" onClick={() => setEdit(p)}>{p.title}</button>
                  {p.parent_id && <span className="text-[10px] text-muted-foreground">cut-up</span>}
                  <Select value={p.status} onValueChange={v => patchPiece(p.id, { status: v })}>
                    <SelectTrigger className={cn('h-6 w-24 text-[11px]', STATUS_STYLE[p.status])}><SelectValue /></SelectTrigger>
                    <SelectContent>{CONTENT_STATUSES.map(s => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {edit && <PieceDialog piece={edit} pieces={pieces} onClose={() => setEdit(null)} onSave={async p => { await patchPiece(edit.id, p); setEdit(null); }} onSlot={async d => {
        const { error } = await db.from('content_slots').insert({ piece_id: edit.id, channel: 'linkedin', slot_date: d, slot_time_ct: '08:00', status: 'planned' });
        if (error) toast.error(error.message); else { toast.success('Slot added'); void load(); }
      }} />}
      {score && <ScoreDialog slot={score} onClose={() => setScore(null)} onSave={async p => { await patchSlot(score.id, p); setScore(null); }} />}
      {adding && <NewPieceDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
    </div>
  );
}

function Mini({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return <Card><CardContent className="py-3"><div className={cn('text-lg font-semibold tabular-nums', warn && 'text-warning')}>{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></CardContent></Card>;
}

function PieceDialog({ piece, pieces, onClose, onSave, onSlot }: { piece: Piece; pieces: Piece[]; onClose: () => void; onSave: (p: Record<string, unknown>) => void; onSlot: (date: string) => void }) {
  const [title, setTitle] = useState(piece.title);
  const [body, setBody] = useState(piece.body ?? '');
  const [proof, setProof] = useState(piece.proof ?? '');
  const [search, setSearch] = useState(piece.target_search ?? '');
  const [notes, setNotes] = useState(piece.notes ?? '');
  const [parent, setParent] = useState(piece.parent_id ?? 'none');
  const [slot, setSlot] = useState('');
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{label(piece.kind)}{piece.pillar ? ` · ${piece.pillar}` : ''}</DialogTitle></DialogHeader>
        <Input value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea rows={12} value={body} onChange={e => setBody(e.target.value)} placeholder="The piece" />
        {piece.format_note && <p className="text-xs text-muted-foreground">Format: {piece.format_note}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input placeholder="Proof point (every piece carries one)" value={proof} onChange={e => setProof(e.target.value)} />
          <Input placeholder="Target search (articles)" value={search} onChange={e => setSearch(e.target.value)} />
          <Select value={parent} onValueChange={setParent}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Cut from" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Not a cut-up</SelectItem>{pieces.filter(p => p.id !== piece.id && p.kind !== 'post').map(p => <SelectItem key={p.id} value={p.id}>{p.title.slice(0, 60)}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-1"><Input type="date" value={slot} onChange={e => setSlot(e.target.value)} /><Button variant="outline" disabled={!slot} onClick={() => onSlot(slot)}>Add slot</Button></div>
        </div>
        <Textarea rows={2} placeholder="Notes for Caleb or the content job" value={notes} onChange={e => setNotes(e.target.value)} />
        {piece.source && <p className="text-[11px] text-muted-foreground">Source: {piece.source}</p>}
        <DialogFooter><Button onClick={() => onSave({ title: title.trim(), body: body.trim() || null, proof: proof.trim() || null, target_search: search.trim() || null, notes: notes.trim() || null, parent_id: parent === 'none' ? null : parent })}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScoreDialog({ slot, onClose, onSave }: { slot: Slot; onClose: () => void; onSave: (p: Record<string, unknown>) => void }) {
  const fields = [['impressions', 'Impressions'], ['reactions', 'Reactions'], ['comments', 'Comments'], ['qualified_comments', 'Comments from buyer-fit people'], ['profile_views_3d', 'Profile views (3 days)'], ['accepts_3d', 'Connection accepts (3 days)']] as const;
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map(([k]) => [k, slot[k] != null ? String(slot[k]) : ''])));
  const [url, setUrl] = useState(slot.post_url ?? '');
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Score the post</DialogTitle></DialogHeader>
        <Input placeholder="Post URL" value={url} onChange={e => setUrl(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          {fields.map(([k, l]) => <label key={k} className="text-xs space-y-1"><span className="text-muted-foreground">{l}</span><Input type="number" min={0} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} /></label>)}
        </div>
        <DialogFooter><Button onClick={() => onSave({ post_url: url.trim() || null, ...Object.fromEntries(fields.map(([k]) => [k, v[k] === '' ? null : Number(v[k])])) })}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewPieceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('post');
  const [pillar, setPillar] = useState('');
  const save = async () => {
    const { error } = await db.from('content_pieces').insert({ title: title.trim(), kind, pillar: pillar.trim() || null, status: 'idea', source: 'added in PD HQ' });
    if (error) { toast.error(error.message); return; }
    onSaved();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New piece</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Select value={kind} onValueChange={setKind}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{CONTENT_KINDS.map(k => <SelectItem key={k} value={k}>{label(k)}</SelectItem>)}</SelectContent></Select>
          <Input placeholder="Pillar" value={pillar} onChange={e => setPillar(e.target.value)} />
        </div>
        <DialogFooter><Button disabled={!title.trim()} onClick={save}>Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
