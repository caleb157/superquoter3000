import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '@/lib/projects';
import { PROJECT } from '@/lib/task-association';
import { localDateStr } from '@/lib/task-helpers';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this project; omit to create a new one. */
  project?: Project | null;
  onSaved?: (p: Project) => void;
};

export function ProjectDialog({ open, onOpenChange, project, onSaved }: Props) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('in_progress');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setStatus(project?.status ?? 'in_progress');
    setStartDate(project ? project.start_date ?? '' : localDateStr());
    setEndDate(project?.end_date ?? '');
    setNotes(project?.notes ?? '');
  }, [open, project]);

  const save = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (startDate && endDate && endDate < startDate) { toast.error('End date is before the start date'); return; }
    setSaving(true);
    const payload = {
      name: name.trim(), status,
      start_date: startDate || null, end_date: endDate || null,
      notes: notes.trim() || null,
    };
    const db = supabase as any;
    const { data, error } = project
      ? await db.from('projects').update(payload).eq('id', project.id).select('*').single()
      : await db.from('projects').insert(payload).select('*').single();
    if (!error && project && project.name !== payload.name) {
      // Linked tasks show the project's name from their association label.
      await db.from('tasks').update({ association_label: payload.name })
        .eq('association_type', PROJECT).eq('association_id', project.id);
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(project ? 'Project updated' : 'Project created');
    onSaved?.(data as Project);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md mx-2 sm:mx-auto">
        <DialogHeader>
          <DialogTitle>{project ? 'Edit project' : 'New project'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-9" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={v => setStatus(v as ProjectStatus)}>
              <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">End date</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1 h-9 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 text-sm" rows={4} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
