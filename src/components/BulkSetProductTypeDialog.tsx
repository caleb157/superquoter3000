import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { recostProduct } from '@/lib/costing-seed';

type ProductType = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedProductIds: string[];
  onApplied: () => void;
};

export function BulkSetProductTypeDialog({ open, onOpenChange, selectedProductIds, onApplied }: Props) {
  const [types, setTypes] = useState<ProductType[]>([]);
  const [value, setValue] = useState<string>('');
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!open) { setValue(''); setProgress(null); return; }
    (async () => {
      const { data, error } = await (supabase as any)
        .from('product_types')
        .select('id, name')
        .order('name');
      if (error) { toast.error('Could not load product types: ' + error.message); return; }
      setTypes((data || []) as ProductType[]);
    })();
  }, [open]);

  const apply = async () => {
    if (selectedProductIds.length === 0 || !value) return;
    setApplying(true);
    const { error } = await (supabase as any)
      .from('products')
      .update({ product_type_id: value, updated_at: new Date().toISOString() })
      .in('id', selectedProductIds);
    if (error) {
      setApplying(false);
      toast.error('Failed to update: ' + error.message);
      return;
    }

    // Recost each so labor/finishing rates tied to product type refresh.
    setProgress({ done: 0, total: selectedProductIds.length });
    let done = 0;
    for (const pid of selectedProductIds) {
      try { await recostProduct(pid); } catch (e) { /* non-blocking */ }
      done += 1;
      setProgress({ done, total: selectedProductIds.length });
    }

    setApplying(false);
    const label = types.find(t => t.id === value)?.name || 'type';
    toast.success(`Set product type to ${label} on ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'}.`);
    onOpenChange(false);
    onApplied();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!applying) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set product type for {selectedProductIds.length} products</DialogTitle>
          <DialogDescription>
            Updates the product type on each selected product and recomputes costing so labor and finishing-chemical defaults reflect the new type.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs">Product type</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger><SelectValue placeholder="Select a product type…" /></SelectTrigger>
            <SelectContent>
              {types.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {progress && (
          <p className="text-[11px] text-muted-foreground">
            Recosting {progress.done} / {progress.total}…
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
          <Button onClick={apply} disabled={applying || !value}>
            {applying ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
