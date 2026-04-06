import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, LayoutGrid, Table as TableIcon, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PipelineTable } from '@/components/PipelineTable';
import { PipelineKanban } from '@/components/PipelineKanban';
import { PipelineMetrics } from '@/components/PipelineMetrics';
import { PipelineItemDialog } from '@/components/PipelineItemDialog';
import { PipelineImport } from '@/components/PipelineImport';
import { daysBetween, getStage, type PipelineItem } from '@/lib/pipeline-helpers';
import type { Tables } from '@/integrations/supabase/types';

export default function Pipeline() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [customers, setCustomers] = useState<Tables<'customers'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterWho, setFilterWho] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active');
  const [filterCustomer, setFilterCustomer] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<PipelineItem | null>(null);

  const fetchData = useCallback(async () => {
    const [{ data: pi }, { data: cu }] = await Promise.all([
      supabase.from('pipeline_items').select('*').order('sort_order').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').order('name'),
    ]);
    setItems(pi ?? []);
    setCustomers(cu ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const customerMap = useMemo(() => {
    const m: Record<string, string> = {};
    customers.forEach(c => (m[c.id] = c.name));
    return m;
  }, [customers]);

  const whoOptions = useMemo(() => {
    const s = new Set(items.map(i => i.who).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (filterStatus !== 'all') list = list.filter(i => i.status === filterStatus);
    if (filterWho !== 'all') list = list.filter(i => i.who === filterWho);
    if (filterCustomer !== 'all') list = list.filter(i => i.customer_id === filterCustomer);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (customerMap[i.customer_id ?? ''] ?? '').toLowerCase().includes(q) ||
        (i.who ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, filterStatus, filterWho, filterCustomer, search, customerMap]);

  // Stats (active, non-foak only)
  const active = useMemo(() => items.filter(i => i.status === 'active' && !i.is_foak), [items]);
  const stats = useMemo(() => {
    const needsDesign = active.filter(i => !i.design_done).length;
    const needsQuote = active.filter(i => i.rfq_date && !i.initial_quote_date).length;
    const awaitingSample = active.filter(i => i.sample_request_date && !i.final_sample_date).length;
    const overdue = active.filter(i => {
      if (!i.initial_quote_date) return false;
      const d = daysBetween(i.rfq_date, null);
      return d !== null && d > 21;
    }).length;
    const dtqVals = active
      .map(i => daysBetween(i.rfq_date, i.initial_quote_date))
      .filter((v): v is number => v !== null);
    const avgDtq = dtqVals.length ? Math.round(dtqVals.reduce((a, b) => a + b, 0) / dtqVals.length) : null;
    return { total: active.length, needsDesign, needsQuote, awaitingSample, overdue, avgDtq };
  }, [active]);

  const handleEdit = (item: PipelineItem) => {
    setEditItem(item);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditItem(null);
    setDialogOpen(true);
  };

  if (loading) return <AppLayout><div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div></AppLayout>;

  const statCards = [
    { label: 'Active Items', value: stats.total, color: 'text-foreground' },
    { label: 'Needs Design', value: stats.needsDesign, color: 'text-red-500' },
    { label: 'Needs Quote', value: stats.needsQuote, color: 'text-amber-500' },
    { label: 'Awaiting Sample', value: stats.awaitingSample, color: 'text-blue-500' },
    { label: 'Overdue Follow-up', value: stats.overdue, color: 'text-rose-500' },
    { label: 'Avg Days→Quote', value: stats.avgDtq ?? '—', color: 'text-foreground' },
  ];

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Pipeline</h1>
          <div className="flex gap-2">
            <PipelineImport customers={customers} onImported={fetchData} />
            <Button size="sm" onClick={handleNew}><Plus className="h-3.5 w-3.5 mr-1" /> New Item</Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-6 gap-3">
          {statCards.map(s => (
            <Card key={s.label}>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search…" className="pl-8 h-9 w-[200px] text-xs" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterWho} onValueChange={setFilterWho}>
            <SelectTrigger className="h-9 w-[120px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All People</SelectItem>
              {whoOptions.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCustomer} onValueChange={setFilterCustomer}>
            <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} items</span>
        </div>

        {/* Views */}
        <Tabs defaultValue="table">
          <TabsList>
            <TabsTrigger value="table" className="text-xs gap-1"><TableIcon className="h-3.5 w-3.5" /> Table</TabsTrigger>
            <TabsTrigger value="kanban" className="text-xs gap-1"><LayoutGrid className="h-3.5 w-3.5" /> Kanban</TabsTrigger>
            <TabsTrigger value="metrics" className="text-xs gap-1"><BarChart3 className="h-3.5 w-3.5" /> Metrics</TabsTrigger>
          </TabsList>
          <TabsContent value="table" className="mt-3">
            <PipelineTable items={filtered} customers={customerMap} onEdit={handleEdit} onRefresh={fetchData} />
          </TabsContent>
          <TabsContent value="kanban" className="mt-3">
            <PipelineKanban items={filtered} customers={customerMap} onEdit={handleEdit} />
          </TabsContent>
          <TabsContent value="metrics" className="mt-3">
            <PipelineMetrics items={items} customers={customerMap} />
          </TabsContent>
        </Tabs>
      </div>

      <PipelineItemDialog open={dialogOpen} onOpenChange={setDialogOpen} item={editItem} onSaved={fetchData} />
    </AppLayout>
  );
}
