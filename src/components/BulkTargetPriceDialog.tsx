import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type ProductLite = { id: string; target_price_usd: number | null };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedProducts: ProductLite[];
  onApplied: () => void;
};

export function BulkTargetPriceDialog({ open, onOpenChange, selectedProducts, onApplied }: Props) {
  const [priceInput, setPriceInput] = useState('');
  const [overrideExisting, setOverrideExisting] = useState(true);
  const [clearMode, setClearMode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setPriceInput(''); setOverrideExisting(true); setClearMode(false); }
  }, [open]);

  const price = Number(priceInput);
  const valid = clearMode || (priceInput !== '' && isFinite(price) && price >= 0);

  const targetIds = overrideExisting
    ? selectedProducts.map(p => p.id)
    : selectedProducts.filter(p => p.target_price_usd == null || p.target_price_usd === 0).map(p => p.id);

  const apply = async () => {
    if (!valid) { toast.error('Enter a valid non-negative number'); return; }
    if (targetIds.length === 0) { toast.info('No products to update.'); return; }
    setSaving(true);
    const value = clearMode ? null : price;
    const { error } = await (supabase as any)
      .from('products')
      .update({ target_price_usd: value, updated_at: new Date().toISOString() })
      .in('id', targetIds);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(
      clearMode
        ? `Cleared target price on ${targetIds.length} product${targetIds.length === 1 ? '' : 's'}.`
        : `Set target price to $${price.toFixed(2)} on ${targetIds.length} product${targetIds.length === 1 ? '' : 's'}.`
    );
    onOpenChange(false);
    onApplied();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set target price for {selectedProducts.length} products</DialogTitle>
          <DialogDescription>
            Updates <code>target_price_usd</code> on each selected product. This is the customer-facing target, not the calculated cost.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-tp" className="text-xs">Target price (USD)</Label>
            <Input
              id="bulk-tp"
              type="number"
              step="0.01"
              min={0}
              placeholder="e.g. 49.99"
              value={priceInput}
              onChange={e => setPriceInput(e.target.value)}
              disabled={clearMode}
              autoFocus
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox checked={clearMode} onCheckedChange={(v) => setClearMode(!!v)} className="mt-0.5" />
            <div className="text-xs">
              <div>Clear target price instead</div>
              <div className="text-muted-foreground">Sets target price to empty on the selected products.</div>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox
              checked={overrideExisting}
              onCheckedChange={(v) => setOverrideExisting(!!v)}
              className="mt-0.5"
            />
            <div className="text-xs">
              <div>Override existing values</div>
              <div className="text-muted-foreground">
                {overrideExisting
                  ? `Will update all ${selectedProducts.length} selected products.`
                  : `Only updates products with no target price yet (${targetIds.length} of ${selectedProducts.length}).`}
              </div>
            </div>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={apply} disabled={saving || !valid}>{saving ? 'Applying…' : 'Apply'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
