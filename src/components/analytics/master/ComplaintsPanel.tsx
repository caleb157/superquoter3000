import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink, Plus } from 'lucide-react';
import { toast } from 'sonner';

type Complaint = {
  id: string; date_logged: string; customer_id: string | null; customer_name_manual: string | null;
  issue_summary: string; potential_resolution: string | null; google_drive_url: string | null;
  status: 'open' | 'resolved'; date_closed: string | null; actions_captured: boolean; notes: string | null;
};
const empty = { date_logged: new Date().toISOString().slice(0, 10), customer_id: '', customer_name_manual: '', issue_summary: '', potential_resolution: '', google_drive_url: '', notes: '' };

export function useComplaints() {
  const [rows, setRows] = useState<Complaint[]>([]);
  const load = async () => {
    const { data } = await (supabase as any).from('customer_complaints').select('*').order('date_logged', { ascending: false });
    setRows(data || []);
  };
  useEffect(() => { load(); }, []);
  return { rows, reload: load };
}

export function ComplaintsPanel({ rows, reload, from, to }: { rows: Complaint[]; reload: () => void; from: Date; to: Date }) {
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Complaint | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { supabase.from('customers').select('id, name').order('name').then(({ data }) => setCustomers(data || [])); }, []);
  const custName = (c: Complaint) => customers.find(x => x.id === c.customer_id)?.name ?? c.customer_name_manual ?? '—';
  const inWin = (d: string) => { const t = new Date(d + 'T12:00:00').getTime(); return t >= from.getTime() && t <= to.getTime(); };
  const visible = useMemo(() => rows.filter(r => showAll || r.status === 'open' || inWin(r.date_logged)), [rows, showAll, from, to]);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (c: Complaint) => { setEditing(c); setForm({ ...empty, ...c, customer_id: c.customer_id ?? '', customer_name_manual: c.customer_name_manual ?? '' }); setOpen(true); };
  const save = async () => {
    if (!form.issue_summary.trim()) return toast.error('Describe the issue');
    const row = {
      date_logged: form.date_logged, customer_id: form.customer_id || null, customer_name_manual: form.customer_id ? null : form.customer_name_manual || null,
      issue_summary: form.issue_summary, potential_resolution: form.potential_resolution || null, google_drive_url: form.google_drive_url || null, notes: form.notes || null,
    };
    const q = editing ? (supabase as any).from('customer_complaints').update(row).eq('id', editing.id) : (supabase as any).from('customer_complaints').insert(row);
    const { error } = await q;
    if (error) return toast.error(error.message);
    setOpen(false); reload();
  };
  const patch = async (id: string, p: Partial<Complaint>) => {
    const { error } = await (supabase as any).from('customer_complaints').update(p).eq('id', id);
    if (error) toast.error(error.message); else reload();
  };
  const remove = async () => {
    if (!editing || !confirm('Delete this complaint?')) return;
    await (supabase as any).from('customer_complaints').delete().eq('id', editing.id);
    setOpen(false); reload();
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">Customer complaints</CardTitle>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={showAll} onCheckedChange={v => setShowAll(!!v)} /> Show all
          </label>
          <Button size="sm" className="h-8" onClick={startNew}><Plus className="h-3.5 w-3.5 mr-1" />Log complaint</Button>
        </div>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No complaints in this period.</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Issue</TableHead><TableHead>Resolution</TableHead>
                <TableHead>Photos</TableHead><TableHead>Status</TableHead><TableHead>Closed</TableHead><TableHead className="text-center">Actions captured</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {visible.map(c => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => startEdit(c)}>
                    <TableCell className="whitespace-nowrap tabular-nums">{c.date_logged}</TableCell>
                    <TableCell>{custName(c)}</TableCell>
                    <TableCell className="max-w-[260px] truncate" title={c.issue_summary}>{c.issue_summary}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">{c.potential_resolution || '—'}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      {c.google_drive_url ? <a href={c.google_drive_url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">Drive <ExternalLink className="h-3 w-3" /></a> : '—'}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Badge variant={c.status === 'open' ? 'destructive' : 'secondary'} className="cursor-pointer"
                        onClick={() => patch(c.id, c.status === 'open' ? { status: 'resolved', date_closed: new Date().toISOString().slice(0, 10) } : { status: 'open', date_closed: null })}>
                        {c.status === 'open' ? 'Open' : 'Resolved'}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">{c.date_closed || '—'}</TableCell>
                    <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                      <Checkbox checked={c.actions_captured} onCheckedChange={v => patch(c.id, { actions_captured: !!v })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
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
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
