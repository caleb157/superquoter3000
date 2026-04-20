import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

type Row = { id: string; received_date: string; notes: string | null; created_at: string };

export function ReceivedRfqList({ inquiryId }: { inquiryId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');

  const load = async () => {
    const { data } = await (supabase as any)
      .from('inquiry_received_rfqs')
      .select('*')
      .eq('inquiry_id', inquiryId)
      .order('received_date', { ascending: false });
    setRows(data ?? []);
  };

  useEffect(() => { load(); }, [inquiryId]);

  const openNew = () => {
    setEditing(null);
    setDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setOpen(true);
  };
  const openEdit = (r: Row) => {
    setEditing(r);
    setDate(r.received_date);
    setNotes(r.notes ?? '');
    setOpen(true);
  };

  const save = async () => {
    if (!date) { toast.error('Date required'); return; }
    if (editing) {
      const { error } = await (supabase as any).from('inquiry_received_rfqs')
        .update({ received_date: date, notes: notes.trim() || null }).eq('id', editing.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await (supabase as any).from('inquiry_received_rfqs')
        .insert({ inquiry_id: inquiryId, received_date: date, notes: notes.trim() || null });
      if (error) { toast.error(error.message); return; }
    }
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    await (supabase as any).from('inquiry_received_rfqs').delete().eq('id', id);
    load();
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Customer RFQs received</CardTitle>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Log received RFQ
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">No RFQs logged yet.</div>
        ) : (
          <ul className="divide-y">
            {rows.map(r => (
              <li key={r.id} className="flex items-center gap-2 py-2 group">
                <span className="text-xs font-medium w-24 shrink-0">
                  {format(new Date(r.received_date + 'T00:00:00'), 'MMM d, yyyy')}
                </span>
                <span className="text-sm flex-1 truncate text-muted-foreground">{r.notes || '—'}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => openEdit(r)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => remove(r.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? 'Edit received RFQ' : 'Log received RFQ'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Date received</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="text-sm mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
