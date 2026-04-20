import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TaskList } from '@/components/TaskList';

export function DashboardTaskWidget() {
  const [overdueCount, setOverdueCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { count } = await supabase
        .from('tasks').select('id', { count: 'exact', head: true })
        .eq('status', 'open').lt('due_date', today);
      setOverdueCount(count ?? 0);
    })();
  }, [refreshKey]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>My Tasks</span>
          {overdueCount > 0 && (
            <span className="text-xs text-red-600 font-normal">({overdueCount} overdue)</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <TaskList
          status="open"
          sort="due_date"
          maxItems={6}
          compact
          showAnchorLinks={false}
          refreshKey={refreshKey}
        />
        <div className="pt-2 mt-2 border-t">
          <Link to="/tasks" className="text-xs text-primary hover:underline" onClick={() => setRefreshKey(k => k + 1)}>
            View all tasks →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
