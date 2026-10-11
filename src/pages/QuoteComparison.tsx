import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { fmt } from '@/lib/formatters';
import { loadCurrencyMap } from '@/lib/currency';
import { computeProductUnitPrices } from '@/lib/product-pricing';
import { referencePriceFor } from '@/components/QuotePriceReviewDialog';
import { compareQuoteToCurrent, type CompareResult, type CompareStatus } from '@/lib/quote-comparison';

type SentQuote = { id: string; quote_number: string | null; sent_at: string; currency: string | null };

const STATUS_LABEL: Record<CompareStatus, string> = {
  matched: '',
  kit: 'Kit: not compared',
  removed: 'Not on inquiry now',
  new: 'Not in quote',
};

const pctText = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : ''}${(p * 100).toFixed(1)}%`);
const tone = (d: number | null) => (d == null || Math.abs(d) < 0.005 ? 'text-muted-foreground' : d > 0 ? 'text-red-600' : 'text-emerald-600');

/** Compares every product's current rate with the latest quote marked sent. */
export default function QuoteComparison() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inquiry, setInquiry] = useState<{ rfq_number: string | null; title: string | null } | null>(null);
  const [quote, setQuote] = useState<SentQuote | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: inq }, { data: q }] = await Promise.all([
          (supabase as any).from('customer_rfqs').select('rfq_number, title').eq('id', id).maybeSingle(),
          (supabase as any).from('quote_snapshots')
            .select('id, quote_number, sent_at, currency, products')
            .eq('customer_rfq_id', id).not('sent_at', 'is', null)
            .order('sent_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        setInquiry(inq ?? null);
        if (!q) { setLoading(false); return; }
        setQuote({ id: q.id, quote_number: q.quote_number, sent_at: q.sent_at, currency: q.currency });
        const currency = q.currency || 'USD';

        const { data: prods } = await (supabase as any).from('products')
          .select('id, name, sku, quantity').eq('customer_rfq_id', id).is('archived_at', null);
        const products = (prods ?? []) as Array<{ id: string; name: string; sku: string | null; quantity: number | null }>;
        // Quote lines may reference products that have since left the inquiry; price those too.
        const quotedIds = ((q.products ?? []) as any[]).map(l => l.product_id).filter(Boolean) as string[];
        const ids = Array.from(new Set([...products.map(p => p.id), ...quotedIds]));
        await loadCurrencyMap();
        const priceMap = ids.length > 0 ? await computeProductUnitPrices(ids) : {};
        const current = products.map(p => ({
          id: p.id, name: p.name, sku: p.sku, quantity: p.quantity,
          current_price: referencePriceFor({ id: p.id, name: p.name }, priceMap, currency),
        }));
        setResult(compareQuoteToCurrent(
          ((q.products ?? []) as any[]).map(l => ({
            product_id: l.product_id ?? null, name: l.name, sku: l.sku ?? null,
            quantity: Number(l.quantity || 0), unit_price_usd: Number(l.unit_price_usd || 0), is_assembly: !!l.is_assembly,
          })),
          current,
        ));
      } catch (e: any) {
        setError(e?.message ?? 'Could not load the comparison');
      }
      setLoading(false);
    })();
  }, [id]);

  const currency = quote?.currency || 'USD';
  const money = (n: number | null) => (n == null ? '—' : fmt.money(n, currency));

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1 -ml-2" onClick={() => navigate(`/inquiry/${id}?tab=quotes`)}>
            <ArrowLeft className="h-4 w-4" /> Back to inquiry
          </Button>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Quote comparison{inquiry?.rfq_number ? ` — ${inquiry.rfq_number}` : ''}</h1>
          <p className="text-sm text-muted-foreground">
            Current rates against the latest sent quote{quote ? <> (<Link className="text-primary hover:underline" to={`/quotes/${quote.id}`}>{quote.quote_number ?? 'quote'}</Link>, sent {new Date(quote.sent_at).toLocaleDateString()}, {currency})</> : ''}.
            Red means the rate is now higher than quoted.
          </p>
        </div>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading…</div>
        ) : error ? (
          <div className="py-12 text-center text-destructive text-sm">{error}</div>
        ) : !quote || !result ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No quote has been marked as sent on this inquiry yet. Tick “sent” on a quote in the Quotes tab, then come back.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Quoted</div>
                <div className="text-lg font-bold tabular-nums">{money(result.totals.quoted)}</div>
              </CardContent></Card>
              <Card><CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">At current rates</div>
                <div className="text-lg font-bold tabular-nums">{money(result.totals.current)}</div>
              </CardContent></Card>
              <Card><CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Change ({result.totals.lines} lines)</div>
                <div className={`text-lg font-bold tabular-nums ${tone(result.totals.delta)}`}>
                  {result.totals.delta > 0 ? '+' : ''}{money(result.totals.delta)} <span className="text-sm">{pctText(result.totals.deltaPct)}</span>
                </div>
              </CardContent></Card>
            </div>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">Quoted</TableHead>
                      <TableHead className="text-xs text-right">Current</TableHead>
                      <TableHead className="text-xs text-right">Change</TableHead>
                      <TableHead className="text-xs text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map(r => (
                      <TableRow key={r.key}>
                        <TableCell className="text-sm">
                          <div className="font-medium">{r.name}</div>
                          <div className="flex items-center gap-2">
                            {r.sku && <span className="text-[11px] text-muted-foreground">{r.sku}</span>}
                            {r.status !== 'matched' && <Badge variant="outline" className="text-[10px]">{STATUS_LABEL[r.status]}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{r.quantity || '—'}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{money(r.quoted)}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{r.current != null && r.current <= 0 ? 'no price' : money(r.current)}</TableCell>
                        <TableCell className={`text-sm text-right tabular-nums ${tone(r.delta)}`}>{r.delta == null ? '—' : `${r.delta > 0 ? '+' : ''}${money(r.delta)}`}</TableCell>
                        <TableCell className={`text-sm text-right tabular-nums ${tone(r.delta)}`}>{pctText(r.deltaPct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              Totals compare matched lines only, at the quoted quantities. Kits, products no longer on the inquiry, and products not in the quote are listed but not totalled.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
