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
  const [moq, setMoq] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const validInt = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && Number.isInteger(n);
  };

  const apply = async () => {
    const patch: Record<string, number> = {};
    if (qty.trim() !== '') {
      if (!validInt(qty)) { toast.error('Enter a valid non-negative whole number for quantity'); return; }
      patch.quantity = Number(qty);
    }
    if (moq.trim() !== '') {
      if (!validInt(moq)) { toast.error('Enter a valid non-negative whole number for MOQ'); return; }
      patch.moq = Number(moq);
    }
    if (Object.keys(patch).length === 0) { toast.error('Enter a quantity or an MOQ'); return; }

    setSaving(true);
    const { error } = await (supabase as any)
      .from('products')
      .update(patch)
      .in('id', selectedProductIds);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    const fields = Object.keys(patch).map(k => (k === 'moq' ? 'MOQ' : 'quantity')).join(' & ');
    toast.success(`Updated ${fields} on ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'}`);
    setQty('');
    setMoq('');
    onOpenChange(false);
    onApplied();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Bulk update quantity / MOQ</DialogTitle>
          <DialogDescription>
            Set quantity and/or MOQ for {selectedProductIds.length} selected product{selectedProductIds.length === 1 ? '' : 's'}. Leave a field blank to keep it unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
          <div className="space-y-2">
            <Label htmlFor="bulk-moq" className="text-xs">MOQ</Label>
            <Input
              id="bulk-moq"
              type="number"
              min={0}
              step={1}
              value={moq}
              onChange={(e) => setMoq(e.target.value)}
              placeholder="e.g. 50"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={apply} disabled={saving || (!qty.trim() && !moq.trim())}>{saving ? 'Updating…' : 'Apply'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
