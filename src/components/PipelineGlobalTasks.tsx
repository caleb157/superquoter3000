import { useCallback, useEffect, useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatDueDate, priorityColor, type PipelineTask } from '@/lib/task-helpers';
import { cn } from '@/lib/utils';
import { startOfDay, endOfWeek } from 'date-fns';

interface Props {
  items: { id: string; name: string; customer_id: string | null }[];
  customers: Record<string, string>;
  onOpenItem: (itemId: string) => void;
}

export function PipelineGlobalTasks({ items, customers, onOpenItem }: Props) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<(PipelineTask & { item_name?: string; customer_name?: string })[]>([]);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const userName = user?.email?.split('@')[0] ?? '';

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from('pipeline_tasks')
      .select('*')
      .eq('completed', false)
      .order('due_date', { ascending: true, nullsFirst: false });

    const enriched = (data ?? []).map(t => {
      const item = items.find(i => i.id === t.pipeline_item_id);
      return {
        ...t,
        item_name: item?.name ?? 'Unknown',
        customer_name: item?.customer_id ? customers[item.customer_id] ?? '' : '',
      };
    });
    setTasks(enriched);
  }, [items, customers]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const filtered = useMemo(() => {
    if (filter === 'mine') {
      return tasks.filter(t =>
        t.assigned_to?.toLowerCase() === userName.toLowerCase()
      );
    }
    return tasks;
  }, [tasks, filter, userName]);

  const today = startOfDay(new Date());
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

  const overdue = filtered.filter(t => t.due_date && new Date(t.due_date + 'T00:00:00') < today);
  const thisWeek = filtered.filter(t => {
    if (!t.due_date) return false;
    const d = new Date(t.due_date + 'T00:00:00');
    return d >= today && d <= weekEnd;
  });
  const upcoming = filtered.filter(t => {
    if (!t.due_date) return true;
    return new Date(t.due_date + 'T00:00:00') > weekEnd;
  });

  const toggleComplete = async (task: PipelineTask) => {
    const actor = userName;
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
    fetchTasks();
  };

  const TaskRow = ({ task }: { task: typeof tasks[0] }) => {
    const due = formatDueDate(task.due_date);
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/50 rounded-md">
        <Checkbox checked={false} onCheckedChange={() => toggleComplete(task)} />
        <span className={cn('h-2 w-2 rounded-full flex-shrink-0', priorityColor(task.priority))} />
        <span className="text-sm flex-1">{task.title}</span>
        <button
          className="text-xs text-primary hover:underline flex-shrink-0"
          onClick={() => onOpenItem(task.pipeline_item_id)}
        >
          {task.item_name}
        </button>
        {task.customer_name && (
          <span className="text-xs text-muted-foreground">{task.customer_name}</span>
        )}
        {task.assigned_to && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1">{task.assigned_to}</Badge>
        )}
        <span className={cn('text-[11px] flex-shrink-0', due.isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground')}>
          {due.text}
        </span>
      </div>
    );
  };

  const Section = ({ title, tasks: sectionTasks, borderColor }: { title: string; tasks: typeof tasks; borderColor: string }) => {
    if (sectionTasks.length === 0) return null;
    return (
      <div className={cn('border-l-2 pl-3 space-y-0.5', borderColor)}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{title} ({sectionTasks.length})</h3>
        {sectionTasks.map(t => <TaskRow key={t.id} task={t} />)}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setFilter('all')}
        >All</Button>
        <Button
          variant={filter === 'mine' ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setFilter('mine')}
        >Mine</Button>
        <span className="text-xs text-muted-foreground self-center ml-2">{filtered.length} open tasks</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No open tasks</p>
      ) : (
        <div className="space-y-4">
          <Section title="Overdue" tasks={overdue} borderColor="border-red-500" />
          <Section title="Due This Week" tasks={thisWeek} borderColor="border-amber-400" />
          <Section title="Upcoming" tasks={upcoming} borderColor="border-muted-foreground/30" />
        </div>
      )}
    </div>
  );
}
