import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatDueDate, priorityColor, type PipelineTask } from '@/lib/task-helpers';
import { cn } from '@/lib/utils';
import { ListTodo } from 'lucide-react';

export function DashboardTaskWidget() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<(PipelineTask & { item_name: string })[]>([]);

  const fetch = useCallback(async () => {
    if (!user) return;
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const { data } = await supabase
      .from('pipeline_tasks')
      .select('*, pipeline_items!inner(name)')
      .eq('completed', false)
      .lte('due_date', nextWeek.toISOString().slice(0, 10))
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(8);

    setTasks((data ?? []).map((t: any) => ({
      ...t,
      item_name: t.pipeline_items?.name ?? 'Unknown',
      pipeline_items: undefined,
    })));
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const toggleComplete = async (task: PipelineTask) => {
    const actor = user?.email?.split('@')[0] ?? 'Unknown';
    await supabase.from('pipeline_tasks').update({
      completed: true,
      completed_at: new Date().toISOString(),
      completed_by: actor,
    }).eq('id', task.id);
    await supabase.from('pipeline_activity').insert({
      pipeline_item_id: task.pipeline_item_id,
      action: 'task_completed',
      description: `Completed "${task.title}"`,
      actor,
    });
    fetch();
  };

  if (tasks.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListTodo className="h-4 w-4" />
          My Tasks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {tasks.map(t => {
          const due = formatDueDate(t.due_date);
          return (
            <div key={t.id} className="flex items-center gap-2 py-1">
              <Checkbox checked={false} onCheckedChange={() => toggleComplete(t)} />
              <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', priorityColor(t.priority))} />
              <span className="text-xs flex-1 truncate">{t.title}</span>
              <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{t.item_name}</span>
              <span className={cn('text-[10px] flex-shrink-0', due.isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground')}>
                {due.text}
              </span>
            </div>
          );
        })}
        <Link to="/pipeline?tab=tasks" className="text-xs text-primary hover:underline block pt-1">
          View all →
        </Link>
      </CardContent>
    </Card>
  );
}
