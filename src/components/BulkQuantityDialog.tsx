import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedProductIds: string[];
  onApplied: () => void;
};

export function BulkQuantityDialog({ open, onOpenChange, selectedProductIds, onApplied }: Props) {
  const [qty, setQty] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const apply = async () => {
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      toast.error('Enter a valid non-negative whole number');
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any)
      .from('products')
      .update({ quantity: n })
      .in('id', selectedProductIds);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Updated quantity on ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'}`);
    setQty('');
    onOpenChange(false);
    onApplied();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Bulk update quantity</DialogTitle>
          <DialogDescription>
            Set the same quantity for {selectedProductIds.length} selected product{selectedProductIds.length === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="bulk-qty" className="text-xs">Quantity</Label>
          <Input
            id="bulk-qty"
            type="number"
            min={0}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="e.g. 100"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={apply} disabled={saving || !qty}>{saving ? 'Updating…' : 'Apply'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
