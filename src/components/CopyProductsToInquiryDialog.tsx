import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Copy, Plus, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { cloneProductToInquiry, cloneAssembliesForProducts } from '@/lib/product-clone';

type Inquiry = {
  id: string;
  rfq_number: string;
  title: string | null;
  status: string;
  updated_at: string | null;
  customer: { name: string; company: string | null } | null;
};

type SourceProduct = { id: string; name: string; notes: string | null };

type VariantRow = {
  sourceId: string;
  sourceName: string;
  copyIndex: number; // 1-based, per source product
  name: string;
  notes: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The inquiry the products currently belong to. */
  sourceInquiryId: string;
  /** Products to copy. */
  productIds: string[];
  productNames?: string[];
  onCopied?: (count: number, targetInquiryId: string) => void;
}

export function CopyProductsToInquiryDialog({
  open, onOpenChange, sourceInquiryId, productIds, productNames = [], onCopied,
}: Props) {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [includeAssemblies, setIncludeAssemblies] = useState(true);
  const [assemblyCount, setAssemblyCount] = useState(0);
  const [copiesPerProduct, setCopiesPerProduct] = useState(1);
  const [sourceProducts, setSourceProducts] = useState<SourceProduct[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);

  const isSameInquiry = targetId === sourceInquiryId;

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setTargetId(null);
    setCopiesPerProduct(1);
    setSourceProducts([]);
    setVariants([]);
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('customer_rfqs')
        .select('id, rfq_number, title, status, updated_at, customer:customers(name, company)')
        .in('status', ['active', 'paused'])
        .order('updated_at', { ascending: false })
        .limit(300);
      setInquiries((data ?? []) as any);
      setLoading(false);
    })();
  }, [open]);

  // Count assemblies referencing the selected products.
  useEffect(() => {
    if (!open || productIds.length === 0) { setAssemblyCount(0); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from('assembly_components')
        .select('assembly_id')
        .in('product_id', productIds);
      const ids = new Set((data ?? []).map((r: any) => r.assembly_id));
      setAssemblyCount(ids.size);
    })();
  }, [open, productIds]);

  // Fetch source product name/notes for all selected products (used when same-inquiry).
  useEffect(() => {
    if (!open || productIds.length === 0) { setSourceProducts([]); return; }
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, notes')
        .in('id', productIds);
      setSourceProducts((data ?? []) as SourceProduct[]);
    })();
  }, [open, productIds]);

  // Rebuild variant rows whenever same-inquiry mode, copy count, or sources change.
  useEffect(() => {
    if (!isSameInquiry || sourceProducts.length === 0) {
      setVariants([]);
      return;
    }
    const ordered = productIds
      .map(id => sourceProducts.find(p => p.id === id))
      .filter((p): p is SourceProduct => !!p);
    const rows: VariantRow[] = [];
    for (const sp of ordered) {
      for (let i = 1; i <= Math.max(1, copiesPerProduct); i++) {
        const suffix = copiesPerProduct === 1 ? '(variant)' : `(variant ${i})`;
        rows.push({
          sourceId: sp.id,
          sourceName: sp.name,
          copyIndex: i,
          name: `${sp.name} ${suffix}`,
          notes: sp.notes ?? '',
        });
      }
    }
    setVariants(rows);
  }, [isSameInquiry, copiesPerProduct, sourceProducts, productIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...inquiries].sort((a, b) => {
      if (a.id === sourceInquiryId) return -1;
      if (b.id === sourceInquiryId) return 1;
      return 0;
    });
    return sorted.filter(i => {
      if (!q) return true;
      return (
        i.rfq_number.toLowerCase().includes(q) ||
        (i.title ?? '').toLowerCase().includes(q) ||
        (i.customer?.name ?? '').toLowerCase().includes(q) ||
        (i.customer?.company ?? '').toLowerCase().includes(q)
      );
    });
  }, [inquiries, search, sourceInquiryId]);

  const updateVariant = (idx: number, patch: Partial<VariantRow>) => {
    setVariants(v => v.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const totalCopies = isSameInquiry
    ? productIds.length * Math.max(1, copiesPerProduct)
    : productIds.length;

  const handleCopy = async () => {
    if (!targetId || productIds.length === 0) return;
    setCopying(true);
    let success = 0;
    const idMap: Record<string, string> = {};

    if (isSameInquiry) {
      for (const v of variants) {
        const newId = await cloneProductToInquiry(v.sourceId, targetId, v.name, v.notes);
        if (newId) { success++; idMap[v.sourceId] = newId; }
      }
    } else {
      for (const id of productIds) {
        const newId = await cloneProductToInquiry(id, targetId);
        if (newId) { success++; idMap[id] = newId; }
      }
    }

    let asmCloned = 0;
    if (includeAssemblies && assemblyCount > 0 && !isSameInquiry) {
      asmCloned = await cloneAssembliesForProducts(productIds, targetId, idMap);
    }
    setCopying(false);
    const asmMsg = asmCloned > 0 ? ` and ${asmCloned} assembl${asmCloned === 1 ? 'y' : 'ies'}` : '';
    toast.success(`Copied ${success} product${success === 1 ? '' : 's'}${asmMsg} to inquiry`);
    onOpenChange(false);
    onCopied?.(success, targetId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Copy {productIds.length} product{productIds.length === 1 ? '' : 's'} to an inquiry</DialogTitle>
          <DialogDescription>
            Variants, COGS, overhead, CBM, and shipping are cloned and re-linked.
            Stages and completion flags reset on the copies.
          </DialogDescription>
        </DialogHeader>

        {productNames.length > 0 && (
          <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 max-h-20 overflow-y-auto">
            {productNames.join(', ')}
          </div>
        )}

        {assemblyCount > 0 && !isSameInquiry && (
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <Checkbox
              checked={includeAssemblies}
              onCheckedChange={(v) => setIncludeAssemblies(!!v)}
            />
            <span>
              Also copy <strong>{assemblyCount}</strong> assembl{assemblyCount === 1 ? 'y' : 'ies'} that reference{assemblyCount === 1 ? 's' : ''} the selected product{productIds.length === 1 ? '' : 's'}
            </span>
          </label>
        )}

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search inquiry by number, title, or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto border rounded-md min-h-[120px]">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? 'No matches.' : 'No inquiries available.'}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map(i => {
                const on = targetId === i.id;
                return (
                  <li
                    key={i.id}
                    className={cn(
                      'flex items-start gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer',
                      on && 'bg-primary/10',
                    )}
                    onClick={() => setTargetId(i.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {i.rfq_number}
                        {i.id === sourceInquiryId && (
                          <span className="ml-2 text-xs text-primary font-normal">(this inquiry — duplicate as variant)</span>
                        )}
                        {i.title && <span className="ml-2 text-muted-foreground font-normal">· {i.title}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {i.customer?.name ?? '—'}{i.customer?.company ? ` (${i.customer.company})` : ''}
                        {i.updated_at && <> · {formatDistanceToNow(new Date(i.updated_at), { addSuffix: true })}</>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {isSameInquiry && (
          <div className="space-y-3 border rounded-md p-3 bg-muted/30">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-muted-foreground">
                Variant details ({totalCopies} cop{totalCopies === 1 ? 'y' : 'ies'} total)
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Copies per product</span>
                <Button
                  type="button" variant="outline" size="icon" className="h-7 w-7"
                  onClick={() => setCopiesPerProduct(c => Math.max(1, c - 1))}
                  disabled={copiesPerProduct <= 1}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <Input
                  type="number" min={1} max={50}
                  value={copiesPerProduct}
                  onChange={e => setCopiesPerProduct(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="h-7 w-14 text-center"
                />
                <Button
                  type="button" variant="outline" size="icon" className="h-7 w-7"
                  onClick={() => setCopiesPerProduct(c => Math.min(50, c + 1))}
                  disabled={copiesPerProduct >= 50}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
              {variants.map((v, idx) => (
                <div key={`${v.sourceId}-${v.copyIndex}`} className="space-y-1.5 border-t pt-2 first:border-t-0 first:pt-0">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    From: {v.sourceName}{copiesPerProduct > 1 ? ` · #${v.copyIndex}` : ''}
                  </div>
                  <Input
                    value={v.name}
                    onChange={e => updateVariant(idx, { name: e.target.value })}
                    placeholder="Variant name"
                    className="h-8"
                  />
                  <textarea
                    value={v.notes}
                    onChange={e => updateVariant(idx, { notes: e.target.value })}
                    rows={2}
                    placeholder="Notes (optional)"
                    className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center sm:justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {targetId ? `Will create ${totalCopies} cop${totalCopies === 1 ? 'y' : 'ies'}` : 'Select a target inquiry'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={copying}>Cancel</Button>
            <Button size="sm" onClick={handleCopy} disabled={copying || !targetId} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              {copying ? 'Copying…' : 'Copy'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
