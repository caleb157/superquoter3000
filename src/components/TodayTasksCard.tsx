import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TaskList } from '@/components/TaskList';
import { useAuth } from '@/contexts/AuthContext';
import { usePersistentState } from '@/hooks/use-persistent-state';

/**
 * Home page "Today" list: open tasks due today or overdue, for the signed-in
 * user by default (their assignee code), with a switch to the whole team's.
 */
export function TodayTasksCard({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const { assigneeCode } = useAuth();
  const [scope, setScope] = usePersistentState<'mine' | 'everyone'>('dashboard.taskScope', 'mine');
  const effective = assigneeCode ? scope : 'everyone';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <Card>
      <CardContent className="pt-3 pb-2 sm:pt-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {effective === 'mine' ? 'My tasks today' : "Team's tasks today"}
            </div>
            <div className="text-[11px] text-muted-foreground">{today} · due today or overdue</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {assigneeCode && (
              <Tabs value={scope} onValueChange={v => setScope(v as 'mine' | 'everyone')}>
                <TabsList className="h-8">
                  <TabsTrigger value="mine" className="text-xs h-6 px-2.5">Mine</TabsTrigger>
                  <TabsTrigger value="everyone" className="text-xs h-6 px-2.5">Everyone</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <Link to="/tasks" className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap">
              All tasks →
            </Link>
          </div>
        </div>
        <div className="mt-1">
          <TaskList
            assignee={effective === 'mine' ? assigneeCode ?? 'all' : 'all'}
            status="open"
            dueWindow="due_by_today"
            sort="due_date"
            refreshKey={refreshKey}
            onChanged={onChanged}
            emptyText="Nothing due today."
          />
        </div>
      </CardContent>
    </Card>
  );
}
