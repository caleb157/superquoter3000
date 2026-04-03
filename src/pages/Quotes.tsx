import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { FileText, Copy, RefreshCw, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { generateCustomerQuotePDF } from '@/lib/exports';

const Quotes = () => {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [entities, setEntities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

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
      case 'draft': return 'outline';
      default: return 'outline';
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold">All Quotes</h1>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : snapshots.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No quotes generated yet. Generate one from a project's Settings tab.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Quote #</TableHead>
                    <TableHead className="text-xs">Project</TableHead>
                    <TableHead className="text-xs">Entity</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Valid Until</TableHead>
                    <TableHead className="text-xs text-right">SKUs</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">CBM</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead className="text-xs">Currency</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Viewed</TableHead>
                    <TableHead className="text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map((snap: any) => {
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
                          <Badge variant={statusVariant(snap.status) as any} className="text-[10px]">
                            {snap.status || 'draft'}
                          </Badge>
                          {approvedAt && (
                            <p className="text-[9px] text-muted-foreground mt-0.5">{approvedAt}</p>
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
