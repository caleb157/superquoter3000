import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ProjectDialog } from '@/components/ProjectDialog';
import { TaskDialog } from '@/components/TaskDialog';
import { TaskList } from '@/components/TaskList';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { statusToneClass } from '@/lib/status-tone';
import { formatDay } from '@/lib/date-only';
import { localDateStr } from '@/lib/task-helpers';
import { PROJECT } from '@/lib/task-association';
import { isProjectOverdue, projectStatusMeta, PROJECT_STATUSES, type Project, type ProjectStatus } from '@/lib/projects';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskStatus, setTaskStatus] = useState<'open' | 'done' | 'all'>('open');
  const [taskRefresh, setTaskRefresh] = useState(0);
  useDocumentTitle(project?.name ?? 'Project');

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    (async () => {
      const { data, error } = await (supabase as any).from('projects').select('*').eq('id', id).maybeSingle();
      if (cancel) return;
      if (error) toast.error(error.message);
      setProject(data as Project | null);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [id]);

  const changeStatus = async (status: ProjectStatus) => {
    if (!project) return;
    const prev = project;
    setProject({ ...project, status });
    const { error } = await (supabase as any).from('projects').update({ status }).eq('id', project.id);
    if (error) { setProject(prev); toast.error(error.message); return; }
    toast.success(`Marked ${projectStatusMeta(status).label.toLowerCase()}`);
  };

  if (loading) return <AppLayout><div className="py-12 text-center text-muted-foreground">Loading…</div></AppLayout>;
  if (!project) return <AppLayout><div className="py-12 text-center text-muted-foreground">Project not found.</div></AppLayout>;

  const meta = projectStatusMeta(project.status);
  const overdue = isProjectOverdue(project, localDateStr());

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <PageBreadcrumbs canonical={[{ label: 'Projects', to: '/projects' }]} current={project.name} />

        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-xl font-serif font-medium tracking-tight">{project.name}</h1>
          <div className="flex items-center gap-2">
            <Select value={project.status} onValueChange={v => void changeStatus(v as ProjectStatus)}>
              <SelectTrigger className={cn('h-8 w-36 text-xs border', statusToneClass(meta.tone))}><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm max-w-sm">
              <div>
                <div className="text-xs text-muted-foreground">Start</div>
                <div>{project.start_date ? formatDay(project.start_date) : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">End</div>
                <div className={cn(overdue && 'text-red-600 font-medium')}>
                  {project.end_date ? formatDay(project.end_date) : '—'}{overdue && ' · past end date'}
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Notes</div>
              {project.notes
                ? <p className="text-sm whitespace-pre-wrap">{project.notes}</p>
                : <p className="text-sm text-muted-foreground italic">No notes.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 gap-2">
            <CardTitle className="text-base">Tasks</CardTitle>
            <div className="flex items-center gap-2">
              <Tabs value={taskStatus} onValueChange={v => setTaskStatus(v as 'open' | 'done' | 'all')}>
                <TabsList className="h-8">
                  <TabsTrigger value="open" className="text-xs">Open</TabsTrigger>
                  <TabsTrigger value="done" className="text-xs">Done</TabsTrigger>
                  <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button size="sm" className="gap-1.5" onClick={() => setTaskOpen(true)}>
                <Plus className="h-4 w-4" /> Add task
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <TaskList
              projectId={project.id} status={taskStatus} refreshKey={taskRefresh} showAnchorLinks={false}
              emptyText={taskStatus === 'open' ? 'No open tasks on this project.' : 'No tasks'}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <ConfirmDeleteButton
            itemLabel="project"
            description="This permanently removes the project. Its tasks are kept and just lose the project link."
            className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
            onConfirm={async () => {
              const db = supabase as any;
              const { error: unlinkErr } = await db.from('tasks')
                .update({ association_type: null, association_id: null, association_label: null })
                .eq('association_type', PROJECT).eq('association_id', project.id);
              if (unlinkErr) throw unlinkErr;
              const { error } = await db.from('projects').delete().eq('id', project.id);
              if (error) throw error;
              navigate('/projects');
            }}
          />
        </div>

        <ProjectDialog open={editOpen} onOpenChange={setEditOpen} project={project}
          onSaved={p => { setProject(p); setTaskRefresh(k => k + 1); }} />
        <TaskDialog open={taskOpen} onOpenChange={setTaskOpen} context={{ projectId: project.id }}
          onSaved={() => setTaskRefresh(k => k + 1)} />
      </div>
    </AppLayout>
  );
}
