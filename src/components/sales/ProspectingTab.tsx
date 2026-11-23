// Prospecting: is the machine running? Funnel, this week's sends against target, what moved,
// which message variants win, and how inquiries end (won / lost) by source channel.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SALES_EXITS, SALES_STAGE_LABELS, type SalesStage } from '@/lib/sales/sales-core';
import { MIN_SENDS_PER_VARIANT, SEND_TARGETS, breakdown, experiments, funnel, sendPace, winLoss, type FunnelAccount, type InquiryLite, type SendTouch } from '@/lib/sales/prospecting';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function ProspectingTab({ accounts }: { accounts: (FunnelAccount & { id: string })[] }) {
  const [touches, setTouches] = useState<SendTouch[]>([]);
  const [inquiries, setInquiries] = useState<InquiryLite[]>([]);
  const [moves, setMoves] = useState<{ to_stage: string | null; from_stage: string | null }[]>([]);
  const [channels, setChannels] = useState<{ id: number; name: string }[]>([]);
  const [firstEmail, setFirstEmail] = useState<string | null>(null);

  useEffect(() => {
    const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    void Promise.all([
      db.from('sales_touches').select('customer_id, contact_id, channel, direction, occurred_at, variant, test_name, is_drip, sender_account').gte('occurred_at', since).limit(10000),
      db.from('customer_rfqs').select('id, status, customer_id, source_channel, received_date, created_at').limit(5000),
      db.from('sales_stage_events').select('to_stage, from_stage').gte('occurred_at', week).limit(5000),
      db.from('traction_channels').select('id, name'),
      db.from('sales_touches').select('occurred_at').eq('channel', 'email').eq('direction', 'out').eq('is_drip', false).order('occurred_at').limit(1),
    ]).then(([t, q, m, c, f]) => {
      setTouches(t.data ?? []); setInquiries(q.data ?? []); setMoves(m.data ?? []); setChannels(c.data ?? []); setFirstEmail(f.data?.[0]?.occurred_at ?? null);
    });
  }, []);

  const steps = useMemo(() => funnel(accounts), [accounts]);
  const pace = useMemo(() => sendPace(touches, new Date(), firstEmail), [touches, firstEmail]);
  const tests = useMemo(() => experiments(touches), [touches]);
  const pipelineIds = useMemo(() => new Set(accounts.map(a => a.id)), [accounts]);
  const wl = useMemo(() => winLoss(inquiries.filter(q => q.customer_id && pipelineIds.has(q.customer_id))), [inquiries, pipelineIds]);
  const sources = useMemo(() => breakdown(accounts, a => a.source?.replace(/, imported .*$/, '')), [accounts]);
  const types = useMemo(() => breakdown(accounts, a => a.customer_type ?? a.persona), [accounts]);
  const moved = useMemo(() => breakdown(moves, m => SALES_STAGE_LABELS[(m.to_stage ?? '') as SalesStage] ?? m.to_stage), [moves]);
  const max = Math.max(1, ...steps.map(s => s.reached));
  const exits = SALES_EXITS.map(s => ({ s, n: accounts.filter(a => a.sales_stage === s).length }));
  const chName = (k: string) => (k ? channels.find(c => String(c.id) === k)?.name ?? k : 'No channel tagged');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">This week's sends against target</h3>
            <Pace label="LinkedIn (your seat)" week={pace.linkedin.week} due={pace.linkedin.dueSoFar} target={pace.linkedin.weekTarget} today={pace.linkedin.today} daily={pace.linkedin.dailyTarget} warn={pace.linkedin.overCap ? `Over the ${SEND_TARGETS.linkedinWeeklyCap} a week cap` : null} />
            <Pace label="Email" week={pace.email.week} due={pace.email.dueSoFar} target={pace.email.weekTarget} today={pace.email.today} daily={pace.email.dailyTarget} warn={null} note="Ramp 8, 12, 16, then 20 a day while bounces stay under 2%." />
            <div className="text-xs text-muted-foreground">Replies this week: <span className="text-foreground font-medium">{pace.repliesThisWeek}</span>{pace.other ? ` · other outbound: ${pace.other}` : ''}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Funnel (accounts that reached each stage)</h3>
            {steps.map(s => (
              <div key={s.stage} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 text-xs">{SALES_STAGE_LABELS[s.stage]}</span>
                <div className="flex-1 h-5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary/70" style={{ width: `${(s.reached / max) * 100}%` }} /></div>
                <span className="w-10 text-right tabular-nums text-xs">{s.reached}</span>
                <span className="w-12 text-right tabular-nums text-[11px] text-muted-foreground">{s.rate == null ? '' : pct(s.rate)}</span>
              </div>
            ))}
            <div className="text-[11px] text-muted-foreground">Exits: {exits.map(e => `${SALES_STAGE_LABELS[e.s]} ${e.n}`).join(' · ')}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Message A/B tests (reply within 30 days of the send)</h3>
          {tests.length === 0
            ? <p className="text-sm text-muted-foreground">No tagged sends yet. Every outbound message the outreach job logs carries a test name and a variant; results show here, and a winner needs {MIN_SENDS_PER_VARIANT} sends on each side and a reply rate at least 1.5 times the other.</p>
            : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-muted-foreground"><th className="font-medium">Test</th><th className="font-medium">Variant</th><th className="font-medium text-right">Sends</th><th className="font-medium text-right">Replied</th><th className="font-medium text-right">Reply rate</th></tr></thead>
                <tbody>{tests.map(t => (
                  <tr key={t.test + t.variant} className="border-t">
                    <td>{t.test}</td>
                    <td>{t.variant} {t.winner && <Trophy className="inline h-3.5 w-3.5 text-warning" />}</td>
                    <td className="text-right tabular-nums">{t.sends}{!t.enough && <span className="text-[10px] text-muted-foreground"> /{MIN_SENDS_PER_VARIANT}</span>}</td>
                    <td className="text-right tabular-nums">{t.replied}</td>
                    <td className="text-right tabular-nums">{pct(t.rate)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ListCard title="Where accounts come from" rows={sources} />
        <ListCard title="Account type or persona" rows={types} />
        <ListCard title="Stage moves in the last 7 days" rows={moved} empty="No moves this week." />
      </div>

      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-auto">Inquiries from the pipeline</h3>
            <span className="text-xs">Open <b>{wl.open}</b> · Won <b className="text-success">{wl.won}</b> · Lost <b>{wl.lost}</b> · Win rate <b>{pct(wl.winRate)}</b></span>
          </div>
          {wl.byChannel.size === 0
            ? <p className="text-sm text-muted-foreground">No inquiries from pipeline accounts yet. Start one from an account's Sales tab and it lands here, tagged to its channel.</p>
            : [...wl.byChannel.entries()].map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-sm border-t pt-1">
                <span className="flex-1">{chName(k)}</span>
                <span className="text-xs tabular-nums">{v.open} open · {v.won} won · {v.lost} lost</span>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Pace({ label, week, due, target, today, daily, warn, note }: { label: string; week: number; due: number; target: number; today: number; daily: number; warn: string | null; note?: string }) {
  const behind = week < due;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium mr-auto">{label}</span>
        <span className={cn('tabular-nums', behind && 'text-warning')}>{week} / {target}</span>
        <span className="text-[11px] text-muted-foreground">today {today}/{daily}</span>
      </div>
      <Progress value={Math.min(100, (week / Math.max(1, target)) * 100)} className="h-2" />
      <div className="text-[11px] text-muted-foreground">{behind ? `${due - week} behind pace for today` : 'On pace'}{warn ? ` · ${warn}` : ''}{note ? ` · ${note}` : ''}</div>
    </div>
  );
}

function ListCard({ title, rows, empty }: { title: string; rows: { label: string; n: number }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <Card><CardContent className="pt-4 space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{empty ?? 'Nothing yet.'}</p>}
      {rows.map(r => (
        <div key={r.label} className="text-xs">
          <div className="flex justify-between gap-2"><span className="truncate">{r.label}</span><span className="tabular-nums">{r.n}</span></div>
          <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary/60" style={{ width: `${(r.n / max) * 100}%` }} /></div>
        </div>
      ))}
    </CardContent></Card>
  );
}
