import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { fmt } from '@/lib/formatters';
import { computeProductPriceAndCost } from '@/lib/product-pricing';

type Inquiry = { id: string; rfq_number: string; title: string | null };
type Product = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number | null;
  target_price_usd: number | null;
  markup_percent: number | null;
};

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export default function InquiryTargetGrid() {
  const { id: inquiryId } = useParams<{ id: string }>();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [calcPrices, setCalcPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useDocumentTitle(inquiry ? `Target grid · ${inquiry.rfq_number}` : 'Target grid');

  const load = useCallback(async () => {
    if (!inquiryId) return;
    setLoading(true);
    const [inqRes, prodRes] = await Promise.all([
      supabase.from('customer_rfqs').select('id, rfq_number, title').eq('id', inquiryId).single(),
      supabase
        .from('products')
        .select('id, name, sku, quantity, target_price_usd, markup_percent')
        .eq('customer_rfq_id', inquiryId)
        .order('created_at', { ascending: true }),
    ]);
    if (inqRes.error) toast.error(inqRes.error.message);
    else setInquiry(inqRes.data as any);
    const list = (prodRes.data || []) as Product[];
    setProducts(list);
    setDrafts(Object.fromEntries(list.map(p => [p.id, p.target_price_usd == null ? '' : String(p.target_price_usd)])));
    // Live calculated prices for reference
    if (list.length) {
      const map = await computeProductPriceAndCost(list.map(p => p.id));
      const out: Record<string, number> = {};
      for (const p of list) out[p.id] = map[p.id]?.unit_price_usd ?? 0;
      setCalcPrices(out);
    }
    setLoading(false);
  }, [inquiryId]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    const changed: { id: string; value: number | null }[] = [];
    for (const p of products) {
      const raw = drafts[p.id] ?? '';
      const parsed = raw === '' ? null : parseNumber(raw);
      const current = p.target_price_usd == null ? null : Number(p.target_price_usd);
      if (parsed !== current) changed.push({ id: p.id, value: parsed });
    }
    return changed;
  }, [products, drafts]);

  const saveAll = async () => {
    if (dirty.length === 0) { toast.info('No changes'); return; }
    setSaving(true);
    const ts = new Date().toISOString();
    let ok = 0; let fail = 0;
    for (const row of dirty) {
      const { error } = await (supabase as any)
        .from('products')
        .update({ target_price_usd: row.value, updated_at: ts })
        .eq('id', row.id);
      if (error) fail++; else ok++;
    }
    setSaving(false);
    if (fail) toast.error(`${fail} row${fail === 1 ? '' : 's'} failed. ${ok} saved.`);
    else toast.success(`Saved ${ok} target price${ok === 1 ? '' : 's'}.`);
    load();
  };

  // Excel-style paste: paste a column of numbers starting at the focused row
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const handlePaste = (startIdx: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\n') && !text.includes('\t')) return; // let single-value paste be default
    e.preventDefault();
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(r => r.split('\t')[0]);
    setDrafts(d => {
      const next = { ...d };
      for (let i = 0; i < rows.length && startIdx + i < products.length; i++) {
        const p = products[startIdx + i];
        const parsed = parseNumber(rows[i]);
        next[p.id] = parsed == null ? '' : String(parsed);
      }
      return next;
    });
  };

  const fillFromCalc = () => {
    setDrafts(d => {
      const next = { ...d };
      for (const p of products) {
        const calc = calcPrices[p.id];
        if (calc && calc > 0) next[p.id] = calc.toFixed(2);
      }
      return next;
    });
    toast.success('Filled from calculated unit price. Review and Save.');
  };

  const clearAll = () => {
    setDrafts(Object.fromEntries(products.map(p => [p.id, ''])));
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
        <PageBreadcrumbs
          items={[
            { label: 'Inquiries', to: '/' },
            { label: inquiry?.rfq_number || 'Inquiry', to: `/inquiry/${inquiryId}` },
            { label: 'Target grid' },
          ]}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/inquiry/${inquiryId}`}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Target price grid</h1>
            <p className="text-xs text-muted-foreground">
              Bulk edit customer-facing target prices (USD) for every product in this inquiry.
              Paste a column from a spreadsheet to fill multiple rows at once.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={fillFromCalc} disabled={loading || products.length === 0}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Fill from calculated
          </Button>
          <Button size="sm" variant="outline" onClick={clearAll} disabled={loading || products.length === 0}>
            Clear all
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving || loading || dirty.length === 0}>
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? 'Saving…' : dirty.length > 0 ? `Save ${dirty.length}` : 'Save'}
          </Button>
        </div>

        <div className="border rounded-md overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left p-2 font-medium w-10">#</th>
                <th className="text-left p-2 font-medium">Product</th>
                <th className="text-left p-2 font-medium w-28">SKU</th>
                <th className="text-right p-2 font-medium w-20">Qty</th>
                <th className="text-right p-2 font-medium w-32">Calculated (USD)</th>
                <th className="text-right p-2 font-medium w-40">Target price (USD)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No products in this inquiry.</td></tr>
              ) : products.map((p, idx) => {
                const raw = drafts[p.id] ?? '';
                const parsed = raw === '' ? null : parseNumber(raw);
                const current = p.target_price_usd == null ? null : Number(p.target_price_usd);
                const isDirty = parsed !== current;
                const calc = calcPrices[p.id];
                return (
                  <tr key={p.id} className={cn('border-t hover:bg-muted/30', isDirty && 'bg-amber-50 dark:bg-amber-950/20')}>
                    <td className="p-2 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="p-2">
                      <Link to={`/product/${p.id}`} className="hover:underline">{p.name}</Link>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{p.sku || '—'}</td>
                    <td className="p-2 text-right tabular-nums">{p.quantity ?? '—'}</td>
                    <td className="p-2 text-right tabular-nums text-muted-foreground">
                      {calc && calc > 0 ? `$${fmt(calc, 2)}` : '—'}
                    </td>
                    <td className="p-2">
                      <Input
                        ref={el => { inputRefs.current[p.id] = el; }}
                        type="text"
                        inputMode="decimal"
                        className="h-8 text-right tabular-nums"
                        placeholder="—"
                        value={raw}
                        onChange={e => setDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                        onPaste={handlePaste(idx)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {dirty.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {dirty.length} unsaved change{dirty.length === 1 ? '' : 's'}. Click Save to persist.
          </div>
        )}
      </div>
    </AppLayout>
  );
}
