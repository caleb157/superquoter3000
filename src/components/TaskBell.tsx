import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TaskList } from '@/components/TaskList';
import { useAuth } from '@/contexts/AuthContext';
import { localDateStr } from '@/lib/task-helpers';

/**
 * Top-bar bell: a red count of the signed-in user's open tasks due today or
 * overdue; opens a side panel listing them. Hidden for users without an
 * assignee code, since tasks are assigned by code.
 */
export function TaskBell() {
  const { assigneeCode } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [listKey, setListKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!assigneeCode) return;
    const { count: n } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assignee', assigneeCode)
      .eq('status', 'open')
      .lte('due_date', localDateStr());
    setCount(n ?? 0);
  }, [assigneeCode]);

  // Re-count on page changes, when the tab comes back into view, and every few minutes.
  useEffect(() => { void refresh(); }, [refresh, location.pathname]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

  if (!assigneeCode) return null;

  const label = count > 0 ? `${count} task${count === 1 ? '' : 's'} due today or overdue` : 'No tasks due today';

  return (
    <>
      <Button
        variant="ghost" size="icon" className="h-8 w-8 relative"
        onClick={() => { setListKey(k => k + 1); setOpen(true); }}
        aria-label={label} title={label}
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-4 text-center tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Button>
      <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) void refresh(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-3 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>My tasks today</SheetTitle>
            <SheetDescription>Your open tasks due today or overdue.</SheetDescription>
          </SheetHeader>
          <TaskList
            assignee={assigneeCode}
            status="open"
            dueWindow="due_by_today"
            sort="due_date"
            refreshKey={listKey}
            onChanged={() => void refresh()}
            emptyText="Nothing due today."
            narrow
          />
          <Link to="/tasks" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">
            All tasks →
          </Link>
        </SheetContent>
      </Sheet>
    </>
  );
}
