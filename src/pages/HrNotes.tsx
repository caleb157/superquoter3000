import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { HR_STATUSES } from '@/lib/notes';
import { HrNoteDialog, type HrNote } from '@/components/notes/HrNoteDialog';

export default function HrNotes() {
  useDocumentTitle('HR Notes');
  const [rows, setRows] = useState<HrNote[]>([]);
  const [status, setStatus] = useState('Active');
  const [tag, setTag] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<HrNote | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('hr_notes').select('*').order('created_at', { ascending: false });
    setRows(data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const tags = useMemo(() => [...new Set(rows.map(r => r.tag))].sort(), [rows]);
  const shown = useMemo(() => rows.filter(r =>
    (status === 'all' || r.status === status) && (tag === 'all' || r.tag === tag) &&
    (!q || [r.employee_name, r.title, r.notes].some(v => v?.toLowerCase().includes(q.toLowerCase())))), [rows, status, tag, q]);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="page-title flex items-center gap-2 flex-1"><Users className="h-5 w-5 text-muted-foreground" /> HR Notes</h1>
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />New HR note</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Search employee or note…" value={q} onChange={e => setQ(e.target.value)} className="h-9 max-w-xs" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{HR_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All tags</SelectItem>{tags.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="divide-y border rounded-md bg-card">
          {shown.length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">No HR notes.</div>}
          {shown.map(r => (
            <button key={r.id} type="button" onClick={() => { setEditing(r); setOpen(true); }} className="w-full text-left p-3 hover:bg-muted/50">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{r.employee_name}</span>
                <Badge variant="secondary">{r.tag}</Badge><Badge variant="outline">{r.status}</Badge>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
              <div className="text-sm mt-0.5">{r.title}</div>
              {r.notes && <p className="text-xs text-muted-foreground line-clamp-2">{r.notes}</p>}
            </button>
          ))}
        </div>
      </div>
      <HrNoteDialog open={open} onOpenChange={setOpen} note={editing} onSaved={load} />
    </AppLayout>
  );
}
