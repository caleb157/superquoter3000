// Quick actions on a sales account, used on Needs you cards and the account's Sales tab:
// log a message (any channel, in or out), plan a follow-up with a draft, start an inquiry, move the stage.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreateInquiryDialog } from '@/components/CreateInquiryDialog';
import { MessageSquarePlus, CalendarPlus, FilePlus2 } from 'lucide-react';
import { ALL_SALES_STAGES, SALES_STAGE_LABELS, TOUCH_CHANNELS, addDaysYmd, canContact, type SalesStage, type TouchChannel } from '@/lib/sales/sales-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

export type ActionAccount = { id: string; name: string; company: string | null; sales_stage: string | null; dnc: boolean; owner?: string | null; not_now_until?: string | null };
type ContactLite = { id: string; full_name: string; email: string | null; linkedin_url: string | null; whatsapp: string | null; dnc: boolean; never_email: boolean; engaged: boolean };

const CHANNEL_LABEL: Record<TouchChannel, string> = { linkedin: 'LinkedIn', email: 'Email', whatsapp: 'WhatsApp', call: 'Call', meeting: 'Meeting', other: 'Other' };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function useContacts(customerId: string, open: boolean) {
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  useEffect(() => {
    if (!open) return;
    void db.from('contacts').select('id, full_name, email, linkedin_url, whatsapp, dnc, never_email, engaged').eq('customer_id', customerId).order('full_name')
      .then(({ data }: { data: ContactLite[] | null }) => setContacts(data ?? []));
  }, [customerId, open]);
  return contacts;
}

/** Moves the stage; Not now asks for nothing and defaults to about 6 months out. */
export async function moveAccountStage(account: ActionAccount, stage: string, reason?: string) {
  const patch: Record<string, unknown> = { sales_stage: stage };
  if (stage === 'not_now') patch.not_now_until = account.not_now_until && account.not_now_until > addDaysYmd(new Date(), 0) ? account.not_now_until : addDaysYmd(new Date(), 182);
  else patch.not_now_until = null;
  if (reason) patch.next_step = reason;
  const { error } = await db.from('customers').update(patch).eq('id', account.id);
  if (error) { toast.error(error.message); return false; }
  toast.success(stage === 'not_now' ? `Not now until ${patch.not_now_until}` : `Moved to ${SALES_STAGE_LABELS[stage as SalesStage]}`);
  return true;
}

export function AccountActions({ account, onChanged, compact, hideStage }: { account: ActionAccount; onChanged: () => void; compact?: boolean; hideStage?: boolean }) {
  const [log, setLog] = useState(false);
  const [follow, setFollow] = useState(false);
  const [inquiry, setInquiry] = useState(false);
  const navigate = useNavigate();
  if (account.dnc) return null;
  const size = compact ? 'h-7 px-2 text-xs' : 'h-8';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" className={`${size} gap-1`} onClick={() => setLog(true)}><MessageSquarePlus className="h-3.5 w-3.5" /> Log message</Button>
      <Button size="sm" variant="outline" className={`${size} gap-1`} onClick={() => setFollow(true)}><CalendarPlus className="h-3.5 w-3.5" /> Plan follow-up</Button>
      <Button size="sm" variant="outline" className={`${size} gap-1`} onClick={() => setInquiry(true)}><FilePlus2 className="h-3.5 w-3.5" /> Start inquiry</Button>
      {!hideStage && <Select value={account.sales_stage ?? ''} onValueChange={async s => { if (await moveAccountStage(account, s)) onChanged(); }}>
        <SelectTrigger className={`${size} w-36`}><SelectValue placeholder="Stage" /></SelectTrigger>
        <SelectContent>{ALL_SALES_STAGES.filter(s => s !== 'dnc').map(s => <SelectItem key={s} value={s}>{SALES_STAGE_LABELS[s]}</SelectItem>)}</SelectContent>
      </Select>}
      {log && <LogMessageDialog account={account} open={log} onOpenChange={setLog} onSaved={onChanged} />}
      {follow && <FollowUpDialog account={account} open={follow} onOpenChange={setFollow} onSaved={onChanged} />}
      <CreateInquiryDialog open={inquiry} onOpenChange={setInquiry} defaultCustomerId={account.id}
        onCreated={id => { toast.success('Inquiry started. The account moves to Inquiry.'); onChanged(); navigate(`/inquiry/${id}?tab=products`); }} />
    </div>
  );
}

export function LogMessageDialog({ account, open, onOpenChange, onSaved }: { account: ActionAccount; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { user } = useAuth();
  const contacts = useContacts(account.id, open);
  const [contactId, setContactId] = useState<string>('none');
  const [channel, setChannel] = useState<TouchChannel>('linkedin');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [at, setAt] = useState(nowLocal());
  const [body, setBody] = useState('');
  const [engaged, setEngaged] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (contacts.length === 1) setContactId(contacts[0].id); }, [contacts]);

  const save = async () => {
    setBusy(true);
    const contact = contacts.find(c => c.id === contactId) ?? null;
    const row = {
      customer_id: account.id, contact_id: contact?.id ?? null, channel, direction, occurred_at: new Date(at).toISOString(),
      body: body.trim() || null, sender_account: direction === 'out' ? 'Caleb' : null, logged_by: user?.email ?? 'pd-hq',
    };
    const { error } = await db.from('sales_touches').insert(row);
    if (error) { setBusy(false); toast.error(error.message); return; }
    // A reply that says more than thanks makes the person engaged (nudges only go to engaged people).
    if (direction === 'in' && contact && engaged && !contact.engaged) await db.from('contacts').update({ engaged: true }).eq('id', contact.id);
    if (direction === 'in' && ['queued', 'in_outreach', 'not_now'].includes(account.sales_stage ?? '')) await db.from('customers').update({ sales_stage: 'responded', not_now_until: null }).eq('id', account.id);
    else if (direction === 'in' && account.sales_stage === 'responded' && engaged) await db.from('customers').update({ sales_stage: 'in_conversation' }).eq('id', account.id);
    setBusy(false);
    toast.success('Message logged');
    onOpenChange(false); onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Log a message: {account.company || account.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Direction</Label>
            <Select value={direction} onValueChange={v => setDirection(v as 'in' | 'out')}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="in">They wrote to us</SelectItem><SelectItem value="out">We wrote to them</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Channel</Label>
            <Select value={channel} onValueChange={v => setChannel(v as TouchChannel)}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{TOUCH_CHANNELS.map(c => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Person</Label>
            <Select value={contactId} onValueChange={setContactId}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Not one person</SelectItem>{contacts.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">When</Label><Input type="datetime-local" className="h-9" value={at} onChange={e => setAt(e.target.value)} /></div>
        </div>
        <Textarea rows={6} placeholder="Paste the message" value={body} onChange={e => setBody(e.target.value)} />
        {direction === 'in' && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={engaged} onChange={e => setEngaged(e.target.checked)} /> They said more than thanks (engaged: gets nudges)</label>
        )}
        <DialogFooter><Button disabled={busy} onClick={save}>Log it</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FollowUpDialog({ account, open, onOpenChange, onSaved }: { account: ActionAccount; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { assigneeCode } = useAuth();
  const contacts = useContacts(account.id, open);
  const name = account.company || account.name;
  const [contactId, setContactId] = useState<string>('none');
  const [title, setTitle] = useState(`Follow up with ${name}`);
  const [due, setDue] = useState(addDaysYmd(new Date(), 7));
  const [channel, setChannel] = useState<TouchChannel>('linkedin');
  const [draft, setDraft] = useState('');
  const [nudge, setNudge] = useState<string>('none');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (contacts.length === 1) setContactId(contacts[0].id); }, [contacts]);
  const contact = contacts.find(c => c.id === contactId) ?? null;
  const block = draft.trim() ? canContact(contact, account, channel, due) : { allowed: true, reason: null };

  const save = async () => {
    setBusy(true);
    const row = {
      title: title.trim() || `Follow up with ${name}`, status: 'open', priority: nudge === 'none' ? 'high' : 'normal', due_date: due,
      assignee: (account.owner || assigneeCode || 'CQ').toUpperCase(), customer_id: account.id,
      association_type: 'customer', association_id: account.id, association_label: name,
      contact_id: contact?.id ?? null, nudge_step: nudge === 'none' ? null : Number(nudge),
      draft_text: draft.trim() || null, draft_channel: draft.trim() ? channel : null, draft_status: draft.trim() ? 'draft' : null, source_event: 'sales_follow_up',
    };
    const { error } = await db.from('tasks').insert(row);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Follow-up planned for ${due}`);
    onOpenChange(false); onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Plan a follow-up: {name}</DialogTitle></DialogHeader>
        <div className="space-y-1"><Label className="text-xs">Task</Label><Input className="h-9" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Due</Label>
            <Input type="date" className="h-9" value={due} onChange={e => setDue(e.target.value)} />
            <div className="flex gap-1">{[[7, '1 week'], [30, '1 month'], [90, '1 quarter']].map(([d, l]) => <Button key={d} type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setDue(addDaysYmd(new Date(), d as number))}>{l}</Button>)}</div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Nudge</Label>
            <Select value={nudge} onValueChange={setNudge}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Not a nudge (a reply or next step)</SelectItem><SelectItem value="1">Nudge 1 (1 week)</SelectItem><SelectItem value="2">Nudge 2 (1 month)</SelectItem><SelectItem value="3">Nudge 3 (1 quarter)</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Person</Label>
            <Select value={contactId} onValueChange={setContactId}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Not one person</SelectItem>{contacts.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}{c.engaged ? ' (engaged)' : ''}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Send by</Label>
            <Select value={channel} onValueChange={v => setChannel(v as TouchChannel)}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{TOUCH_CHANNELS.map(c => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <Textarea rows={5} placeholder="Draft message (optional). It shows on Needs you for approval on the due date." value={draft} onChange={e => setDraft(e.target.value)} />
        {!block.allowed && <p className="text-xs text-destructive">Can't send this: {block.reason}.</p>}
        <DialogFooter><Button disabled={busy || !block.allowed} onClick={save}>Plan it</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
