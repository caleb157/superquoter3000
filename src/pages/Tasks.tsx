import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';
import { TaskDialog } from '@/components/TaskDialog';
import { TaskList } from '@/components/TaskList';

import type { DueWindow } from '@/lib/task-types';

export default function Tasks() {
  const [inquiries, setInquiries] = useState<{ id: string; rfq_number: string; title: string | null }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);

  const [filterInquiry, setFilterInquiry] = useState<string>('all');
  const [filterProduct, setFilterProduct] = useState<string>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'open' | 'done' | 'all'>('open');
  const [filterDue, setFilterDue] = useState<DueWindow>('all');
  const [sort, setSort] = useState<'due_date' | 'priority' | 'created_at'>('due_date');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const [iRes, aRes] = await Promise.all([
        supabase.from('customer_rfqs').select('id, rfq_number, title').order('updated_at', { ascending: false }),
        supabase.from('tasks').select('assignee'),
      ]);
      if (iRes.data) setInquiries(iRes.data as any);
      if (aRes.data) {
        const set = new Set<string>();
        (aRes.data as any[]).forEach(r => { if (r.assignee) set.add(r.assignee); });
        setAssignees(Array.from(set).sort());
      }
    })();
  }, [refreshKey]);

  useEffect(() => {
    if (filterInquiry === 'all') { setProducts([]); setFilterProduct('all'); return; }
    (async () => {
      const { data } = await supabase
        .from('products').select('id, name').eq('customer_rfq_id', filterInquiry).order('name');
      setProducts((data as any) ?? []);
      setFilterProduct('all');
    })();
  }, [filterInquiry]);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Tasks</h1>
          <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Task</span><span className="sm:hidden">New</span>
          </Button>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-3">
            {/* Status tabs always on top */}
            <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
              <TabsList className="h-9 w-full sm:w-auto">
                <TabsTrigger value="open" className="text-xs flex-1 sm:flex-initial">Open</TabsTrigger>
                <TabsTrigger value="done" className="text-xs flex-1 sm:flex-initial">Done</TabsTrigger>
                <TabsTrigger value="all" className="text-xs flex-1 sm:flex-initial">All</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2">
              <Select value={filterInquiry} onValueChange={setFilterInquiry}>
                <SelectTrigger className="h-9 text-sm lg:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All inquiries</SelectItem>
                  {inquiries.map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.rfq_number} — {i.title || 'Untitled'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterProduct} onValueChange={setFilterProduct} disabled={filterInquiry === 'all'}>
                <SelectTrigger className="h-9 text-sm lg:w-48"><SelectValue placeholder="All products" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={filterAssignee} onValueChange={setFilterAssignee}>
                <SelectTrigger className="h-9 text-sm lg:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All assignees</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {assignees.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={filterDue} onValueChange={(v) => setFilterDue(v as DueWindow)}>
                <SelectTrigger className="h-9 text-sm lg:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dates</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="this_week">This week</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sort} onValueChange={(v) => setSort(v as any)}>
                <SelectTrigger className="h-9 text-sm lg:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="due_date">Due date</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                  <SelectItem value="created_at">Newest</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <TaskList
              inquiryId={filterInquiry !== 'all' ? filterInquiry : undefined}
              productId={filterProduct !== 'all' ? filterProduct : undefined}
              assignee={filterAssignee}
              status={filterStatus}
              dueWindow={filterDue}
              sort={sort}
              refreshKey={refreshKey}
            />
          </CardContent>
        </Card>

        <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => setRefreshKey(k => k + 1)} />
      </div>
      <MobileFab onClick={() => setDialogOpen(true)} label="New task" />
    </AppLayout>
  );
}
