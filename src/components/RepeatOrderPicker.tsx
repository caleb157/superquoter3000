import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X, Repeat, Package } from 'lucide-react';
import { customerFullLabel } from '@/lib/customer-name';
import type { RepeatPick } from '@/lib/repeat-order';

type PastInquiry = {
  id: string; rfq_number: string; title: string | null; customer_id: string | null; created_at: string;
  customer: { name: string; company: string | null } | null;
};
type PastProduct = { id: string; name: string; sku: string | null; customer_rfq_id: string | null };
export type PickedProduct = RepeatPick & { name: string; sku: string | null };

/** Search past inquiries or products; picking an inquiry adds all of its products. */
export function RepeatOrderPicker({ customerId, picked, onChange, onSourcePicked }: {
  customerId: string;
  picked: PickedProduct[];
  onChange: (p: PickedProduct[]) => void;
  /** First pick: lets the dialog fill in an empty customer and title from the repeated inquiry. */
  onSourcePicked?: (inq: PastInquiry) => void;
}) {
  const [inquiries, setInquiries] = useState<PastInquiry[]>([]);
  const [products, setProducts] = useState<PastProduct[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data: inq }, { data: prod }] = await Promise.all([
        supabase.from('customer_rfqs').select('id, rfq_number, title, customer_id, created_at, customer:customers(name, company)')
          .order('created_at', { ascending: false }).limit(1000),
        supabase.from('products').select('id, name, sku, customer_rfq_id').not('customer_rfq_id', 'is', null)
          .order('updated_at', { ascending: false }).limit(2000),
      ]);
      setInquiries((inq ?? []) as any);
      setProducts((prod ?? []) as any);
    })();
  }, []);

  const inqById = useMemo(() => new Map(inquiries.map(i => [i.id, i])), [inquiries]);
  const productCount = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach(p => p.customer_rfq_id && m.set(p.customer_rfq_id, (m.get(p.customer_rfq_id) ?? 0) + 1));
    return m;
  }, [products]);
  const pickedIds = useMemo(() => new Set(picked.map(p => p.productId)), [picked]);

  const q = search.trim().toLowerCase();
  const inqMatches = useMemo(() => {
    const withProducts = inquiries.filter(i => productCount.has(i.id));
    const list = q
      ? withProducts.filter(i => [i.rfq_number, i.title, i.customer?.name, i.customer?.company].some(s => (s ?? '').toLowerCase().includes(q)))
      : withProducts.filter(i => customerId && i.customer_id === customerId);
    return list.slice(0, 6);
  }, [inquiries, productCount, q, customerId]);
  const prodMatches = useMemo(() => (q
    ? products.filter(p => !pickedIds.has(p.id) && (p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))).slice(0, 12)
    : []), [products, q, pickedIds]);

  const add = (rows: PastProduct[]) => {
    const fresh = rows.filter(r => !pickedIds.has(r.id));
    if (!fresh.length) return;
    if (picked.length === 0) {
      const src = fresh[0].customer_rfq_id ? inqById.get(fresh[0].customer_rfq_id) : undefined;
      if (src) onSourcePicked?.(src);
    }
    onChange([...picked, ...fresh.map(r => ({ productId: r.id, inquiryId: r.customer_rfq_id, name: r.name, sku: r.sku }))]);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9"
          placeholder="Search past inquiries, products or SKUs…" />
      </div>

      {(inqMatches.length > 0 || prodMatches.length > 0) && (
        <ul className="max-h-48 overflow-y-auto rounded-md border divide-y text-sm">
          {inqMatches.map(i => (
            <li key={i.id}>
              <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50"
                onClick={() => add(products.filter(p => p.customer_rfq_id === i.id))}>
                <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{i.rfq_number}</span>{i.title ? ` · ${i.title}` : ''}
                  {i.customer && <span className="text-muted-foreground"> · {customerFullLabel(i.customer)}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">all {productCount.get(i.id)} products</span>
              </button>
            </li>
          ))}
          {prodMatches.map(p => {
            const inq = p.customer_rfq_id ? inqById.get(p.customer_rfq_id) : undefined;
            return (
              <li key={p.id}>
                <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50" onClick={() => add([p])}>
                  <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{p.name}{p.sku && <span className="text-muted-foreground"> · {p.sku}</span>}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{inq?.rfq_number ?? ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!q && inqMatches.length === 0 && (
        <p className="text-[11px] text-muted-foreground">{customerId ? "This customer's past inquiries show here; search to find others." : 'Search, or pick a customer to see their past inquiries.'}</p>
      )}

      {picked.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium">{picked.length} product{picked.length === 1 ? '' : 's'} to copy at today's costs</span>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onChange([])}>Clear</Button>
          </div>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
            {picked.map(p => (
              <li key={p.productId} className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">{p.name}{p.sku && <span className="text-muted-foreground"> · {p.sku}</span>}</span>
                <span className="shrink-0 text-muted-foreground">{p.inquiryId ? inqById.get(p.inquiryId)?.rfq_number : ''}</span>
                <button type="button" aria-label={`Remove ${p.name}`} className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onChange(picked.filter(x => x.productId !== p.productId))}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Repeat of CRFQ-…" under an inquiry's title, linking to the inquiry it repeats. */
export function RepeatOfLink({ inquiryId }: { inquiryId: string | null | undefined }) {
  const [src, setSrc] = useState<{ rfq_number: string; title: string | null } | null>(null);
  useEffect(() => {
    if (!inquiryId) { setSrc(null); return; }
    supabase.from('customer_rfqs').select('rfq_number, title').eq('id', inquiryId).maybeSingle()
      .then(({ data }) => setSrc((data as any) ?? null));
  }, [inquiryId]);
  if (!inquiryId || !src) return null;
  return (
    <Link to={`/inquiry/${inquiryId}`} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
      <Repeat className="h-3 w-3" /> Repeat of {src.rfq_number}{src.title ? ` · ${src.title}` : ''}
    </Link>
  );
}
