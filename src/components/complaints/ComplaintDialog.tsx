import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

export type Complaint = {
  id: string; date_logged: string; customer_id: string | null; customer_name_manual: string | null;
  issue_summary: string; potential_resolution: string | null; google_drive_url: string | null;
  status: 'open' | 'resolved'; date_closed: string | null; actions_captured: boolean; notes: string | null;
};

const empty = () => ({ date_logged: new Date().toISOString().slice(0, 10), customer_id: '', customer_name_manual: '', issue_summary: '', potential_resolution: '', google_drive_url: '', notes: '' });

export function useComplaints() {
  const [rows, setRows] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const { data } = await (supabase as any).from('customer_complaints').select('*').order('date_logged', { ascending: false });
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  return { rows, loading, reload: load };
}

export async function patchComplaint(id: string, p: Partial<Complaint>) {
  const { error } = await (supabase as any).from('customer_complaints').update(p).eq('id', id);
  if (error) toast.error(error.message);
  return !error;
}

/** Log a new complaint (editing = null) or edit / delete an existing one. */
export function ComplaintDialog({ open, onOpenChange, editing, customers, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: Complaint | null;
  customers: { id: string; name: string }[]; onSaved: () => void;
}) {
  const [form, setForm] = useState<any>(empty());
  useEffect(() => {
    if (!open) return;
    setForm(editing ? { ...empty(), ...editing, customer_id: editing.customer_id ?? '', customer_name_manual: editing.customer_name_manual ?? '', potential_resolution: editing.potential_resolution ?? '', google_drive_url: editing.google_drive_url ?? '', notes: editing.notes ?? '' } : empty());
  }, [open, editing]);

  const save = async () => {
    if (!form.issue_summary.trim()) return toast.error('Describe the issue');
    const row = {
      date_logged: form.date_logged, customer_id: form.customer_id || null, customer_name_manual: form.customer_id ? null : form.customer_name_manual || null,
      issue_summary: form.issue_summary, potential_resolution: form.potential_resolution || null, google_drive_url: form.google_drive_url || null, notes: form.notes || null,
    };
    const q = editing ? (supabase as any).from('customer_complaints').update(row).eq('id', editing.id) : (supabase as any).from('customer_complaints').insert(row);
    const { error } = await q;
    if (error) return toast.error(error.message);
    onOpenChange(false); onSaved();
  };
  const remove = async () => {
    if (!editing || !confirm('Delete this complaint?')) return;
    const { error } = await (supabase as any).from('customer_complaints').delete().eq('id', editing.id);
    if (error) return toast.error(error.message);
    onOpenChange(false); onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? 'Edit complaint' : 'Log complaint'}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Date</Label><Input type="date" value={form.date_logged} onChange={e => setForm({ ...form, date_logged: e.target.value })} /></div>
            <div><Label>Customer</Label>
              <Select value={form.customer_id || '__manual'} onValueChange={v => setForm({ ...form, customer_id: v === '__manual' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__manual">Other (type name)</SelectItem>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {!form.customer_id && <div><Label>Customer name</Label><Input value={form.customer_name_manual} onChange={e => setForm({ ...form, customer_name_manual: e.target.value })} /></div>}
          <div><Label>Issue</Label><Textarea rows={3} value={form.issue_summary} onChange={e => setForm({ ...form, issue_summary: e.target.value })} /></div>
          <div><Label>Potential resolution</Label><Textarea rows={2} value={form.potential_resolution} onChange={e => setForm({ ...form, potential_resolution: e.target.value })} /></div>
          <div><Label>Google Drive link (photos)</Label><Input type="url" placeholder="https://drive.google.com/…" value={form.google_drive_url} onChange={e => setForm({ ...form, google_drive_url: e.target.value })} /></div>
          <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter className="gap-2">
          {editing && <Button variant="ghost" className="text-destructive mr-auto" onClick={remove}>Delete</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
