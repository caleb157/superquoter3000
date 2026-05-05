import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { cloneProductToInquiry } from '@/lib/product-clone';

type SourceProduct = {
  id: string;
  name: string;
  sku: string | null;
  updated_at: string | null;
  customer_rfq_id: string | null;
  inquiry: { rfq_number: string; title: string | null; customer: { name: string; company: string | null } | null } | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetInquiryId: string;
  onCopied?: (count: number) => void;
}

export function CopyProductsDialog({ open, onOpenChange, targetInquiryId, onCopied }: Props) {
  const [products, setProducts] = useState<SourceProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelected(new Set());
    setNameOverrides({});
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, sku, updated_at, customer_rfq_id, inquiry:customer_rfqs!products_customer_rfq_id_fkey(rfq_number, title, customer:customers(name, company))')
        .order('updated_at', { ascending: false })
        .limit(500);
      setProducts((data ?? []) as any);
      setLoading(false);
    })();
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(p => p.customer_rfq_id !== targetInquiryId)
      .filter(p => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          (p.inquiry?.rfq_number ?? '').toLowerCase().includes(q) ||
          (p.inquiry?.customer?.name ?? '').toLowerCase().includes(q) ||
          (p.inquiry?.customer?.company ?? '').toLowerCase().includes(q)
        );
      });
  }, [products, search, targetInquiryId]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const handleCopy = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setCopying(true);
    let success = 0;
    for (const id of ids) {
      const newId = await cloneProductToInquiry(id, targetInquiryId, nameOverrides[id]);
      if (newId) success++;
    }
    setCopying(false);
    toast.success(`Copied ${success} product${success === 1 ? '' : 's'}`);
    onOpenChange(false);
    onCopied?.(success);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Copy products from existing inquiries</DialogTitle>
          <DialogDescription>
            Cloned products include costing (COGS, overhead, CBM, shipping). Stages and completion flags reset on the copy.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by product, SKU, inquiry, or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto border rounded-md">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? 'No matches.' : 'No products available to copy.'}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map(p => {
                const isOn = selected.has(p.id);
                return (
                  <li
                    key={p.id}
                    className="flex items-start gap-3 px-3 py-2 hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={isOn}
                      onCheckedChange={(v) => toggle(p.id, !!v)}
                      className="mt-0.5 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm font-medium truncate cursor-pointer"
                        onClick={() => toggle(p.id, !isOn)}
                      >
                        {p.name}
                        {p.sku && <span className="ml-2 text-xs text-muted-foreground">SKU: {p.sku}</span>}
                      </div>
                      <div
                        className="text-xs text-muted-foreground truncate cursor-pointer"
                        onClick={() => toggle(p.id, !isOn)}
                      >
                        {p.inquiry?.rfq_number ?? '—'}
                        {p.inquiry?.customer?.name && <> · {p.inquiry.customer.name}{p.inquiry.customer.company ? ` (${p.inquiry.customer.company})` : ''}</>}
                        {p.updated_at && <> · {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}</>}
                      </div>
                      {isOn && (
                        <Input
                          value={nameOverrides[p.id] ?? p.name}
                          onChange={e => setNameOverrides(prev => ({ ...prev, [p.id]: e.target.value }))}
                          placeholder="Rename for new customer (optional)"
                          className="h-7 mt-1.5 text-xs"
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="flex items-center sm:justify-between gap-2">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={copying}>Cancel</Button>
            <Button size="sm" onClick={handleCopy} disabled={copying || selected.size === 0} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              {copying ? 'Copying…' : `Copy ${selected.size || ''}`.trim()}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
