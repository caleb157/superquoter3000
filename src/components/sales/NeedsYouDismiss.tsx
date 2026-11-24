// Needs you: Done and Ignore buttons, the bulk bar, and the Done and ignored list with Undo.
// Rules for when a dismissal stops holding live in src/lib/sales/sales-core.ts (isDismissalActive), shared with the connector.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Check, ChevronDown, EyeOff, RotateCcw, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { addDaysYmd, dismissalEndedBy, IGNORE_CHOICES, needsItemKey, type DismissalLite } from '@/lib/sales/sales-core';
import type { NeedsYouEntry } from '@/lib/sales/needs-you';
import { cn } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

export type DismissalRow = DismissalLite & {
  id: string; kind: string; note: string | null; task_id: string | null; task_prev: Record<string, unknown> | null;
  title: string | null; detail: string | null; actor: string | null;
};
export const DISMISSAL_SELECT = 'id, customer_id, item_key, kind, action, note, until, task_id, task_prev, title, detail, actor, dismissed_at, undone_at';

type Choice = { action: 'done'; note?: string } | { action: 'ignored'; days: number | null };

const MISSING = /needs_you_dismissals|relation .* does not exist|schema cache/i;

/** Mark entries done or ignored. Done closes task items (a drafted reply becomes skipped). Returns an undo function. */
export async function dismissEntries(entries: NeedsYouEntry[], choice: Choice): Promise<(() => Promise<void>) | null> {
  if (!entries.length) return null;
  const until = choice.action === 'ignored' && choice.days ? addDaysYmd(new Date(), choice.days) : null;
  const rows = entries.map(e => {
    const closes = choice.action === 'done' && e.task && e.task.status === 'open';
    return {
      customer_id: e.account.id,
      item_key: needsItemKey(e),
      kind: e.task ? 'task' : e.kind,
      action: choice.action,
      note: choice.action === 'done' ? choice.note?.trim() || null : null,
      until,
      task_id: e.task?.id ?? null,
      task_prev: closes ? { status: 'open', completed_at: null, ...(e.task!.draft_status ? { draft_status: e.task!.draft_status } : {}) } : null,
      title: e.title,
      detail: e.detail ? e.detail.slice(0, 1000) : null,
      actor: 'app',
    };
  });
  const { data, error } = await db.from('needs_you_dismissals').insert(rows).select(DISMISSAL_SELECT);
  if (error) {
    toast.error(MISSING.test(error.message) ? 'Done and Ignore arrive when this release’s database change is applied.' : error.message);
    return null;
  }
  const closing = entries.filter(e => choice.action === 'done' && e.task && e.task.status === 'open').map(e => e.task!);
  for (const t of closing) {
    const patch: Record<string, unknown> = { status: 'done', completed_at: new Date().toISOString() };
    if (t.draft_status === 'draft') patch.draft_status = 'skipped';
    const r = await db.from('tasks').update(patch).eq('id', t.id);
    if (r.error) toast.error(r.error.message);
  }
  return () => undoDismissals(data as DismissalRow[]);
}

/** Put items back on Needs you; a task Done closed is reopened as it was. */
export async function undoDismissals(rows: DismissalRow[]) {
  if (!rows.length) return;
  const { error } = await db.from('needs_you_dismissals').update({ undone_at: new Date().toISOString() }).in('id', rows.map(r => r.id));
  if (error) { toast.error(error.message); return; }
  for (const r of rows) {
    if (!r.task_id || !r.task_prev) continue;
    const res = await db.from('tasks').update({ status: 'open', completed_at: null, ...r.task_prev }).eq('id', r.task_id);
    if (res.error) toast.error(res.error.message);
  }
}

function announce(n: number, choice: Choice, undo: (() => Promise<void>) | null, onChanged: () => void) {
  if (!undo) return;
  const what = n === 1 ? '1 item' : `${n} items`;
  const label = choice.action === 'done'
    ? `${what} marked done. ${n === 1 ? 'It stays' : 'They stay'} off until a new message comes in.`
    : `${what} ignored ${choice.days ? `for ${IGNORE_CHOICES.find(c => c.days === choice.days)?.label.replace(/^For /, '') ?? `${choice.days} days`}` : 'until a new message comes in'}.`;
  toast.success(label, { duration: 8000, action: { label: 'Undo', onClick: () => { void undo().then(() => { toast.success('Put back on Needs you'); onChanged(); }); } } });
  onChanged();
}

/** Per-card Done (split: note) and Ignore (snooze menu). */
export function DismissButtons({ entry, onChanged }: { entry: NeedsYouEntry; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const run = async (choice: Choice) => {
    setBusy(true);
    const undo = await dismissEntries([entry], choice);
    setBusy(false);
    setOpen(false);
    announce(1, choice, undo, onChanged);
  };
  return (
    <div className="flex items-center gap-1">
      <div className="flex">
        <Button size="sm" variant="outline" className="h-7 gap-1 rounded-r-none border-r-0" disabled={busy} onClick={() => run({ action: 'done' })} title={entry.task ? 'Handled: closes this task' : 'Handled: stays off until a new message comes in'}>
          <Check className="h-3.5 w-3.5" /> Done
        </Button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 px-1.5 rounded-l-none" disabled={busy} aria-label="Done with a note"><ChevronDown className="h-3.5 w-3.5" /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-2">
            <div className="text-xs font-medium">Done, with a note</div>
            <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Answered on WhatsApp 22 Nov" className="text-sm" />
            <Button size="sm" className="h-7 w-full gap-1" disabled={busy} onClick={() => run({ action: 'done', note })}><Check className="h-3.5 w-3.5" /> Mark done</Button>
          </PopoverContent>
        </Popover>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-muted-foreground" disabled={busy}><EyeOff className="h-3.5 w-3.5" /> Ignore <ChevronDown className="h-3 w-3" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {IGNORE_CHOICES.map(c => <DropdownMenuItem key={c.label} onClick={() => run({ action: 'ignored', days: c.days })}>{c.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Shown while cards are ticked: one click for all of them. */
export function BulkBar({ selected, onClear, onChanged }: { selected: NeedsYouEntry[]; onClear: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!selected.length) return null;
  const run = async (choice: Choice) => {
    setBusy(true);
    const undo = await dismissEntries(selected, choice);
    setBusy(false);
    if (undo) onClear();
    announce(selected.length, choice, undo, onChanged);
  };
  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card/95 backdrop-blur px-3 py-2 shadow-sm">
      <span className="text-sm font-medium mr-1">{selected.length} selected</span>
      <Button size="sm" className="h-7 gap-1" disabled={busy} onClick={() => run({ action: 'done' })}><Check className="h-3.5 w-3.5" /> Done</Button>
      {IGNORE_CHOICES.map(c => (
        <Button key={c.label} size="sm" variant="outline" className="h-7 gap-1" disabled={busy} onClick={() => run({ action: 'ignored', days: c.days })}>
          <EyeOff className="h-3.5 w-3.5" /> Ignore {c.label.replace(/^For /, '').toLowerCase()}
        </Button>
      ))}
      <Button size="sm" variant="ghost" className="h-7 gap-1 ml-auto" onClick={onClear}><X className="h-3.5 w-3.5" /> Clear</Button>
    </div>
  );
}

const ENDED_LABEL: Record<string, string> = { date: 'Back: ignore date came', new_message: 'Back: new message', stage: 'Back: stage changed' };
const KIND_NAME: Record<string, string> = { forgotten: 'Forgotten', qualified: 'Qualified', quiet: 'Warm, nothing planned', back: 'Back from Not now', task: 'Task' };

/** Everything marked done or ignored in the last 90 days, newest first, with Undo. Nothing is lost. */
export function DismissedList({ rows, names, lastInbound, lastTouch, stageChanged, onChanged }: {
  rows: DismissalRow[]; names: Map<string, string>; lastInbound: Map<string, string>; lastTouch: Map<string, string>; stageChanged: Map<string, string | null>; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const live = rows.filter(r => !r.undone_at);
  if (!live.length) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Nothing marked done or ignored yet. Items you mark Done or Ignore land here, so nothing is lost.</CardContent></Card>;
  return (
    <div className="space-y-2">
      {live.map(r => {
        const ended = dismissalEndedBy(r, { lastInboundAt: lastInbound.get(r.customer_id), lastTouchAt: lastTouch.get(r.customer_id), stageChangedAt: stageChanged.get(r.customer_id) ?? null, today });
        return (
          <Card key={r.id} className={cn(ended && 'opacity-70')}>
            <CardContent className="py-2.5 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={cn('text-[10px]', r.action === 'done' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>
                {r.action === 'done' ? 'Done' : r.until ? `Ignored until ${format(new Date(r.until), 'd MMM')}` : 'Ignored'}
              </Badge>
              <Link to={`/customers/${r.customer_id}?tab=sales`} className="font-medium hover:underline">{names.get(r.customer_id) ?? 'Account'}</Link>
              <span className="text-xs text-muted-foreground">{KIND_NAME[r.kind] ?? r.kind}{r.title ? ` · ${r.title}` : ''}</span>
              {ended && <Badge variant="outline" className="text-[10px]">{ENDED_LABEL[ended]}</Badge>}
              <span className="text-xs text-muted-foreground ml-auto">{format(new Date(r.dismissed_at), 'd MMM, HH:mm')}{r.actor && r.actor !== 'app' ? ` · ${r.actor}` : ''}</span>
              <Button size="sm" variant="ghost" className="h-7 gap-1" disabled={busy === r.id} onClick={async () => {
                setBusy(r.id); await undoDismissals([r]); setBusy(null); toast.success('Put back on Needs you'); onChanged();
              }}><RotateCcw className="h-3.5 w-3.5" /> Undo</Button>
              {r.note && <p className="basis-full text-sm text-muted-foreground">Note: {r.note}</p>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
