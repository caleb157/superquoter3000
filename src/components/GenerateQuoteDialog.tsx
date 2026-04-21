import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

type Product = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number | null;
  quote_stage: string | null;
  target_price_usd: number | null;
  markup_percent: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inquiryId: string;
  inquiryNumber?: string;
  onCreated: () => void;
};

const QUOTE_STAGE_LABEL: Record<string, { label: string; cls: string }> = {
  quoting: { label: 'quoting', cls: 'bg-amber-100 text-amber-700' },
  ready_for_quote: { label: 'ready', cls: 'bg-blue-100 text-blue-700' },
  quoted: { label: 'quoted', cls: 'bg-purple-100 text-purple-700' },
};

export function GenerateQuoteDialog({ open, onOpenChange, inquiryId, inquiryNumber, onCreated }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, sku, quantity, quote_stage, target_price_usd, markup_percent')
        .eq('customer_rfq_id', inquiryId)
        .order('name');
      setProducts((data ?? []) as Product[]);
    })();
  }, [open, inquiryId]);

  const allSelected = products.length > 0 && products.every(p => selected.has(p.id));
  const toggleAll = (v: boolean) => setSelected(v ? new Set(products.map(p => p.id)) : new Set());
  const toggleOne = (id: string, v: boolean) => {
    const next = new Set(selected);
    if (v) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const submit = async () => {
    const chosen = products.filter(p => selected.has(p.id));
    if (chosen.length === 0) return;
    setSaving(true);
    const productsJson = chosen.map(p => {
      const unit = Number(p.target_price_usd ?? 0);
      const qty = Number(p.quantity ?? 0);
      return {
        id: p.id, name: p.name, sku: p.sku,
        quantity: qty, unit_price_usd: unit, total: unit * qty,
      };
    });
    const totalQty = productsJson.reduce((s, p) => s + p.quantity, 0);
    const grandTotal = productsJson.reduce((s, p) => s + p.total, 0);

    // Fetch customer for snapshot
    const { data: inq } = await supabase
      .from('customer_rfqs').select('customer_id, customers:customer_id(id, name, company, email)')
      .eq('id', inquiryId).maybeSingle();
    const c: any = (inq as any)?.customers ?? null;
    const customerData = c ? { id: c.id, name: c.name, company: c.company, email: c.email } : null;

    const { error } = await (supabase as any).from('quote_snapshots').insert({
      customer_rfq_id: inquiryId,
      quote_number: 'Q-' + Date.now(),
      status: 'draft',
      share_token: crypto.randomUUID(),
      products: productsJson,
      customer: customerData,
      totals: { sku_count: chosen.length, total_qty: totalQty, grand_total: grandTotal },
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Quote draft created${inquiryNumber ? ' for ' + inquiryNumber : ''}`);
    onCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Quote{inquiryNumber ? ` — ${inquiryNumber}` : ''}</DialogTitle>
          <p className="text-xs text-muted-foreground">Select products to include</p>
        </DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {products.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No products in this inquiry.</div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground border-b">
                <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} />
                <span className="flex-1">Select all / none</span>
              </div>
              {products.map(p => {
                const stage = p.quote_stage ? QUOTE_STAGE_LABEL[p.quote_stage] : null;
                return (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 rounded cursor-pointer">
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggleOne(p.id, !!v)} />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{p.quantity ?? 0}</span>
                    {stage && <Badge variant="secondary" className={`text-[10px] ${stage.cls}`}>{stage.label}</Badge>}
                  </label>
                );
              })}
            </>
          )}
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={selected.size === 0 || saving}>
              {saving ? 'Creating…' : 'Create Quote Draft'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
