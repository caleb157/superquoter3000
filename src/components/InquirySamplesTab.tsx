import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Rfs = {
  id: string; rfs_number: string; title: string | null;
  requested_date: string; required_by_date: string | null;
  status: string; finishes_used?: string | null; vendors_used?: string | null;
  notes?: string | null;
};
type Sample = {
  id: string; rfs_id: string; vendor_name: string | null; status: string;
  photo_urls: any; feedback: string | null; product_id: string | null;
  product?: { name: string } | null;
};

export function InquirySamplesTab({ inquiryId, refreshKey }: { inquiryId: string; refreshKey: number }) {
  const [batches, setBatches] = useState<Rfs[]>([]);
  const [samplesByRfs, setSamplesByRfs] = useState<Record<string, Sample[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('rfs').select('*').eq('customer_rfq_id', inquiryId)
        .order('requested_date', { ascending: false });
      setBatches(data ?? []);
      if (data?.length) {
        const ids = data.map((r: Rfs) => r.id);
        const { data: ss } = await (supabase as any)
          .from('samples').select('*, product:products(name)').in('rfs_id', ids);
        const map: Record<string, Sample[]> = {};
        (ss ?? []).forEach((s: Sample) => {
          if (!map[s.rfs_id]) map[s.rfs_id] = [];
          map[s.rfs_id].push(s);
        });
        setSamplesByRfs(map);
      } else {
        setSamplesByRfs({});
      }
    })();
  }, [inquiryId, refreshKey]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  if (batches.length === 0) {
    return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No sample batches yet.</CardContent></Card>;
  }

  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead className="w-8" />
          <TableHead className="text-xs">RFS</TableHead>
          <TableHead className="text-xs">Title</TableHead>
          <TableHead className="text-xs">Requested</TableHead>
          <TableHead className="text-xs">Required by</TableHead>
          <TableHead className="text-xs">Status</TableHead>
          <TableHead className="text-xs text-right">Products</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {batches.map(b => {
            const samples = samplesByRfs[b.id] ?? [];
            const isOpen = expanded.has(b.id);
            return (
              <>
                <TableRow key={b.id} className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(b.id)}>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </Button>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{b.rfs_number}</TableCell>
                  <TableCell className="text-sm">{b.title || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(b.requested_date).toLocaleDateString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{b.required_by_date ? new Date(b.required_by_date).toLocaleDateString() : '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{b.status}</Badge></TableCell>
                  <TableCell className="text-xs text-right">{samples.length}</TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow key={b.id + '-exp'}>
                    <TableCell colSpan={7} className="bg-muted/20">
                      <div className="p-3 space-y-2">
                        {(b.finishes_used || b.vendors_used || b.notes) && (
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            {b.finishes_used && <div><span className="font-medium">Finishes:</span> {b.finishes_used}</div>}
                            {b.vendors_used && <div><span className="font-medium">Vendors:</span> {b.vendors_used}</div>}
                            {b.notes && <div><span className="font-medium">Notes:</span> {b.notes}</div>}
                          </div>
                        )}
                        <Table>
                          <TableHeader><TableRow>
                            <TableHead className="text-xs">Product</TableHead>
                            <TableHead className="text-xs">Vendor</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs">Photos</TableHead>
                            <TableHead className="text-xs">Feedback</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>
                            {samples.map(s => (
                              <TableRow key={s.id}>
                                <TableCell className="text-sm">{s.product?.name ?? '—'}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{s.vendor_name ?? '—'}</TableCell>
                                <TableCell><Badge variant="outline" className="text-[10px]">{s.status}</Badge></TableCell>
                                <TableCell className="text-xs">{Array.isArray(s.photo_urls) ? s.photo_urls.length : 0}</TableCell>
                                <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">{s.feedback ?? '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}
