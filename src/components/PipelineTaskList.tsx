import { useCallback, useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatDueDate, priorityColor, type PipelineTask } from '@/lib/task-helpers';
import { cn } from '@/lib/utils';

interface Props {
  pipelineItemId: string;
  pipelineItemName: string;
}

export function PipelineTaskList({ pipelineItemId, pipelineItemName }: Props) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);

  // Inline add state
  const [newTitle, setNewTitle] = useState('');
  const [newAssigned, setNewAssigned] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newPriority, setNewPriority] = useState('normal');

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from('pipeline_tasks')
      .select('*')
      .eq('pipeline_item_id', pipelineItemId)
      .order('due_date', { ascending: true, nullsFirst: false });
    setTasks(data ?? []);
  }, [pipelineItemId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const openTasks = tasks.filter(t => !t.completed).sort((a, b) => {
    // Overdue first
    const aOverdue = a.due_date && new Date(a.due_date + 'T00:00:00') < new Date() ? 0 : 1;
    const bOverdue = b.due_date && new Date(b.due_date + 'T00:00:00') < new Date() ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    return (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999');
  });
  const completedTasks = tasks.filter(t => t.completed);

  const toggleComplete = async (task: PipelineTask) => {
    const nowCompleted = !task.completed;
    const actor = user?.email?.split('@')[0] ?? 'Unknown';
    await supabase.from('pipeline_tasks').update({
      completed: nowCompleted,
      completed_at: nowCompleted ? new Date().toISOString() : null,
      completed_by: nowCompleted ? actor : null,
    }).eq('id', task.id);

    // Log activity
    await supabase.from('pipeline_activity').insert({
      pipeline_item_id: pipelineItemId,
      action: nowCompleted ? 'task_completed' : 'task_reopened',
      description: `${nowCompleted ? 'Completed' : 'Reopened'} "${task.title}"`,
      actor,
    });

    fetchTasks();
  };

  const addTask = async () => {
    if (!newTitle.trim()) return;
    const actor = user?.email?.split('@')[0] ?? 'Unknown';
    const { error } = await supabase.from('pipeline_tasks').insert({
      pipeline_item_id: pipelineItemId,
      title: newTitle.trim(),
      assigned_to: newAssigned || null,
      due_date: newDue || null,
      priority: newPriority,
      created_by: actor,
    });
    if (error) { toast.error(error.message); return; }

    await supabase.from('pipeline_activity').insert({
      pipeline_item_id: pipelineItemId,
      action: 'task_created',
      description: `Created task "${newTitle.trim()}"`,
      actor,
    });

    setNewTitle('');
    setNewDue('');
    setNewPriority('normal');
    fetchTasks();
  };

  const TaskRow = ({ task }: { task: PipelineTask }) => {
    const due = formatDueDate(task.due_date);
    return (
      <div className="flex items-center gap-2 py-1.5 group">
        <Checkbox
          checked={task.completed}
          onCheckedChange={() => toggleComplete(task)}
        />
        <span className={cn('h-2 w-2 rounded-full flex-shrink-0', priorityColor(task.priority))} />
        <span className={cn('text-sm flex-1', task.completed && 'line-through text-muted-foreground')}>
          {task.title}
        </span>
        {task.assigned_to && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1">{task.assigned_to}</Badge>
        )}
        <span className={cn('text-[11px] flex-shrink-0', due.isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground')}>
          {due.text}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tasks</h4>

      {/* Open tasks */}
      {openTasks.map(t => <TaskRow key={t.id} task={t} />)}

      {/* Inline add */}
      <div className="flex items-center gap-1.5 pt-1">
        <Input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="e.g. Get final design from vendor"
          className="h-7 text-xs flex-1"
          onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
        />
        <Input
          value={newAssigned}
          onChange={e => setNewAssigned(e.target.value)}
          placeholder="Who"
          className="h-7 text-xs w-16"
        />
        <Input
          type="date"
          value={newDue}
          onChange={e => setNewDue(e.target.value)}
          className="h-7 text-xs w-[120px]"
        />
        <Select value={newPriority} onValueChange={setNewPriority}>
          <SelectTrigger className="h-7 text-[10px] w-[70px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={addTask} disabled={!newTitle.trim()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
        <Collapsible open={showCompleted} onOpenChange={setShowCompleted}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className={cn('h-3 w-3 transition-transform', showCompleted && 'rotate-180')} />
            {completedTasks.length} completed
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1">
            {completedTasks.map(t => <TaskRow key={t.id} task={t} />)}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
