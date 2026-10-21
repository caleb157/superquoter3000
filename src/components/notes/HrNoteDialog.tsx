import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { EmployeePicker } from './EmployeePicker';
import { HR_STATUSES } from '@/lib/notes';
import type { Tables } from '@/integrations/supabase/types';

export type HrNote = Tables<'hr_notes'>;

export function HrNoteDialog({ open, onOpenChange, note, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; note?: HrNote | null; onSaved?: () => void;
}) {
  const [empId, setEmpId] = useState<number | null>(null);
  const [empName, setEmpName] = useState('');
  const [tag, setTag] = useState('Feedback');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('Active');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmpId(note?.employee_odoo_id ?? null); setEmpName(note?.employee_name ?? '');
    setTag(note?.tag ?? 'Feedback'); setTitle(note?.title ?? ''); setNotes(note?.notes ?? ''); setStatus(note?.status ?? 'Active'); setNewTag('');
    supabase.from('hr_note_tags').select('name').order('created_at').then(({ data }) => setTags((data ?? []).map(t => t.name)));
  }, [open, note]);

  const addTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    if (!tags.includes(name)) {
      const { error } = await supabase.from('hr_note_tags').insert({ name });
      if (error) { toast.error(error.message); return; }
      setTags(t => [...t, name]);
    }
    setTag(name); setNewTag('');
  };

  const save = async () => {
    if (!empName) { toast.error('Pick an employee'); return; }
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    const row = { employee_odoo_id: empId, employee_name: empName, tag, title: title.trim(), notes: notes.trim() || null, status };
    const { error } = note ? await supabase.from('hr_notes').update(row).eq('id', note.id) : await supabase.from('hr_notes').insert(row);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(note ? 'HR note updated' : 'HR note saved');
    onSaved?.(); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="h-4 w-4" />{note ? 'Edit HR note' : 'New HR note'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Employee</Label><EmployeePicker value={empName} onPick={e => { setEmpId(e.id); setEmpName(e.name); }} /></div>
          <div>
            <Label>Tag</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {tags.map(t => (
                <Badge key={t} variant={t === tag ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setTag(t)}>{t}</Badge>
              ))}
            </div>
            <div className="flex gap-1 mt-2">
              <Input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Add a tag" className="h-8"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addTag(); } }} />
              <Button type="button" variant="outline" size="sm" onClick={addTag} disabled={!newTag.trim()}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>
          <div><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} /></div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{HR_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
