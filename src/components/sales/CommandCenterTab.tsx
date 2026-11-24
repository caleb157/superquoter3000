// Command center: the Sales landing page. One screen for the whole machine: this week against last week and the
// targets, the funnel against a week ago, what needs Caleb, every scheduled run (last, next, state, credits),
// Claude and tool usage, the best prospects waiting, and his tasks due. Maths in src/lib/sales/command-center.ts.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarClock, CircleAlert, CircleCheck, CircleDashed, CirclePause, Clock, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SALES_STAGE_LABELS, type SalesStage } from '@/lib/sales/sales-core';
import type { NeedsYouEntry } from '@/lib/sales/needs-you';
import {
  claudePace, comingUp, creditsByTool, funnelWeekAgo, latestUsage, runBoard, tasksDue, weekOverWeek, weekTargets,
  type BoardRow, type CcRun, type CcSchedule, type CcStageEvent, type CcTask, type CcTouch, type CcUsage, type RunState
} from '@/lib/sales/command-center';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

type Account = { id: string; name: string; company: string | null; sales_stage: string | null; fit_score: number | null; persona: string | null; next_step?: string | null; sales_stage_changed_at?: string | null };
type TopProspect = { id: string; name: string; effective_tier: string; country: string | null; prospect_type: string | null; best_contact: string | null; people_count: number; rank: number | null };

const istTime = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(',', '');
const ago = (d: Date | string) => formatDistanceToNowStrict(new Date(d), { addSuffix: true });
const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);

const NEED_KINDS: { kind: NeedsYouEntry['kind']; label: string }[] = [
  { kind: 'forgotten', label: 'Forgotten' }, { kind: 'qualified', label: 'Qualified' }, { kind: 'draft', label: 'Drafts to approve' },
  { kind: 'nudge', label: 'Nudges' }, { kind: 'task', label: 'Due' }, { kind: 'quiet', label: 'Warm, nothing planned' }, { kind: 'back', label: 'Back from Not now' },
];

export function CommandCenterTab({ accounts, needs, runs, schedules, onOpen }: {
  accounts: Account[]; needs: NeedsYouEntry[]; runs: CcRun[]; schedules: CcSchedule[]; onOpen: (tab: string) => void;
}) {
  const [touches, setTouches] = useState<CcTouch[]>([]);
  const [events, setEvents] = useState<CcStageEvent[]>([]);
  const [inquiries, setInquiries] = useState<{ id: string; customer_id: string | null; received_date: string | null; created_at: string }[]>([]);
  const [tasks, setTasks] = useState<CcTask[]>([]);
  const [usage, setUsage] = useState<CcUsage[]>([]);
  const [top, setTop] = useState<TopProspect[] | null>(null);
  const [firstEmail, setFirstEmail] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const since = new Date(Date.now() - 21 * 86_400_000).toISOString();
    const touchCols = 'customer_id, channel, direction, occurred_at, is_drip';
    void Promise.all([
      db.from('sales_touches').select(`${touchCols}, bounced_at`).gte('occurred_at', since).limit(20000),
      db.from('sales_stage_events').select('customer_id, from_stage, to_stage, occurred_at, actor').gte('occurred_at', since).limit(20000),
      db.from('customer_rfqs').select('id, customer_id, received_date, created_at').gte('created_at', since).limit(2000),
      db.from('tasks').select('id, title, due_date, status, priority, assignee, customer_id, association_label').eq('status', 'open').not('due_date', 'is', null).order('due_date').limit(3000),
      db.from('usage_snapshots').select('taken_at, source, metric, value, unit, resets_at, plan, note').order('taken_at', { ascending: false }).limit(500),
      db.rpc('search_prospects', { p_q: null, p_lists: null, p_types: null, p_tiers: ['A'], p_countries: null, p_tags: null, p_status: ['new', 'researching', 'ready'], p_in_crm: false, p_has_people: null, p_sort: 'rank', p_limit: 8, p_offset: 0 }),
      db.from('sales_touches').select('occurred_at').eq('channel', 'email').eq('direction', 'out').eq('is_drip', false).order('occurred_at').limit(1),
    ]).then(async ([t, e, q, k, u, p, f]) => {
      // Before this release's migration, bounced_at is missing: read the touches without it.
      if (t.error) t = await db.from('sales_touches').select(touchCols).gte('occurred_at', since).limit(20000);
      setTouches(t.data ?? []); setEvents(e.data ?? []); setInquiries(q.data ?? []); setTasks(k.data ?? []);
      setUsage(u.error ? [] : u.data ?? []); setTop(p.error ? null : p.data?.rows ?? []); setFirstEmail(f.data?.[0]?.occurred_at ?? null);
    });
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const pipelineIds = useMemo(() => new Set(accounts.map(a => a.id)), [accounts]);
  const wow = useMemo(() => weekOverWeek(touches, events, inquiries, pipelineIds, now), [touches, events, inquiries, pipelineIds, now]);
  const targets = useMemo(() => weekTargets(now, firstEmail), [now, firstEmail]);
  const funnel = useMemo(() => funnelWeekAgo(accounts, events, now), [accounts, events, now]);
  const board = useMemo(() => runBoard(schedules, runs, now), [schedules, runs, now]);
  const soon = useMemo(() => comingUp(board, now, 24), [board, now]);
  const latest = useMemo(() => latestUsage(usage), [usage]);
  const pace = useMemo(() => claudePace(latest.get('claude|weekly_pct'), now), [latest, now]);
  const credits = useMemo(() => creditsByTool(runs, now), [runs, now]);
  const due = useMemo(() => tasksDue(tasks, now, 'CQ'), [tasks, now]);
  const queued = useMemo(() => accounts.filter(a => a.sales_stage === 'queued').sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1)).slice(0, 8), [accounts]);
  const needCounts = useMemo(() => Object.fromEntries(NEED_KINDS.map(k => [k.kind, needs.filter(n => n.kind === k.kind).length])), [needs]);
  const urgent = needs.filter(n => n.kind !== 'quiet' && n.kind !== 'back');
  const attention = board.filter(r => r.state === 'failed' || r.state === 'no_report').length;

  const tw = wow.thisWeek, lp = wow.lastWeekSamePoint, lw = wow.lastWeek;
  const bounceBad = tw.bounceRate != null && tw.bounceRate >= targets.maxBounceRate;

  return (
    <div className="space-y-4">
      {/* Headline: one sentence of where things stand. */}
      <Card className="bg-muted/30">
        <CardContent className="py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="font-medium">Week of {wow.weekStart.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}</span>
          <Headline ok={tw.linkedin + tw.email >= targets.linkedin.dueSoFar * 0.8} text={`${tw.linkedin + tw.email} sent of ${targets.linkedin.dueSoFar + targets.email.dueSoFar} due by today`} />
          <Headline ok={urgent.length === 0} text={`${urgent.length} need${urgent.length === 1 ? 's' : ''} you now`} onClick={() => onOpen('needs')} />
          <Headline ok={attention === 0} text={attention ? `${attention} run${attention === 1 ? '' : 's'} to check` : 'All runs reporting'} />
          <Headline ok={due.overdue.length === 0} text={`${due.overdue.length} task${due.overdue.length === 1 ? '' : 's'} overdue`} />
          {pace && <Headline ok={pace.projected < 90} text={`Claude ${pace.pct}% of the week, pace ${pace.projected}%`} />}
          <span className="text-xs text-muted-foreground ml-auto">Updated {istTime(now)} IST</span>
        </CardContent>
      </Card>

      {/* This week against last week and the targets. */}
      <section className="space-y-2">
        <SectionTitle>This week so far</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
          <Tile label="LinkedIn sent" value={tw.linkedin} prev={lp.linkedin} prevAll={lw.linkedin} target={`${targets.linkedin.dueSoFar} due by today · ${targets.linkedin.week} a week`} progress={tw.linkedin / Math.max(1, targets.linkedin.dueSoFar)} warn={tw.linkedin > targets.linkedin.cap ? `Over the ${targets.linkedin.cap} cap` : null} />
          <Tile label="Emails sent" value={tw.email} prev={lp.email} prevAll={lw.email} target={`${targets.email.dueSoFar} due by today · ${targets.email.daily} a day now`} progress={tw.email / Math.max(1, targets.email.dueSoFar)} />
          <Tile label="Bounce rate" value={pct(tw.bounceRate)} sub={`${tw.bounces} of ${tw.email} emails`} target="Keep under 2%" warn={bounceBad ? 'Hold the email ramp' : null} />
          <Tile label="Replies" value={tw.replies} prev={lp.replies} prevAll={lw.replies} />
          <Tile label="Meetings and calls" value={tw.meetings} prev={lp.meetings} prevAll={lw.meetings} />
          <Tile label="New responders" value={tw.newResponded} prev={lp.newResponded} prevAll={lw.newResponded} />
          <Tile label="New inquiries" value={tw.inquiries} prev={lp.inquiries} prevAll={lw.inquiries} />
          <Tile label="New customers" value={tw.customers} prev={lp.customers} prevAll={lw.customers} />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Funnel against a week ago. */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center"><SectionTitle>Funnel now and a week ago</SectionTitle><Button size="sm" variant="ghost" className="h-7 ml-auto text-xs gap-1" onClick={() => onOpen('pipeline')}>Pipeline <ArrowRight className="h-3 w-3" /></Button></div>
            <FunnelBars rows={funnel} />
          </CardContent>
        </Card>

        {/* What needs Caleb. */}
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center"><SectionTitle>Needs you</SectionTitle><Button size="sm" variant="ghost" className="h-7 ml-auto text-xs gap-1" onClick={() => onOpen('needs')}>Open <ArrowRight className="h-3 w-3" /></Button></div>
            <div className="grid grid-cols-2 gap-1.5">
              {NEED_KINDS.map(k => (
                <div key={k.kind} className={cn('rounded-md border px-2 py-1.5 flex items-center justify-between text-xs', needCounts[k.kind] ? 'bg-card' : 'bg-muted/30 text-muted-foreground')}>
                  <span>{k.label}</span><span className="font-semibold tabular-nums text-sm">{needCounts[k.kind]}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1 pt-1">
              {urgent.slice(0, 6).map(n => (
                <Link key={n.key} to={`/customers/${n.account.id}?tab=sales`} className="flex items-center gap-2 text-sm rounded px-1 py-0.5 hover:bg-accent/40">
                  <span className="font-medium truncate">{n.account.company || n.account.name}</span>
                  <span className="text-xs text-muted-foreground truncate flex-1">{n.title}</span>
                  {n.due_date && <span className="text-[11px] text-muted-foreground whitespace-nowrap">{n.due_date.slice(5)}</span>}
                </Link>
              ))}
              {urgent.length === 0 && <p className="text-xs text-muted-foreground">Nothing urgent. {needCounts.quiet ? `${needCounts.quiet} warm accounts have nothing planned.` : ''}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Every scheduled run. */}
      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SectionTitle>Scheduled and automated runs</SectionTitle>
            <span className="text-xs text-muted-foreground">{soon.length} in the next 24 hours · {board.filter(r => r.state === 'ok' || r.state === 'done').length} reported · {attention} to check</span>
            <Button size="sm" variant="ghost" className="h-7 ml-auto text-xs gap-1" onClick={() => onOpen('jobs')}>Jobs and cost <ArrowRight className="h-3 w-3" /></Button>
          </div>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Run</TableHead><TableHead>When (IST)</TableHead><TableHead>Next</TableHead><TableHead>Last</TableHead><TableHead>State</TableHead><TableHead>Credits this week</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {board.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No runs are set up yet.</TableCell></TableRow>}
                {board.map(r => <RunRow key={r.id} r={r} now={now} />)}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Usage. */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <SectionTitle>Claude usage</SectionTitle>
            <UsageBar label="This week" reading={latest.get('claude|weekly_pct')} />
            <UsageBar label="Current session" reading={latest.get('claude|session_pct')} />
            {latest.get('claude|claude_code_share_pct') && <div className="text-xs text-muted-foreground">Claude Code is {Number(latest.get('claude|claude_code_share_pct')!.value)}% of the week's use.</div>}
            {pace ? (
              <p className="text-xs">
                {Math.round(pace.elapsed * 100)}% of the week gone; at this pace the week ends near <span className={cn('font-semibold', pace.projected >= 100 ? 'text-destructive' : pace.projected >= 85 ? 'text-warning' : 'text-success')}>{pace.projected}%</span>.
                {' '}Resets {istTime(pace.resetsAt)}.{pace.stale ? ' Reading is over a day old.' : ''}
              </p>
            ) : <p className="text-xs text-muted-foreground">No weekly reading yet. The daily usage snapshot at 9:47 PM logs one.</p>}
            {latest.get('claude|weekly_pct')?.plan && <div className="text-xs text-muted-foreground">Plan: {latest.get('claude|weekly_pct')!.plan}. The Friday report makes the Pro vs Max call.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-2">
            <SectionTitle>Credits and cost</SectionTitle>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold tabular-nums">${credits.costThis.toFixed(2)}</span>
              <span className="text-xs text-muted-foreground">this week · ${credits.costLast.toFixed(2)} last week</span>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead className="h-8">Tool</TableHead><TableHead className="h-8 text-right">This week</TableHead><TableHead className="h-8 text-right">Last week</TableHead><TableHead className="h-8 text-right">Left</TableHead></TableRow></TableHeader>
              <TableBody>
                {mergeTools(credits.tools, latest).map(t => (
                  <TableRow key={t.tool}>
                    <TableCell className="py-1.5 text-sm">{t.tool}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">{t.thisWeek}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">{t.lastWeek}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums text-xs" title={t.leftNote ?? undefined}>{t.left ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-[11px] text-muted-foreground">Used = what runs logged. Left = the last balance read.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center"><SectionTitle>Top prospects waiting</SectionTitle><Button size="sm" variant="ghost" className="h-7 ml-auto text-xs gap-1" onClick={() => onOpen('prospects')}>Prospects <ArrowRight className="h-3 w-3" /></Button></div>
            {queued.length > 0 && <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Queued in the pipeline</div>}
            {queued.map(a => (
              <Link key={a.id} to={`/customers/${a.id}?tab=sales`} className="flex items-center gap-2 text-sm hover:bg-accent/40 rounded px-1">
                <span className="truncate font-medium">{a.company || a.name}</span>
                {a.persona && <span className="text-xs text-muted-foreground truncate">{a.persona}</span>}
                {a.fit_score != null && <Badge variant="outline" className="ml-auto text-[10px] px-1 py-0">Fit {a.fit_score}</Badge>}
              </Link>
            ))}
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground pt-1">Tier A, not in the CRM yet</div>
            {top == null && <p className="text-xs text-muted-foreground">Prospects arrive once the Prospects release is applied and the file is loaded.</p>}
            {top?.length === 0 && <p className="text-xs text-muted-foreground">No tier A prospect is waiting.</p>}
            {top?.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-sm px-1">
                <Badge variant="secondary" className="bg-success/15 text-success text-[10px] w-5 justify-center px-0">{p.effective_tier}</Badge>
                <span className="truncate font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground truncate">{[p.country, p.best_contact].filter(Boolean).join(' · ')}</span>
                {p.rank != null && <span className="ml-auto text-[11px] text-muted-foreground">#{p.rank}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Caleb's tasks. */}
      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center"><SectionTitle>Your tasks</SectionTitle><Button asChild size="sm" variant="ghost" className="h-7 ml-auto text-xs gap-1"><Link to="/tasks">All tasks <ArrowRight className="h-3 w-3" /></Link></Button></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TaskList title="Overdue" items={due.overdue} isSales={due.isSales} tone="warn" />
            <TaskList title="Today" items={due.today} isSales={due.isSales} />
            <TaskList title="Next 7 days" items={due.week} isSales={due.isSales} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>;
}

function Headline({ ok, text, onClick }: { ok: boolean; text: string; onClick?: () => void }) {
  const I = ok ? CircleCheck : CircleAlert;
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={cn('flex items-center gap-1.5', onClick && 'hover:underline')}>
      <I className={cn('h-4 w-4', ok ? 'text-success' : 'text-warning')} />{text}
    </button>
  );
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const d = now - prev;
  const I = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return <span className={cn('inline-flex items-center text-[11px]', d > 0 ? 'text-success' : d < 0 ? 'text-warning' : 'text-muted-foreground')}><I className="h-3 w-3" />{d === 0 ? 'same' : Math.abs(d)}</span>;
}

function Tile({ label, value, prev, prevAll, target, progress, sub, warn }: {
  label: string; value: number | string; prev?: number; prevAll?: number; target?: string; progress?: number; sub?: string; warn?: string | null;
}) {
  return (
    <Card className={cn(warn && 'border-warning/60')}>
      <CardContent className="p-3 space-y-1">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {typeof value === 'number' && prev != null && <Delta now={value} prev={prev} />}
        </div>
        {progress != null && <Progress value={Math.min(100, progress * 100)} className="h-1.5" />}
        {prev != null && <div className="text-[11px] text-muted-foreground">{prev} by now last week · {prevAll} all week</div>}
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
        {target && <div className="text-[11px] text-muted-foreground">{target}</div>}
        {warn && <div className="text-[11px] text-warning font-medium">{warn}</div>}
      </CardContent>
    </Card>
  );
}

function FunnelBars({ rows }: { rows: { stage: string; now: number; weekAgo: number; change: number; loaded: number }[] }) {
  const main = rows.filter(r => !['not_now', 'not_a_fit', 'dnc'].includes(r.stage));
  const exits = rows.filter(r => ['not_now', 'not_a_fit', 'dnc'].includes(r.stage));
  const max = Math.max(1, ...main.map(r => Math.max(r.now, r.weekAgo)));
  return (
    <div className="space-y-1.5">
      {main.map(r => (
        <div key={r.stage} className="grid grid-cols-[110px_1fr_88px] items-center gap-2 text-sm">
          <span className="text-xs">{SALES_STAGE_LABELS[r.stage as SalesStage]}</span>
          <div className="relative h-5 rounded bg-muted/50">
            <div className="absolute inset-y-0 left-0 rounded bg-muted-foreground/20" style={{ width: `${(r.weekAgo / max) * 100}%` }} title={`A week ago: ${r.weekAgo}`} />
            <div className="absolute inset-y-1 left-0 rounded bg-primary" style={{ width: `${(r.now / max) * 100}%` }} />
          </div>
          <span className="flex items-center justify-end gap-2 tabular-nums"><span className="font-semibold">{r.now}</span><Delta now={r.now - r.loaded} prev={r.weekAgo} /></span>
        </div>
      ))}
      {rows.some(r => r.loaded) && <p className="text-[11px] text-muted-foreground">{rows.reduce((n, r) => n + r.loaded, 0)} accounts were loaded in bulk this week (existing conversations and customers brought into the CRM). The change arrows leave them out.</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
        {exits.map(r => <span key={r.stage}>{SALES_STAGE_LABELS[r.stage as SalesStage]} <span className="text-foreground font-medium tabular-nums">{r.now}</span> ({r.change - r.loaded >= 0 ? '+' : ''}{r.change - r.loaded})</span>)}
        <span className="ml-auto flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-primary" /> now <span className="inline-block h-2 w-3 rounded bg-muted-foreground/20 ml-2" /> a week ago</span>
      </div>
    </div>
  );
}

const STATE_UI: Record<RunState, { label: string; icon: typeof CircleCheck; cls: string }> = {
  ok: { label: 'Reported', icon: CircleCheck, cls: 'text-success' },
  done: { label: 'Done', icon: CircleCheck, cls: 'text-success' },
  failed: { label: 'Failed', icon: CircleAlert, cls: 'text-destructive' },
  no_report: { label: 'No report', icon: CircleAlert, cls: 'text-warning' },
  upcoming: { label: 'Not due yet', icon: Clock, cls: 'text-muted-foreground' },
  paused: { label: 'Paused', icon: CirclePause, cls: 'text-muted-foreground' },
  planned: { label: 'Planned', icon: CircleDashed, cls: 'text-muted-foreground' },
};

function RunRow({ r, now }: { r: BoardRow; now: Date }) {
  const s = STATE_UI[r.state];
  const soon = r.nextRun && r.nextRun.getTime() - now.getTime() < 24 * 3_600_000;
  const credits = Object.entries(r.creditsWeek).map(([k, v]) => `${k} ${v}`).join(', ');
  return (
    <TableRow className={cn(r.run_once_at && !r.nextRun && 'opacity-70')}>
      <TableCell className="py-2">
        <div className="font-medium text-sm">{r.name}</div>
        {r.note && <div className="text-[11px] text-warning">{r.note}</div>}
      </TableCell>
      <TableCell className="py-2 text-xs whitespace-nowrap">{r.cadence}<div className="text-muted-foreground">{r.runs_where}</div></TableCell>
      <TableCell className="py-2 text-xs whitespace-nowrap">
        {r.nextRun ? <span className={cn(soon && 'font-semibold')}>{soon && <CalendarClock className="inline h-3 w-3 mr-1" />}{istTime(r.nextRun)}<div className="text-muted-foreground font-normal">{ago(r.nextRun)}</div></span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="py-2 text-xs whitespace-nowrap">
        {r.lastRun ? <>{ago(r.lastRun.started_at)}<div className="text-muted-foreground">report: {r.lastRun.status}</div></>
          : r.lastFired ? <>{ago(r.lastFired)}<div className="text-muted-foreground">fired{r.last_fire_status ? `: ${r.last_fire_status}` : ''}</div></>
          : <span className="text-muted-foreground">Never</span>}
      </TableCell>
      <TableCell className="py-2 text-xs max-w-[260px]"><span className={cn('inline-flex items-center gap-1 font-medium', s.cls)}><s.icon className="h-3.5 w-3.5" />{s.label}</span>{r.state !== 'upcoming' && r.stateNote !== s.label && <div className="text-muted-foreground line-clamp-2">{r.stateNote}</div>}</TableCell>
      <TableCell className="py-2 text-xs">{credits || <span className="text-muted-foreground">—</span>}{r.credit_budget && <div className="text-muted-foreground">{r.credit_budget}</div>}{r.costWeek > 0 && <div>${r.costWeek.toFixed(2)}</div>}</TableCell>
    </TableRow>
  );
}

function UsageBar({ label, reading }: { label: string; reading: CcUsage | undefined }) {
  const v = reading ? Number(reading.value) : null;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline text-xs"><span>{label}</span><span className="ml-auto font-semibold text-sm tabular-nums">{v == null ? '—' : `${v}%`}</span></div>
      <Progress value={v ?? 0} className={cn('h-2', v != null && v >= 85 && '[&>div]:bg-warning')} />
      {reading && <div className="text-[11px] text-muted-foreground">Read {ago(reading.taken_at)}{reading.resets_at ? ` · resets ${istTime(new Date(reading.resets_at))}` : ''}</div>}
    </div>
  );
}

function mergeTools(tools: { tool: string; thisWeek: number; lastWeek: number }[], latest: Map<string, CcUsage>) {
  const out = new Map<string, { tool: string; thisWeek: number; lastWeek: number; left: string | null; leftNote: string | null }>();
  for (const t of tools) out.set(t.tool, { ...t, left: null, leftNote: null });
  for (const [k, r] of latest) {
    const [source, metric] = k.split('|');
    if (source === 'claude' || !/left/.test(metric)) continue;
    const key = [...out.keys()].find(x => x.startsWith(source)) ?? source;
    const row = out.get(key) ?? { tool: key, thisWeek: 0, lastWeek: 0, left: null, leftNote: null };
    row.left = `${Number(r.value).toLocaleString()}${r.resets_at ? ` (resets ${new Date(r.resets_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})` : ''}`;
    row.leftNote = [metric.replace(/_/g, ' '), r.note].filter(Boolean).join(': ');
    out.set(key, row);
  }
  const list = [...out.values()];
  if (!list.some(t => t.tool.startsWith('firecrawl'))) list.push({ tool: 'firecrawl', thisWeek: 0, lastWeek: 0, left: null, leftNote: null });
  if (!list.some(t => t.tool.startsWith('reoon'))) list.push({ tool: 'reoon', thisWeek: 0, lastWeek: 0, left: null, leftNote: null });
  return list;
}

function TaskList({ title, items, isSales, tone }: { title: string; items: CcTask[]; isSales: (t: CcTask) => boolean; tone?: 'warn' }) {
  const sales = items.filter(isSales).length;
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-baseline gap-2 text-xs"><span className={cn('font-semibold', tone === 'warn' && items.length > 0 && 'text-warning')}>{title}</span><span className="text-muted-foreground">{items.length}{sales ? ` · ${sales} sales` : ''}</span></div>
      {items.slice(0, 10).map(t => (
        <div key={t.id} className="flex items-center gap-2 text-sm">
          {isSales(t) && <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">Sales</Badge>}
          {(t.priority === 'urgent' || t.priority === 'high') && <span className={cn('text-[10px] font-semibold uppercase shrink-0', t.priority === 'urgent' ? 'text-destructive' : 'text-warning')}>{t.priority}</span>}
          <span className="truncate">{t.title.replace(/^Sales · /, '')}</span>
          {t.due_date && title !== 'Today' && <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">{new Date(`${t.due_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
        </div>
      ))}
      {items.length > 10 && <Link to="/tasks" className="text-xs text-primary">+{items.length - 10} more</Link>}
      {items.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
    </div>
  );
}

