// Sales tab on the account (customer) page: brief, stage, do not contact, contacts and the message timeline.
import { useEffect, useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Linkedin, Mail, MessageCircle, Phone, Users, Ban, ExternalLink, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { SalesStageBadge } from './SalesStageBadge';
import {
  ALL_SALES_STAGES, BRIEF_PARTS, BRIEF_PART_LABELS, SALES_STAGE_LABELS, isBriefStale, type Brief, type SalesStage,
} from '@/lib/sales/sales-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

type Account = {
  id: string; name: string; company: string | null; sales_stage: string | null; not_now_until: string | null;
  persona: string | null; customer_type: string | null; fit_score: number | null; owner: string | null; country: string | null; domain: string | null;
  next_step: string | null; next_step_date: string | null; brief: Brief | null; brief_updated_at: string | null;
  dnc: boolean; dnc_reason: string | null; dnc_at: string | null;
};
type Contact = {
  id: string; full_name: string; title: string | null; email: string | null; linkedin_url: string | null; whatsapp: string | null;
  engaged: boolean; dnc: boolean; never_email: boolean; drip_enrolled: boolean; drip_track: string | null; linkedin_account: string | null;
};
type Touch = { id: string; contact_id: string | null; channel: string; direction: 'in' | 'out'; occurred_at: string; subject: string | null; body: string | null; auto_sent: boolean; is_drip: boolean; drip_issue: string | null; sender_account: string | null };
type StageEvent = { id: string; from_stage: string | null; to_stage: string | null; actor: string | null; reason: string | null; occurred_at: string };

export const CHANNEL_ICON: Record<string, typeof Mail> = { linkedin: Linkedin, email: Mail, whatsapp: MessageCircle, call: Phone, meeting: Users, other: MessageCircle };

export function SalesAccountPanel({ customerId }: { customerId: string }) {
  const { isAdmin } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [touches, setTouches] = useState<Touch[]>([]);
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [dncReason, setDncReason] = useState('');
  const [missing, setMissing] = useState(false);

  const load = async () => {
    const [a, c, t, e] = await Promise.all([
      db.from('customers').select('id, name, company, sales_stage, not_now_until, persona, customer_type, fit_score, owner, country, domain, next_step, next_step_date, brief, brief_updated_at, dnc, dnc_reason, dnc_at').eq('id', customerId).maybeSingle(),
      db.from('contacts').select('id, full_name, title, email, linkedin_url, whatsapp, engaged, dnc, never_email, drip_enrolled, drip_track, linkedin_account').eq('customer_id', customerId).order('full_name'),
      db.from('sales_touches').select('id, contact_id, channel, direction, occurred_at, subject, body, auto_sent, is_drip, drip_issue, sender_account').eq('customer_id', customerId).order('occurred_at', { ascending: false }).limit(200),
      db.from('sales_stage_events').select('id, from_stage, to_stage, actor, reason, occurred_at').eq('customer_id', customerId).order('occurred_at', { ascending: false }).limit(50),
    ]);
    // Before the Sales migration is applied the columns are missing; show a note instead of failing.
    if (a.error) { setMissing(true); return; }
    setAccount(a.data); setContacts(c.data ?? []); setTouches(t.data ?? []); setEvents(e.data ?? []);
  };
  useEffect(() => { void load(); }, [customerId]);

  if (missing) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">The Sales tables are not in the database yet. They arrive when this release's migration is applied.</CardContent></Card>;
  if (!account) return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;

  const save = async (patch: Record<string, unknown>, done = 'Saved') => {
    const { error } = await db.from('customers').update(patch).eq('id', account.id);
    if (error) { toast.error(error.message); return; }
    toast.success(done);
    void load();
  };

  const moveStage = (stage: string) => {
    if (stage === 'not_now') {
      const until = new Date(Date.now() + 182 * 86_400_000).toISOString().slice(0, 10);
      return save({ sales_stage: 'not_now', not_now_until: until }, `Not now until ${until}`);
    }
    return save({ sales_stage: stage, not_now_until: null }, `Moved to ${SALES_STAGE_LABELS[stage as SalesStage]}`);
  };

  const contactName = (id: string | null) => contacts.find(c => c.id === id)?.full_name;
  const brief = account.brief ?? {};
  const stale = isBriefStale(account.brief_updated_at);

  return (
    <div className="space-y-4">
      {account.dnc && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 flex flex-wrap items-center gap-2 text-sm">
            <Ban className="h-4 w-4 text-destructive" />
            <span className="font-medium text-destructive">Do not contact</span>
            <span className="text-muted-foreground">{account.dnc_reason ?? ''}{account.dnc_at ? ` · ${format(new Date(account.dnc_at), 'd MMM yyyy')}` : ''}</span>
            <span className="text-muted-foreground">Every sender skips this account and its people.</span>
            {isAdmin && <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => save({ dnc: false, sales_stage: 'not_a_fit' }, 'Do not contact cleared')}>Clear</Button>}
          </CardContent>
        </Card>
      )}

      {/* Stage and sales fields */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-auto">Sales stage</h3>
            <SalesStageBadge stage={account.sales_stage} />
            {account.sales_stage === 'not_now' && account.not_now_until && <span className="text-xs text-muted-foreground">until {format(new Date(account.not_now_until), 'd MMM yyyy')}</span>}
            {!account.dnc && (
              <Select value={account.sales_stage ?? ''} onValueChange={moveStage}>
                <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Add to pipeline" /></SelectTrigger>
                <SelectContent>
                  {ALL_SALES_STAGES.filter(s => s !== 'dnc').map(s => <SelectItem key={s} value={s}>{SALES_STAGE_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Field label="Persona" value={account.persona} />
            <Field label="Type" value={account.customer_type} />
            <Field label="Fit score" value={account.fit_score != null ? String(account.fit_score) : null} />
            <Field label="Owner" value={account.owner} />
            <Field label="Country" value={account.country} />
            <Field label="Domain" value={account.domain} />
            <Field label="Next step" value={account.next_step} />
            <Field label="Next step date" value={account.next_step_date ? format(new Date(account.next_step_date), 'd MMM yyyy') : null} />
          </div>
          {!account.dnc && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input className="h-8 max-w-xs text-xs" placeholder="Reason, e.g. asked to be removed on LinkedIn" value={dncReason} onChange={e => setDncReason(e.target.value)} />
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive" disabled={!dncReason.trim()}
                onClick={() => save({ dnc: true, dnc_reason: dncReason.trim(), dnc_source: 'pd-hq' }, 'Do not contact set for the account and all its people')}>
                <Ban className="h-3.5 w-3.5" /> Do not contact
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Brief */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-auto">Brief</h3>
            {account.brief_updated_at
              ? <span className={cn('text-xs', stale ? 'text-warning' : 'text-muted-foreground')}>Updated {formatDistanceToNow(new Date(account.brief_updated_at), { addSuffix: true })}{stale ? ' · due a refresh' : ''}</span>
              : <span className="text-xs text-muted-foreground">Not written yet. The watchdog writes it when the account is queued or replies.</span>}
          </div>
          {Object.keys(brief).length > 0 && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {BRIEF_PARTS.filter(p => brief[p]).map(p => (
                <div key={p} className="text-sm">
                  <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    {BRIEF_PART_LABELS[p]}
                    {brief[p]?.source && /^https?:/.test(brief[p]!.source!) && <a href={brief[p]!.source!} target="_blank" rel="noreferrer" title="Source"><ExternalLink className="h-3 w-3" /></a>}
                  </dt>
                  <dd className="whitespace-pre-line">{brief[p]!.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Contacts */}
      <Card>
        <CardContent className="pt-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">People ({contacts.length})</h3>
          {contacts.length === 0 && <p className="text-sm text-muted-foreground">No people yet.</p>}
          {contacts.map(c => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm border-t first:border-t-0 pt-2 first:pt-0">
              <span className={cn('font-medium', c.dnc && 'line-through text-muted-foreground')}>{c.full_name}</span>
              {c.title && <span className="text-xs text-muted-foreground">{c.title}</span>}
              <div className="flex gap-1 ml-auto flex-wrap">
                {c.engaged && <Badge variant="secondary" className="text-[10px] bg-success/15 text-success">Engaged</Badge>}
                {c.drip_enrolled && <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">Drip{c.drip_track ? `: ${c.drip_track}` : ''}</Badge>}
                {c.never_email && !c.dnc && <Badge variant="secondary" className="text-[10px]">Never email</Badge>}
                {c.dnc && <Badge variant="secondary" className="text-[10px] bg-destructive/15 text-destructive">Do not contact</Badge>}
                {c.linkedin_account && <Badge variant="outline" className="text-[10px]">{c.linkedin_account}</Badge>}
                {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" title="LinkedIn"><Linkedin className="h-4 w-4 text-muted-foreground" /></a>}
                {c.email && <a href={`mailto:${c.email}`} title={c.email}><Mail className="h-4 w-4 text-muted-foreground" /></a>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Timeline: messages and stage moves together */}
      <Card>
        <CardContent className="pt-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversation and drip log</h3>
          {touches.length === 0 && events.length === 0 && <p className="text-sm text-muted-foreground">No messages logged yet.</p>}
          <ol className="space-y-2">
            {[
              ...touches.map(t => ({ at: t.occurred_at, kind: 'touch' as const, t })),
              ...events.map(e => ({ at: e.occurred_at, kind: 'stage' as const, e })),
            ].sort((a, b) => b.at.localeCompare(a.at)).map(item => item.kind === 'touch' ? (
              <li key={item.t.id} className={cn('rounded-md border p-2 text-sm', item.t.direction === 'in' ? 'bg-muted/40' : '')}>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {(() => { const I = CHANNEL_ICON[item.t.channel] ?? MessageCircle; return <I className="h-3.5 w-3.5" />; })()}
                  {item.t.direction === 'in' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                  <span className="font-medium text-foreground">{item.t.direction === 'in' ? (contactName(item.t.contact_id) ?? 'Them') : (item.t.sender_account ?? 'Us')}</span>
                  {item.t.direction === 'out' && contactName(item.t.contact_id) && <span>to {contactName(item.t.contact_id)}</span>}
                  {item.t.is_drip && <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">Drip{item.t.drip_issue ? `: ${item.t.drip_issue}` : ''}</Badge>}
                  {item.t.auto_sent && <Badge variant="outline" className="text-[10px]">Auto-sent</Badge>}
                  <span className="ml-auto">{format(new Date(item.t.occurred_at), 'd MMM yyyy, HH:mm')}</span>
                </div>
                {item.t.subject && <div className="font-medium mt-1">{item.t.subject}</div>}
                {item.t.body && <p className="mt-1 whitespace-pre-line line-clamp-6">{item.t.body}</p>}
              </li>
            ) : (
              <li key={item.e.id} className="text-xs text-muted-foreground pl-2">
                {format(new Date(item.e.occurred_at), 'd MMM yyyy')}: {item.e.from_stage ? `${SALES_STAGE_LABELS[item.e.from_stage as SalesStage] ?? item.e.from_stage} → ` : ''}<span className="font-medium text-foreground">{SALES_STAGE_LABELS[item.e.to_stage as SalesStage] ?? item.e.to_stage}</span>
                {item.e.reason ? ` · ${item.e.reason}` : ''}{item.e.actor ? ` · ${item.e.actor}` : ''}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm truncate">{value || '—'}</div>
    </div>
  );
}
