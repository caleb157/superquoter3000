import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink, MessageSquareWarning, Plus, Search } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { ComplaintDialog, patchComplaint, useComplaints, type Complaint } from '@/components/complaints/ComplaintDialog';

type StatusFilter = 'all' | 'open' | 'resolved';

/** Customer complaints directory: the full log. Analytics only shows the count for its date range. */
export default function Complaints() {
  useDocumentTitle('Complaints');
  const { rows, openTasks, loading, reload } = useComplaints();
  const [params, setParams] = useSearchParams();
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Complaint | null>(null);

  useEffect(() => { supabase.from('customers').select('id, name').order('name').then(({ data }) => setCustomers(data || [])); }, []);
  const custName = (c: Complaint) => customers.find(x => x.id === c.customer_id)?.name ?? c.customer_name_manual ?? '—';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(c => {
      if (status !== 'all' && c.status !== status) return false;
      if (!q) return true;
      return [custName(c), c.issue_summary, c.potential_resolution, c.notes].some(s => s?.toLowerCase().includes(q));
    });
  }, [rows, customers, search, status]);
  const openCount = rows.filter(c => c.status === 'open').length;

  // Task badges in the task log link here with ?id= to open that complaint.
  const linkedId = params.get('id');
  useEffect(() => {
    const c = linkedId && rows.find(r => r.id === linkedId);
    if (c) { setEditing(c); setOpen(true); }
  }, [linkedId, rows]);
  const setDialogOpen = (o: boolean) => { setOpen(o); if (!o && linkedId) setParams({}, { replace: true }); };

  const startNew = () => { setEditing(null); setOpen(true); };
  const startEdit = (c: Complaint) => { setEditing(c); setOpen(true); };
  const patch = async (id: string, p: Partial<Complaint>) => { if (await patchComplaint(id, p)) reload(); };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="h-5 w-5 text-muted-foreground" />
            <h1 className="page-title">Complaints</h1>
            <Badge variant="secondary" className="text-xs">{rows.length}</Badge>
            {openCount > 0 && <Badge variant="destructive" className="text-xs">{openCount} open</Badge>}
          </div>
          <Button size="sm" onClick={startNew}><Plus className="h-3.5 w-3.5 mr-1" />Log complaint</Button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search customer, issue or notes…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Tabs value={status} onValueChange={v => setStatus(v as StatusFilter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {rows.length ? 'No complaints match.' : 'No complaints logged yet.'}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Issue</TableHead><TableHead>Resolution</TableHead>
                  <TableHead>Photos</TableHead><TableHead>Status</TableHead><TableHead>Closed</TableHead><TableHead className="text-center">Open tasks</TableHead><TableHead className="text-center">Actions captured</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map(c => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => startEdit(c)}>
                      <TableCell className="whitespace-nowrap tabular-nums">{c.date_logged}</TableCell>
                      <TableCell>{custName(c)}</TableCell>
                      <TableCell className="max-w-[300px] truncate" title={c.issue_summary}>{c.issue_summary}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted-foreground" title={c.potential_resolution ?? undefined}>{c.potential_resolution || '—'}</TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        {c.google_drive_url ? <a href={c.google_drive_url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">Drive <ExternalLink className="h-3 w-3" /></a> : '—'}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Badge variant={c.status === 'open' ? 'destructive' : 'secondary'} className="cursor-pointer" title="Click to toggle"
                          onClick={() => patch(c.id, c.status === 'open' ? { status: 'resolved', date_closed: new Date().toISOString().slice(0, 10) } : { status: 'open', date_closed: null })}>
                          {c.status === 'open' ? 'Open' : 'Resolved'}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap">{c.date_closed || '—'}</TableCell>
                      <TableCell className="text-center tabular-nums">{openTasks[c.id] || '—'}</TableCell>
                      <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                        <Checkbox checked={c.actions_captured} onCheckedChange={v => patch(c.id, { actions_captured: !!v })} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <ComplaintDialog open={open} onOpenChange={setDialogOpen} editing={editing} customers={customers} onSaved={reload} />
    </AppLayout>
  );
}
