import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Copy } from 'lucide-react';
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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The inquiry the products currently belong to — excluded from target list. */
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

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setTargetId(null);
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

  // Count assemblies referencing the selected products so we can show it on the toggle.
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inquiries
      .filter(i => i.id !== sourceInquiryId)
      .filter(i => {
        if (!q) return true;
        return (
          i.rfq_number.toLowerCase().includes(q) ||
          (i.title ?? '').toLowerCase().includes(q) ||
          (i.customer?.name ?? '').toLowerCase().includes(q) ||
          (i.customer?.company ?? '').toLowerCase().includes(q)
        );
      });
  }, [inquiries, search, sourceInquiryId]);

  const handleCopy = async () => {
    if (!targetId || productIds.length === 0) return;
    setCopying(true);
    let success = 0;
    for (const id of productIds) {
      const newId = await cloneProductToInquiry(id, targetId);
      if (newId) success++;
    }
    setCopying(false);
    toast.success(`Copied ${success} product${success === 1 ? '' : 's'} to inquiry`);
    onOpenChange(false);
    onCopied?.(success, targetId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Copy {productIds.length} product{productIds.length === 1 ? '' : 's'} to another inquiry</DialogTitle>
          <DialogDescription>
            Variants, COGS, overhead, CBM, and shipping are cloned and re-linked to the target inquiry.
            Stages and completion flags reset on the copies.
          </DialogDescription>
        </DialogHeader>

        {productNames.length > 0 && (
          <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 max-h-20 overflow-y-auto">
            {productNames.join(', ')}
          </div>
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

        <div className="flex-1 overflow-y-auto border rounded-md">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? 'No matches.' : 'No other inquiries available.'}
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

        <DialogFooter className="flex items-center sm:justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {targetId ? '1 inquiry selected' : 'Select a target inquiry'}
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
