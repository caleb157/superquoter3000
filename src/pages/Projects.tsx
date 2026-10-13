import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ProjectDialog } from '@/components/ProjectDialog';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { usePersistentState, useScrollRestoration } from '@/hooks/use-persistent-state';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { statusToneClass } from '@/lib/status-tone';
import { formatDay } from '@/lib/date-only';
import { localDateStr } from '@/lib/task-helpers';
import { PROJECT } from '@/lib/task-association';
import { isOpenProject, isProjectOverdue, projectStatusMeta, sortProjects, PROJECT_STATUSES, type Project, type ProjectStatus } from '@/lib/projects';

type View = 'open' | ProjectStatus | 'all';

export default function Projects() {
  useDocumentTitle('Projects');
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskCounts, setTaskCounts] = useState<Map<string, { open: number; total: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = usePersistentState<View>('projects.view', 'open');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reload, setReload] = useState(0);
  useScrollRestoration('projects.scroll', !loading);
  useKeyboardShortcuts({ onNewItem: () => setDialogOpen(true) });

  useEffect(() => {
    let cancel = false;
    (async () => {
      const db = supabase as any;
      const [pRes, tRes] = await Promise.all([
        db.from('projects').select('*'),
        supabase.from('tasks').select('association_id, status').eq('association_type', PROJECT),
      ]);
      if (cancel) return;
      if (pRes.error) toast.error(pRes.error.message);
      setProjects((pRes.data as Project[]) ?? []);
      const counts = new Map<string, { open: number; total: number }>();
      ((tRes.data as any[]) ?? []).forEach(t => {
        if (!t.association_id) return;
        const c = counts.get(t.association_id) ?? { open: 0, total: 0 };
        c.total += 1;
        if (t.status === 'open') c.open += 1;
        counts.set(t.association_id, c);
      });
      setTaskCounts(counts);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [reload]);

  const today = localDateStr();
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortProjects(projects.filter(p => {
      if (view === 'open' && !isOpenProject(p)) return false;
      if (view !== 'open' && view !== 'all' && p.status !== view) return false;
      if (q && !`${p.name} ${p.notes ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    }));
  }, [projects, view, search]);

  const countFor = (v: View) => v === 'all' ? projects.length
    : v === 'open' ? projects.filter(isOpenProject).length
    : projects.filter(p => p.status === v).length;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="page-title">Projects</h1>
          <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New project
          </Button>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={view} onValueChange={v => setView(v as View)}>
                <TabsList className="h-auto flex-wrap">
                  <TabsTrigger value="open" className="text-xs">Open ({countFor('open')})</TabsTrigger>
                  {PROJECT_STATUSES.map(s => (
                    <TabsTrigger key={s.value} value={s.value} className="text-xs">{s.label} ({countFor(s.value)})</TabsTrigger>
                  ))}
                  <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects…" className="pl-8 h-9 text-sm" />
              </div>
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : visible.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {projects.length === 0 ? 'No projects yet. Start one with New project.' : 'No projects match.'}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-28 hidden sm:table-cell">Start</TableHead>
                    <TableHead className="w-28">End</TableHead>
                    <TableHead className="w-24 text-right">Open tasks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map(p => {
                    const meta = projectStatusMeta(p.status);
                    const c = taskCounts.get(p.id);
                    const overdue = isProjectOverdue(p, today);
                    return (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/projects/${p.id}`)}>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          {p.notes && <div className="text-xs text-muted-foreground line-clamp-1">{p.notes}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[11px]', statusToneClass(meta.tone))}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{p.start_date ? formatDay(p.start_date) : '—'}</TableCell>
                        <TableCell className={cn('text-sm', overdue && 'text-destructive font-medium')} title={overdue ? 'Past its end date' : undefined}>
                          {p.end_date ? formatDay(p.end_date) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {c ? <>{c.open}<span className="text-muted-foreground"> / {c.total}</span></> : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <ProjectDialog
          open={dialogOpen} onOpenChange={setDialogOpen}
          onSaved={p => { setReload(k => k + 1); navigate(`/projects/${p.id}`); }}
        />
      </div>
    </AppLayout>
  );
}
