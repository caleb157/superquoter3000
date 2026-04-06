import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatDueDate, type PipelineTask } from '@/lib/task-helpers';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

export function TaskOverdueBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [dueToday, setDueToday] = useState(0);
  const [overdue, setOverdue] = useState(0);

  useEffect(() => {
    if (!user) return;
    const userName = user.email?.split('@')[0]?.toLowerCase() ?? '';
    const todayStr = new Date().toISOString().slice(0, 10);

    supabase.from('pipeline_tasks')
      .select('due_date, assigned_to')
      .eq('completed', false)
      .not('due_date', 'is', null)
      .lte('due_date', todayStr)
      .then(({ data }) => {
        if (!data) return;
        // Show all (not just "mine") since there are 1-2 users
        const todayTasks = data.filter(t => t.due_date === todayStr);
        const overdueTasks = data.filter(t => t.due_date! < todayStr);
        setDueToday(todayTasks.length);
        setOverdue(overdueTasks.length);
      });
  }, [user]);

  if (dismissed || (dueToday === 0 && overdue === 0)) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm">
      <span className="text-amber-800 dark:text-amber-200">
        {overdue > 0 && <strong>{overdue} overdue</strong>}
        {overdue > 0 && dueToday > 0 && ' and '}
        {dueToday > 0 && <strong>{dueToday} due today</strong>}
        {' — '}
        <a href="/pipeline?tab=tasks" className="underline hover:text-amber-900 dark:hover:text-amber-100">View tasks</a>
      </span>
      <button onClick={() => setDismissed(true)} className="ml-auto text-amber-600 hover:text-amber-800">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
