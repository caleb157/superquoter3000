// Sales section: Needs you (what to do next), Pipeline, Prospecting (funnel, pace, A/B), Traction (bullseye, ideas, communities),
// Content (pieces, calendar, post tests) and Jobs (runs, credits, cost).
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ResponsiveTabs } from '@/components/ResponsiveTabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Check, SkipForward, Ban, AlertTriangle, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AccountActions } from '@/components/sales/AccountActions';
import { ProspectingTab } from '@/components/sales/ProspectingTab';
import { TractionTab } from '@/components/sales/TractionTab';
import { ContentTab } from '@/components/sales/ContentTab';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { SalesStageBadge } from '@/components/sales/SalesStageBadge';
import { CHANNEL_ICON } from '@/components/sales/SalesAccountPanel';
import { SALES_EXITS, SALES_STAGES, SALES_STAGE_LABELS } from '@/lib/sales/sales-core';
import { buildNeedsYou, groupByStage, summarizeJobs, type AccountRow, type JobRunRow, type NeedsYouEntry, type TaskRow, type TouchRow } from '@/lib/sales/needs-you';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

type PipelineAccount = AccountRow & { persona: string | null; customer_type: string | null; fit_score: number | null; last_contacted_at: string | null; not_now_until: string | null; owner: string | null; source: string | null };
type JobRun = JobRunRow & { id: string; summary: string | null; finished_at: string | null; run_by: string | null };
type Block = { id: string; channel: string; sender: string | null; reason: string; blocked_at: string; customer_id: string | null };

const KIND_LABEL: Record<NeedsYouEntry['kind'], string> = { forgotten: 'Forgotten', qualified: 'Qualified', nudge: 'Nudge', draft: 'Draft reply', task: 'Due', quiet: 'Warm, nothing planned', back: 'Back from Not now' };
const KIND_COLOR: Record<NeedsYouEntry['kind'], string> = {
  forgotten: 'bg-destructive/15 text-destructive', qualified: 'bg-success/15 text-success', nudge: 'bg-primary/10 text-primary', draft: 'bg-warning/15 text-warning', task: 'bg-muted text-muted-foreground',
  quiet: 'bg-warning/10 text-warning', back: 'bg-primary/10 text-primary',
};

export default function Sales() {
  useDocumentTitle('Sales');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'needs';
  const setTab = (t: string) => setParams(p => { p.set('tab', t); return p; }, { replace: true });

  const [accounts, setAccounts] = useState<PipelineAccount[]>([]);
  const [touches, setTouches] = useState<TouchRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [engagedIds, setEngagedIds] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [needsFilter, setNeedsFilter] = useState<string>('all');

  const load = async () => {
    const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [a, t, k, r, b, e] = await Promise.all([
      db.from('customers').select('id, name, company, sales_stage, dnc, next_step, next_step_date, persona, customer_type, fit_score, last_contacted_at, not_now_until, owner, source, sales_stage_changed_at, brief_updated_at').not('sales_stage', 'is', null).order('sales_stage_changed_at', { ascending: false }).limit(2000),
      db.from('sales_touches').select('customer_id, direction, occurred_at, channel, body').gte('occurred_at', since90).order('occurred_at', { ascending: false }).limit(5000),
      db.from('tasks').select('id, customer_id, title, due_date, status, nudge_step, draft_text, draft_status, draft_channel, priority').eq('status', 'open').not('customer_id', 'is', null).limit(2000),
      db.from('job_runs').select('id, job, status, started_at, finished_at, summary, counts, credits, cost_usd, needs_review, run_by').gte('started_at', since30).order('started_at', { ascending: false }).limit(500),
      db.from('send_blocks').select('id, channel, sender, reason, blocked_at, customer_id').gte('blocked_at', since30).order('blocked_at', { ascending: false }).limit(200),
      db.from('contacts').select('customer_id').eq('engaged', true).limit(5000),
    ]);
    if (a.error) { setMissing(true); setLoading(false); return; }
    setAccounts(a.data ?? []); setTouches(t.data ?? []); setTasks(k.data ?? []); setRuns(r.data ?? []); setBlocks(b.data ?? []);
    setEngagedIds(new Set((e.data ?? []).map((x: { customer_id: string | null }) => x.customer_id).filter(Boolean)));
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const needs = useMemo(() => buildNeedsYou(accounts, touches, tasks, new Date(), 7, engagedIds), [accounts, touches, tasks, engagedIds]);
  const urgent = needs.filter(n => n.kind !== 'quiet' && n.kind !== 'back').length;
  const shownNeeds = needsFilter === 'all' ? needs : needs.filter(n => needsFilter === 'now' ? n.kind !== 'quiet' && n.kind !== 'back' : n.kind === needsFilter);
  const match = (a: PipelineAccount) => !q.trim() || `${a.company ?? ''} ${a.name} ${a.persona ?? ''} ${a.customer_type ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());
  const byStage = useMemo(() => groupByStage(accounts.filter(match), [...SALES_STAGES, ...SALES_EXITS]), [accounts, q]);
  const allByStage = useMemo(() => groupByStage(accounts, [...SALES_STAGES, ...SALES_EXITS]), [accounts]);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const jobs = useMemo(() => summarizeJobs(runs, weekAgo), [runs, weekAgo]);
  const lastTouch = useMemo(() => {
    const m = new Map<string, TouchRow>();
    for (const t of touches) if (t.customer_id && !m.has(t.customer_id)) m.set(t.customer_id, t);
    return m;
  }, [touches]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mr-auto">Sales</h1>
          <Stat label="Needs you now" value={urgent} />
          <Stat label="Warm, nothing planned" value={needs.filter(n => n.kind === 'quiet').length} />
          <Stat label="In outreach" value={allByStage.in_outreach?.length ?? 0} />
          <Stat label="Talking" value={(allByStage.responded?.length ?? 0) + (allByStage.in_conversation?.length ?? 0)} />
          <Stat label="Inquiries" value={allByStage.inquiry?.length ?? 0} />
          <Stat label="Customers" value={allByStage.customer?.length ?? 0} />
        </div>

        {missing ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">The Sales tables are not in the database yet. They arrive when this release's migration is applied.</CardContent></Card>
        ) : loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <ResponsiveTabs value={tab} onValueChange={setTab} options={[
              { value: 'needs', label: `Needs you (${needs.length})` },
              { value: 'pipeline', label: 'Pipeline' },
              { value: 'prospecting', label: 'Prospecting' },
              { value: 'traction', label: 'Traction' },
              { value: 'content', label: 'Content' },
              { value: 'jobs', label: 'Jobs and cost' },
            ]} />

            <TabsContent value="needs" className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1">
                {[['all', `All ${needs.length}`], ['now', `Do now ${urgent}`], ['quiet', `Warm, nothing planned ${needs.filter(n => n.kind === 'quiet').length}`], ['back', `Back from Not now ${needs.filter(n => n.kind === 'back').length}`]].map(([v, l]) => (
                  <Button key={v} size="sm" variant={needsFilter === v ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setNeedsFilter(v)}>{l}</Button>
                ))}
              </div>
              {shownNeeds.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Nothing waits for you here. Forgotten conversations, qualified accounts, nudges, drafted replies and warm accounts with nothing planned show here.</CardContent></Card>}
              {shownNeeds.slice(0, 150).map(e => <NeedsCard key={e.key} entry={e} onChanged={load} />)}
            </TabsContent>

            <TabsContent value="pipeline" className="mt-3 space-y-3">
              <div className="relative max-w-xs"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="h-9 pl-8" placeholder="Find an account" value={q} onChange={e => setQ(e.target.value)} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
                {SALES_STAGES.map(s => (
                  <div key={s} className="rounded-lg bg-muted/40 p-2 space-y-2 min-w-0">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{SALES_STAGE_LABELS[s]}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{byStage[s].length}</span>
                    </div>
                    {byStage[s].slice(0, 60).map(a => {
                      const lt = lastTouch.get(a.id);
                      const I = lt ? CHANNEL_ICON[lt.channel] : null;
                      return (
                        <Link key={a.id} to={`/customers/${a.id}?tab=sales`} className="block rounded-md border bg-card p-2 hover:bg-accent/40">
                          <div className="text-sm font-medium truncate">{a.company || a.name}</div>
                          <div className="flex flex-wrap items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                            {a.persona && <span>{a.persona}</span>}
                            {a.fit_score != null && <Badge variant="outline" className="text-[10px] px-1 py-0">Fit {a.fit_score}</Badge>}
                            {I && <I className="h-3 w-3 ml-auto" />}
                            {a.last_contacted_at && <span>{formatDistanceToNow(new Date(a.last_contacted_at), { addSuffix: true })}</span>}
                          </div>
                        </Link>
                      );
                    })}
                    {byStage[s].length > 60 && <div className="text-[11px] text-center text-muted-foreground">+{byStage[s].length - 60} more</div>}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {SALES_EXITS.map(s => <span key={s} className="flex items-center gap-1"><SalesStageBadge stage={s} /> {byStage[s].length}</span>)}
              </div>
            </TabsContent>

            <TabsContent value="prospecting" className="mt-3"><ProspectingTab accounts={accounts} /></TabsContent>
            <TabsContent value="traction" className="mt-3"><TractionTab /></TabsContent>
            <TabsContent value="content" className="mt-3"><ContentTab /></TabsContent>

            <TabsContent value="jobs" className="mt-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat boxed label="Runs this week" value={jobs.runs} />
                <Stat boxed label="Failed" value={jobs.failed} warn={jobs.failed > 0} />
                <Stat boxed label="Cost this week" value={`$${jobs.totalCost.toFixed(2)}`} />
                <Stat boxed label="Sends blocked (30 days)" value={blocks.length} />
              </div>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Job</TableHead><TableHead>Last run</TableHead><TableHead>Runs (7 days)</TableHead><TableHead>Waiting for you</TableHead><TableHead>Credits</TableHead><TableHead className="text-right">Cost</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {jobs.jobs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No job has reported a run yet. Each playbook job logs one at the end of every run.</TableCell></TableRow>}
                      {jobs.jobs.map(j => (
                        <TableRow key={j.job}>
                          <TableCell className="font-medium">{j.job}</TableCell>
                          <TableCell><span className={cn(j.lastStatus === 'failed' && 'text-destructive')}>{j.lastStatus}</span> · {formatDistanceToNow(new Date(j.last), { addSuffix: true })}</TableCell>
                          <TableCell>{j.runs}{j.failed ? ` (${j.failed} failed)` : ''}</TableCell>
                          <TableCell>{j.needs_review}</TableCell>
                          <TableCell className="text-xs">{Object.entries(j.credits).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">${j.cost.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Recent runs</h3>
              <Card>
                <CardContent className="p-2 space-y-1">
                  {runs.slice(0, 30).map(r => (
                    <div key={r.id} className="flex flex-wrap gap-2 text-sm border-t first:border-t-0 py-1.5">
                      <span className="text-xs text-muted-foreground w-32 shrink-0">{format(new Date(r.started_at), 'd MMM, HH:mm')}</span>
                      <span className="font-medium w-36 shrink-0 truncate">{r.job}</span>
                      {r.status !== 'ok' && <Badge variant="secondary" className={cn('text-[10px]', r.status === 'failed' && 'bg-destructive/15 text-destructive')}>{r.status}</Badge>}
                      <span className="text-muted-foreground flex-1 min-w-0">{r.summary}</span>
                    </div>
                  ))}
                  {runs.length === 0 && <div className="text-sm text-muted-foreground p-4 text-center">No runs in the last 30 days.</div>}
                </CardContent>
              </Card>
              {blocks.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Sends blocked by do not contact</h3>
                  <Card><CardContent className="p-2 space-y-1">
                    {blocks.slice(0, 30).map(b => (
                      <div key={b.id} className="flex flex-wrap gap-2 text-sm py-1 border-t first:border-t-0">
                        <Ban className="h-4 w-4 text-destructive" />
                        <span className="text-xs text-muted-foreground w-32">{format(new Date(b.blocked_at), 'd MMM, HH:mm')}</span>
                        <span>{b.channel}{b.sender ? ` · ${b.sender}` : ''}</span>
                        <span className="text-muted-foreground">{b.reason}</span>
                        {b.customer_id && <Link className="text-primary text-xs ml-auto" to={`/customers/${b.customer_id}?tab=sales`}>Account</Link>}
                      </div>
                    ))}
                  </CardContent></Card>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}

function NeedsCard({ entry, onChanged }: { entry: NeedsYouEntry; onChanged: () => void }) {
  const [draft, setDraft] = useState(entry.task?.draft_text ?? '');
  const [busy, setBusy] = useState(false);
  const a = entry.account;
  const setDraftStatus = async (status: 'approved' | 'skipped') => {
    if (!entry.task) return;
    setBusy(true);
    const patch: Record<string, unknown> = { draft_status: status, draft_text: draft.trim() || null };
    if (status === 'skipped') { patch.status = 'done'; patch.completed_at = new Date().toISOString(); }
    const { error } = await db.from('tasks').update(patch).eq('id', entry.task.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(status === 'approved' ? 'Approved. It goes out on the next send run.' : 'Skipped');
    onChanged();
  };
  const hasDraft = !!entry.task?.draft_text;
  return (
    <Card className={cn(entry.kind === 'forgotten' && 'border-destructive/40')}>
      <CardContent className="py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className={cn('text-[10px]', KIND_COLOR[entry.kind])}>{entry.kind === 'forgotten' && <AlertTriangle className="h-3 w-3 mr-1" />}{KIND_LABEL[entry.kind]}</Badge>
          <Link to={`/customers/${a.id}?tab=sales`} className="font-medium hover:underline">{a.company || a.name}</Link>
          <SalesStageBadge stage={a.sales_stage} />
          <span className="text-sm text-muted-foreground">{entry.title}</span>
          {entry.due_date && <span className="text-xs text-muted-foreground ml-auto">due {format(new Date(entry.due_date), 'd MMM')}</span>}
        </div>
        {entry.engaged && <span className="text-[11px] text-success">Engaged contact</span>}
        {entry.kind === 'forgotten' && entry.detail && <p className="text-sm rounded-md bg-muted/50 p-2 whitespace-pre-line line-clamp-4">“{entry.detail}”</p>}
        {hasDraft && (
          <div className="space-y-2">
            <Textarea rows={Math.min(8, Math.max(3, draft.split('\n').length + 1))} value={draft} onChange={e => setDraft(e.target.value)} className="text-sm" />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 gap-1" disabled={busy || !draft.trim()} onClick={() => setDraftStatus('approved')}><Check className="h-3.5 w-3.5" /> Approve{entry.task?.draft_channel ? ` (${entry.task.draft_channel})` : ''}</Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1" disabled={busy} onClick={() => setDraftStatus('skipped')}><SkipForward className="h-3.5 w-3.5" /> Skip</Button>
            </div>
          </div>
        )}
        <AccountActions account={a} onChanged={onChanged} compact />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, boxed, warn }: { label: string; value: string | number; boxed?: boolean; warn?: boolean }) {
  const inner = (
    <div className={cn(!boxed && 'text-right')}>
      <div className={cn('text-lg font-semibold tabular-nums', warn && 'text-destructive')}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
  return boxed ? <Card><CardContent className="py-3">{inner}</CardContent></Card> : inner;
}
