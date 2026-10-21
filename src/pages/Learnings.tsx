import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lightbulb, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { LEARNING_STATUSES } from '@/lib/notes';
import { LearningDialog, type Learning } from '@/components/notes/LearningDialog';

export default function Learnings() {
  useDocumentTitle('Learnings');
  const [rows, setRows] = useState<Learning[]>([]);
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Learning | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('learnings').select('*').order('created_at', { ascending: false });
    setRows(data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => rows.filter(r =>
    (status === 'all' || (status === 'open' ? !['Done', 'Cancelled'].includes(r.status) : r.status === status)) &&
    (!q || [r.title, r.notes, r.so_number, r.so_label].some(v => v?.toLowerCase().includes(q.toLowerCase())))), [rows, status, q]);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="page-title flex items-center gap-2 flex-1"><Lightbulb className="h-5 w-5 text-muted-foreground" /> Learnings</h1>
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />New learning</Button>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} className="h-9 max-w-xs" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem><SelectItem value="all">All</SelectItem>
              {LEARNING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="divide-y border rounded-md bg-card">
          {shown.length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">No learnings yet.</div>}
          {shown.map(r => (
            <button key={r.id} type="button" onClick={() => { setEditing(r); setOpen(true); }} className="w-full text-left p-3 flex gap-3 hover:bg-muted/50">
              {r.photo_urls[0] ? <img src={r.photo_urls[0]} alt="" className="h-12 w-12 rounded object-cover border shrink-0" /> : <div className="h-12 w-12 rounded bg-muted flex items-center justify-center shrink-0"><Lightbulb className="h-5 w-5 text-muted-foreground" /></div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="font-medium text-sm truncate">{r.title}</span><Badge variant="outline">{r.status}</Badge></div>
                {r.notes && <p className="text-xs text-muted-foreground line-clamp-2">{r.notes}</p>}
                <div className="text-xs text-muted-foreground mt-0.5">{new Date(r.created_at).toLocaleDateString()}{r.so_number && ` · ${r.so_number}${r.so_label ? ` — ${r.so_label}` : ''}`}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <LearningDialog open={open} onOpenChange={setOpen} learning={editing} onSaved={load} />
    </AppLayout>
  );
}
