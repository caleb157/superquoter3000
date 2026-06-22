import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { TaskDialog } from '@/components/TaskDialog';
import { TaskList } from '@/components/TaskList';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

import type { DueWindow, TaskSortKey, TaskSortDir } from '@/lib/task-types';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function Tasks() {
  useDocumentTitle('Tasks');
  const { assigneeCode } = useAuth();
  const [inquiries, setInquiries] = useState<{ id: string; rfq_number: string; title: string | null }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);

  const [filterInquiry, setFilterInquiry] = useState<string>('all');
  const [filterProduct, setFilterProduct] = useState<string>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const userTouchedAssignee = useRef(false);
  const [filterStatus, setFilterStatus] = useState<'open' | 'done' | 'all'>('open');
  const [filterDue, setFilterDue] = useState<DueWindow>('all');
  const [sort, setSort] = useState<TaskSortKey>('due_date');
  const [sortDir, setSortDir] = useState<TaskSortDir>('asc');

  // Default the assignee filter to the signed-in user's code as soon as it arrives,
  // unless the user has already manually picked a different value.
  useEffect(() => {
    if (assigneeCode && !userTouchedAssignee.current) {
      setFilterAssignee(assigneeCode);
    }
  }, [assigneeCode]);

  const handleAssigneeChange = (v: string) => {
    userTouchedAssignee.current = true;
    setFilterAssignee(v);
  };

  const toggleSort = (key: TaskSortKey) => {
    if (sort === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      // Sensible defaults: text columns A→Z, dates oldest→newest, priority urgent→low
      setSortDir(key === 'created_at' ? 'desc' : 'asc');
    }
  };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useKeyboardShortcuts({ onNewItem: () => setDialogOpen(true) });

  useEffect(() => {
    (async () => {
      const [iRes, aRes, pRes] = await Promise.all([
        supabase.from('customer_rfqs').select('id, rfq_number, title').order('updated_at', { ascending: false }),
        supabase.from('tasks').select('assignee'),
        (supabase as any).from('profiles').select('assignee_code'),
      ]);
      if (iRes.data) setInquiries(iRes.data as any);
      const set = new Set<string>();
      if (aRes.data) (aRes.data as any[]).forEach(r => { if (r.assignee) set.add(r.assignee); });
      if (pRes.data) (pRes.data as any[]).forEach(r => { if (r.assignee_code) set.add(r.assignee_code); });
      if (assigneeCode) set.add(assigneeCode);
      setAssignees(Array.from(set).sort());
    })();
  }, [refreshKey, assigneeCode]);

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
          <h1 className="text-xl font-serif font-medium tracking-tight">Tasks</h1>
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

              <Select value={filterAssignee} onValueChange={handleAssigneeChange}>
                <SelectTrigger className="h-9 text-sm lg:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All assignees</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {assignees.map(a => <SelectItem key={a} value={a}>{a}{a === assigneeCode ? ' (you)' : ''}</SelectItem>)}
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

              {/* Sort dropdown removed — use column headers below to sort */}
            </div>

            {/* Sortable column header bar */}
            <SortHeaderBar sort={sort} sortDir={sortDir} onToggle={toggleSort} />

            <TaskList
              inquiryId={filterInquiry !== 'all' ? filterInquiry : undefined}
              productId={filterProduct !== 'all' ? filterProduct : undefined}
              assignee={filterAssignee}
              status={filterStatus}
              dueWindow={filterDue}
              sort={sort}
              sortDir={sortDir}
              refreshKey={refreshKey}
            />
          </CardContent>
        </Card>

        <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => setRefreshKey(k => k + 1)} />
      </div>
      
    </AppLayout>
  );
}

const SORT_COLUMNS: { key: TaskSortKey; label: string; className: string }[] = [
  { key: 'title',      label: 'Title',    className: 'flex-1 min-w-0' },
  { key: 'inquiry',    label: 'Inquiry',  className: 'hidden md:block w-32 lg:w-40 shrink-0' },
  { key: 'due_date',   label: 'Due',      className: 'w-16 shrink-0 text-right' },
  { key: 'priority',   label: 'Priority', className: 'w-16 shrink-0 text-right' },
  { key: 'status',     label: 'Status',   className: 'w-16 shrink-0 text-right' },
  { key: 'assignee',   label: 'Assignee', className: 'hidden md:block w-20 shrink-0 text-right' },
  { key: 'created_at', label: 'Created',  className: 'hidden lg:block w-20 shrink-0 text-right' },
];

function SortHeaderBar({
  sort, sortDir, onToggle,
}: { sort: TaskSortKey; sortDir: TaskSortDir; onToggle: (k: TaskSortKey) => void }) {
  return (
    <div className="hidden sm:flex items-center gap-2 px-1 py-1.5 border-b text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {/* spacers matching row layout: checkbox + priority dot */}
      <span className="w-4 shrink-0" aria-hidden />
      <span className="w-2 shrink-0" aria-hidden />
      {SORT_COLUMNS.map(col => {
        const active = sort === col.key;
        const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
        const isRightAligned = col.className.includes('text-right');
        return (
          <button
            key={col.key}
            type="button"
            onClick={() => onToggle(col.key)}
            className={cn(
              col.className,
              'inline-flex items-center gap-1 hover:text-foreground transition-colors',
              isRightAligned ? 'justify-end' : 'justify-start',
              active && 'text-foreground',
            )}
            aria-label={`Sort by ${col.label}`}
          >
            <span className="truncate">{col.label}</span>
            <Icon className={cn('h-3 w-3 shrink-0', !active && 'opacity-40')} />
          </button>
        );
      })}
      {/* trailing spacer for edit button column */}
      <span className="hidden sm:inline-block w-6 shrink-0" aria-hidden />
    </div>
  );
}
