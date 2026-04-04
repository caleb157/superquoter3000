import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { Copy, RefreshCw, Loader2, Search, CalendarIcon, X, ExternalLink, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';

const STATUS_OPTIONS = ['draft', 'sent', 'approved', 'expired'];

const Quotes = () => {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [entities, setEntities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectionsSnap, setSelectionsSnap] = useState<any | null>(null);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [entities, setEntities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [filterProject, setFilterProject] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterEntity, setFilterEntity] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<any>({
    storageKey: 'quotes-sort',
  });

  const fetchData = async () => {
    setLoading(true);
    const [snapRes, projRes, entRes] = await Promise.all([
      (supabase as any).from('quote_snapshots').select('*').order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name'),
      (supabase as any).from('company_entities').select('id, name'),
    ]);

    setSnapshots(snapRes.data || []);

    const projMap: Record<string, string> = {};
    (projRes.data || []).forEach((p: any) => { projMap[p.id] = p.name; });
    setProjects(projMap);

    const entMap: Record<string, string> = {};
    (entRes.data || []).forEach((e: any) => { entMap[e.id] = e.name; });
    setEntities(entMap);

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const statusVariant = (status: string) => {
    switch (status) {
      case 'approved': return 'default';
      case 'sent': return 'secondary';
      case 'expired': return 'destructive';
      case 'draft': return 'outline';
      default: return 'outline';
    }
  };

  const updateStatus = async (snapId: string, newStatus: string) => {
    const updates: any = { status: newStatus };
    if (newStatus === 'approved') updates.approved_at = new Date().toISOString();
    if (newStatus === 'sent') updates.sent_at = new Date().toISOString();

    const { error } = await (supabase as any).from('quote_snapshots').update(updates).eq('id', snapId);
    if (error) { toast.error('Failed to update status'); return; }
    setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, ...updates } : s));
    toast.success(`Quote marked as ${newStatus}`);
  };

  const filtered = useMemo(() => {
    let result = snapshots.filter(snap => {
      // Search by quote number or project name
      if (search) {
        const s = search.toLowerCase();
        const projName = (snap.project_id ? projects[snap.project_id] : '') || '';
        const quoteNum = snap.quote_number || '';
        if (!quoteNum.toLowerCase().includes(s) && !projName.toLowerCase().includes(s)) return false;
      }
      if (filterProject !== 'all' && snap.project_id !== filterProject) return false;
      if (filterStatus !== 'all' && (snap.status || 'draft') !== filterStatus) return false;
      if (filterEntity !== 'all' && snap.entity_id !== filterEntity) return false;
      if (dateFrom) {
        const created = new Date(snap.created_at);
        if (created < dateFrom) return false;
      }
      if (dateTo) {
        const created = new Date(snap.created_at);
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        if (created > endOfDay) return false;
      }
      return true;
    });

    const getters: Record<string, (s: any) => string | number> = {
      quote_number: (s) => (s.quote_number || '').toLowerCase(),
      project: (s) => (projects[s.project_id] || '').toLowerCase(),
      entity: (s) => (entities[s.entity_id] || '').toLowerCase(),
      date: (s) => new Date(s.created_at).getTime(),
      valid_until: (s) => s.valid_until ? new Date(s.valid_until).getTime() : 0,
      skus: (s) => (s.totals as any)?.sku_count || 0,
      qty: (s) => (s.totals as any)?.total_qty || 0,
      cbm: (s) => (s.totals as any)?.total_cbm || 0,
      total: (s) => (s.totals as any)?.grand_total || 0,
      status: (s) => STATUS_OPTIONS.indexOf(s.status || 'draft'),
    };

    return sortItems(result, getters);
  }, [snapshots, search, filterProject, filterStatus, filterEntity, dateFrom, dateTo, projects, entities, sortColumn, sortDirection]);

  const projectList = useMemo(() => {
    const ids = new Set(snapshots.map(s => s.project_id).filter(Boolean));
    return Array.from(ids).map(id => ({ id, name: projects[id] || 'Unknown' })).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshots, projects]);

  const entityList = useMemo(() => {
    const ids = new Set(snapshots.map(s => s.entity_id).filter(Boolean));
    return Array.from(ids).map(id => ({ id, name: entities[id] || 'Unknown' })).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshots, entities]);

  const hasActiveFilters = search || filterProject !== 'all' || filterStatus !== 'all' || filterEntity !== 'all' || dateFrom || dateTo;

  const clearFilters = () => {
    setSearch('');
    setFilterProject('all');
    setFilterStatus('all');
    setFilterEntity('all');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold">All Quotes</h1>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search quote # or project..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projectList.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterEntity} onValueChange={setFilterEntity}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Entities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entities</SelectItem>
              {entityList.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-9 text-xs gap-1.5 min-w-[120px] justify-start", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateFrom ? format(dateFrom, 'MMM d, yyyy') : 'From date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-9 text-xs gap-1.5 min-w-[120px] justify-start", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateTo ? format(dateTo, 'MMM d, yyyy') : 'To date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {snapshots.length === 0
                  ? 'No quotes generated yet. Generate one from a project\'s Settings tab.'
                  : 'No quotes match the current filters.'}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="quote_number" label="Quote #" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                    <SortableHeader column="project" label="Project" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                    <SortableHeader column="entity" label="Entity" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                    <SortableHeader column="date" label="Date" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                    <SortableHeader column="valid_until" label="Valid Until" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                    <SortableHeader column="skus" label="SKUs" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                    <SortableHeader column="qty" label="Qty" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                    <SortableHeader column="cbm" label="CBM" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                    <SortableHeader column="total" label="Total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs text-right" />
                    <TableHead className="text-xs">Currency</TableHead>
                    <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-xs" />
                    <TableHead className="text-xs">Viewed</TableHead>
                    <TableHead className="text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((snap: any) => {
                    const totals = (snap.totals || {}) as any;
                    const sym = snap.currency === 'INR' ? '₹' : '$';
                    const viewedAt = snap.viewed_at ? new Date(snap.viewed_at).toLocaleDateString() : '—';
                    const approvedAt = snap.approved_at ? new Date(snap.approved_at).toLocaleDateString() : null;

                    return (
                      <TableRow key={snap.id}>
                        <TableCell className="text-xs font-mono font-medium">{snap.quote_number || '—'}</TableCell>
                        <TableCell className="text-xs">
                          {snap.project_id ? (
                            <Link to={`/project/${snap.project_id}`} className="text-primary hover:underline">
                              {projects[snap.project_id] || 'Project'}
                            </Link>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {snap.entity_id ? entities[snap.entity_id] || '—' : '—'}
                        </TableCell>
                        <TableCell className="text-xs">{new Date(snap.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-xs">
                          {snap.valid_until ? new Date(snap.valid_until).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-right">{totals.sku_count ?? '—'}</TableCell>
                        <TableCell className="text-xs text-right">{totals.total_qty?.toLocaleString() ?? '—'}</TableCell>
                        <TableCell className="text-xs text-right">{totals.total_cbm != null ? Number(totals.total_cbm).toFixed(2) : '—'}</TableCell>
                        <TableCell className="text-xs text-right font-medium">
                          {totals.grand_total != null
                            ? `${sym}${Number(totals.grand_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-xs">{snap.currency || 'USD'}</TableCell>
                        <TableCell>
                          <Select value={snap.status || 'draft'} onValueChange={v => updateStatus(snap.id, v)}>
                            <SelectTrigger className="h-7 w-24 text-[10px] p-1">
                              <Badge variant={statusVariant(snap.status) as any} className="text-[10px]">
                                {snap.status || 'draft'}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map(s => (
                                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {approvedAt && (
                            <p className="text-[9px] text-muted-foreground mt-0.5">Approved {approvedAt}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{viewedAt}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {snap.share_token && (
                              <Button
                                variant="ghost" size="sm" className="text-xs h-7 gap-1"
                                onClick={() => {
                                  const url = `${window.location.origin}/quote/${snap.share_token}`;
                                  navigator.clipboard.writeText(url);
                                  toast.success('Share link copied!');
                                }}
                              >
                                <Copy className="h-3 w-3" /> Link
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Quotes;
