import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ReceivedRfqList } from '@/components/ReceivedRfqList';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { toast } from 'sonner';

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Quote = {
  id: string; quote_number: string | null; status: string | null;
  totals: any; created_at: string | null; sent_at: string | null; share_token: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-purple-100 text-purple-700',
  approved: 'bg-emerald-100 text-emerald-700',
};

export function InquiryQuotesTab({ inquiryId, refreshKey }: { inquiryId: string; refreshKey: number }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);

  const load = async () => {
    const { data } = await (supabase as any)
      .from('quote_snapshots')
      .select('id, quote_number, status, totals, created_at, sent_at, share_token')
      .eq('customer_rfq_id', inquiryId)
      .order('created_at', { ascending: false });
    setQuotes(data ?? []);
  };

  useEffect(() => { load(); }, [inquiryId, refreshKey]);

  const deleteQuote = async (id: string) => {
    const { error } = await (supabase as any).from('quote_snapshots').delete().eq('id', id);
    if (error) throw error;
    toast.success('Quote deleted');
    setQuotes(prev => prev.filter(q => q.id !== id));
  };

  return (
    <div className="space-y-4">
      <ReceivedRfqList inquiryId={inquiryId} />

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b">
            <div className="text-sm font-semibold">Quotes sent</div>
          </div>
          {quotes.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">No quotes yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Quote #</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">SKUs</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map(q => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs">{q.quote_number ?? q.id.slice(0, 8)}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[q.status ?? 'draft'] ?? ''} variant="secondary">{q.status ?? 'draft'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right">{q.totals?.sku_count ?? '—'}</TableCell>
                    <TableCell className="text-xs text-right">
                      {q.totals?.grand_total ? `$${Number(q.totals.grand_total).toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {q.created_at ? new Date(q.created_at).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1 justify-end">
                        {q.share_token && (
                          <Button asChild size="sm" variant="ghost" className="h-7">
                            <a href={`/quote/${q.share_token}`} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        )}
                        <ConfirmDeleteButton
                          itemLabel={`quote ${q.quote_number ?? q.id.slice(0, 8)}`}
                          description={`This permanently removes quote ${q.quote_number ?? q.id.slice(0, 8)} from the database. This cannot be undone.`}
                          onConfirm={() => deleteQuote(q.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
