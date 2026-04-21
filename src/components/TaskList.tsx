import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDueDate, priorityColor } from '@/lib/task-helpers';
import { TaskDialog } from '@/components/TaskDialog';
import type { TaskWithRefs, DueWindow } from '@/lib/task-types';
import { PRIORITY_RANK } from '@/lib/task-types';

type TaskListProps = {
  inquiryId?: string;
  productId?: string;
  customerId?: string;
  /** When set, fetches tasks where customer_id = X OR inquiry_id IN (inquiries of customer X). */
  customerIdIncludingInquiries?: string;
  assignee?: string;
  status?: 'open' | 'done' | 'all';
  dueWindow?: DueWindow;
  sort?: 'due_date' | 'priority' | 'created_at';
  showAnchorLinks?: boolean;
  showEmptyState?: boolean;
  refreshKey?: number;
  maxItems?: number;
  compact?: boolean;
};

export function TaskList({
  inquiryId, productId, customerId, customerIdIncludingInquiries, assignee,
  status = 'open', dueWindow = 'all', sort = 'due_date',
  showAnchorLinks = true, showEmptyState = true, refreshKey = 0, maxItems, compact = false,
}: TaskListProps) {
  const [tasks, setTasks] = useState<TaskWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [internalRefresh, setInternalRefresh] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Special path: tasks anchored to customer OR to any of their inquiries.
      let inquiryIdsForCustomer: string[] | null = null;
      if (customerIdIncludingInquiries) {
        const { data: inqs } = await supabase
          .from('customer_rfqs')
          .select('id')
          .eq('customer_id', customerIdIncludingInquiries);
        inquiryIdsForCustomer = (inqs ?? []).map((r: any) => r.id);
      }

      let q = supabase.from('tasks').select(
        '*, inquiry:customer_rfqs(id, rfq_number, title), customer:customers(id, name), product:products(id, name)'
      );
      if (inquiryId) q = q.eq('inquiry_id', inquiryId);
      if (productId) q = q.eq('product_id', productId);
      if (customerId) q = q.eq('customer_id', customerId);
      if (customerIdIncludingInquiries) {
        if (inquiryIdsForCustomer && inquiryIdsForCustomer.length > 0) {
          q = q.or(
            `customer_id.eq.${customerIdIncludingInquiries},inquiry_id.in.(${inquiryIdsForCustomer.join(',')})`
          );
        } else {
          q = q.eq('customer_id', customerIdIncludingInquiries);
        }
      }
      if (assignee && assignee !== 'all') {
        if (assignee === 'unassigned') q = q.is('assignee', null);
        else q = q.eq('assignee', assignee);
      }
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) toast.error(error.message);
      setTasks((data as any) ?? []);
      setLoading(false);
    })();
  }, [inquiryId, productId, customerId, customerIdIncludingInquiries, assignee, status, refreshKey, internalRefresh]);

  const filteredSorted = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    let list = tasks.filter(t => {
      if (dueWindow === 'all') return true;
      if (dueWindow === 'overdue') return t.status === 'open' && t.due_date != null && t.due_date < todayStr;
      if (dueWindow === 'today') return t.due_date === todayStr;
      if (dueWindow === 'this_week') return t.due_date != null && t.due_date >= todayStr && t.due_date <= weekEndStr;
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sort === 'priority') return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      if (sort === 'created_at') return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      // due_date asc, nulls last
      if (a.due_date == null && b.due_date == null) return 0;
      if (a.due_date == null) return 1;
      if (b.due_date == null) return -1;
      return a.due_date.localeCompare(b.due_date);
    });

    if (maxItems) list = list.slice(0, maxItems);
    return list;
  }, [tasks, dueWindow, sort, maxItems]);

  const toggleStatus = async (t: TaskWithRefs) => {
    const next = t.status === 'done' ? 'open' : 'done';
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: next } : x));
    const { error } = await supabase.from('tasks').update({ status: next }).eq('id', t.id);
    if (error) {
      toast.error(error.message);
      setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: t.status } : x));
    }
  };

  if (loading) return <div className="text-xs text-muted-foreground py-3">Loading…</div>;
  if (filteredSorted.length === 0) {
    return showEmptyState ? <div className="text-sm text-muted-foreground py-4 text-center">No tasks</div> : null;
  }

  return (
    <>
      <ul className="divide-y">
        {filteredSorted.map(t => {
          const due = formatDueDate(t.due_date);
          const overdueOpen = due.isOverdue && t.status === 'open';
          return (
            <li key={t.id} className={cn('flex items-center gap-2 py-2 px-1 group', 'hover:bg-muted/50 rounded-sm')}>
              <Checkbox checked={t.status === 'done'} onCheckedChange={() => toggleStatus(t)} />
              <span className={cn('h-2 w-2 rounded-full shrink-0', priorityColor(t.priority))} />
              <button
                onClick={() => setEditId(t.id)}
                className={cn('text-sm text-left flex-1 truncate', t.status === 'done' && 'line-through text-muted-foreground')}
              >{t.title}</button>

              {showAnchorLinks && !compact && (
                <div className="flex items-center gap-1 shrink-0">
                  {t.inquiry && (
                    <Link to={`/inquiry/${t.inquiry.id}`} onClick={e => e.stopPropagation()}>
                      <Badge variant="secondary" className="text-[10px] h-5">{t.inquiry.rfq_number}</Badge>
                    </Link>
                  )}
                  {t.product && (
                    <Link to={`/product/${t.product.id}`} onClick={e => e.stopPropagation()}>
                      <Badge variant="outline" className="text-[10px] h-5 max-w-[120px] truncate">{t.product.name}</Badge>
                    </Link>
                  )}
                  {t.customer && (
                    <Badge variant="outline" className="text-[10px] h-5 max-w-[120px] truncate">{t.customer.name}</Badge>
                  )}
                </div>
              )}

              <span className={cn(
                'text-[11px] px-1.5 py-0.5 rounded shrink-0',
                overdueOpen ? 'bg-red-100 text-red-700' : 'text-muted-foreground',
              )}>{due.text}</span>

              {!compact && t.assignee && (
                <span className="text-[11px] text-muted-foreground w-8 text-right shrink-0">{t.assignee}</span>
              )}

              {!compact && (
                <Button
                  variant="ghost" size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  onClick={() => setEditId(t.id)}
                ><Pencil className="h-3 w-3" /></Button>
              )}
            </li>
          );
        })}
      </ul>
      {editId && (
        <TaskDialog
          open={!!editId}
          onOpenChange={(o) => !o && setEditId(null)}
          taskId={editId}
          onSaved={() => setInternalRefresh(k => k + 1)}
        />
      )}
    </>
  );
}
