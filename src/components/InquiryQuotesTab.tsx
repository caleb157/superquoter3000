import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ReceivedRfqList } from '@/components/ReceivedRfqList';
import { ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { EditQuoteLinesDialog } from '@/components/EditQuoteLinesDialog';
import { toast } from 'sonner';


function toDateInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayInput(): string {
  return toDateInput(new Date().toISOString());
}

// Store a date-only value as noon local time so timezone shifts never move the day.
function dateInputToIso(v: string): string | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0).toISOString();
}

type Quote = {
  id: string; quote_number: string | null; status: string | null;
  totals: any; created_at: string | null; sent_at: string | null; share_token: string | null;
  incoterm: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-purple-100 text-purple-700',
  approved: 'bg-emerald-100 text-emerald-700',
};

export function InquiryQuotesTab({ inquiryId, refreshKey }: { inquiryId: string; refreshKey: number }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [editSnap, setEditSnap] = useState<any | null>(null);

  const openEdit = async (id: string) => {
    const { data, error } = await (supabase as any).from('quote_snapshots').select('*').eq('id', id).maybeSingle();
    if (error || !data) { toast.error(error?.message || 'Quote not found'); return; }
    setEditSnap(data);
  };


  const load = async () => {
    const { data } = await (supabase as any)
      .from('quote_snapshots')
      .select('id, quote_number, status, totals, created_at, sent_at, share_token, incoterm')
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

  const updateSentAt = async (id: string, dateValue: string, successMsg = 'Sent date updated') => {
    const iso = dateInputToIso(dateValue);
    const patch: any = { sent_at: iso };
    const q = quotes.find(x => x.id === id);
    if (iso && q && (q.status === 'draft' || !q.status)) patch.status = 'sent';
    if (!iso && q && q.status === 'sent') patch.status = 'draft';
    const { error } = await (supabase as any).from('quote_snapshots').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setQuotes(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
    toast.success(successMsg);
  };

  const toggleSent = (q: Quote, checked: boolean) => {
    if (checked) updateSentAt(q.id, todayInput(), 'Marked as sent');
    else updateSentAt(q.id, '', 'Marked as not sent');
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
                  <TableHead className="text-xs">Incoterm</TableHead>
                  <TableHead className="text-xs text-right">SKUs</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="text-xs">Sent</TableHead>
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
                    <TableCell className="text-xs">
                      {q.incoterm ? <Badge variant="outline" className="font-mono text-[10px]">{q.incoterm}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-right">{q.totals?.sku_count ?? '—'}</TableCell>
                    <TableCell className="text-xs text-right">
                      {q.totals?.grand_total ? `$${Number(q.totals.grand_total).toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {q.created_at ? new Date(q.created_at).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={!!q.sent_at}
                          onCheckedChange={(c) => toggleSent(q, c === true)}
                          aria-label="Mark as sent"
                        />
                        <Input
                          type="date"
                          className="h-7 text-xs w-[140px]"
                          value={q.sent_at ? toDateInput(q.sent_at) : ''}
                          onChange={(e) => updateSentAt(q.id, e.target.value)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(q.id)} title="Edit quote">
                          <Pencil className="h-3 w-3" />
                        </Button>
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

      <EditQuoteLinesDialog
        open={!!editSnap}
        onOpenChange={(o) => !o && setEditSnap(null)}
        snapshot={editSnap}
        onSaved={(patch) => {
          setQuotes(prev => prev.map(q => q.id === patch.id ? { ...q, totals: patch.totals, incoterm: patch.incoterm ?? q.incoterm } : q));
          setEditSnap(prev => prev && prev.id === patch.id ? { ...prev, products: patch.products, totals: patch.totals } : prev);
          load();
        }}
      />
    </div>
  );
}
