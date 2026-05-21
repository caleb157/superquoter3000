import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { npmToMarkup } from '@/lib/calculations';

type ProductLite = { id: string; markup_percent: number | null };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedProducts: ProductLite[];
  onApplied: () => void;
};

export function BulkSetNpmDialog({ open, onOpenChange, selectedProducts, onApplied }: Props) {
  const [npmInput, setNpmInput] = useState('');
  const [overrideExisting, setOverrideExisting] = useState(true);
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) { setNpmInput(''); setOverrideExisting(true); setConfirmOpen(false); }
  }, [open]);

  const npmPct = Number(npmInput);
  const valid = npmInput !== '' && isFinite(npmPct) && npmPct >= 0 && npmPct < 100;
  const markupPct = valid ? npmToMarkup(npmPct / 100) * 100 : 0;

  const targetIds = useMemo(() => {
    if (overrideExisting) return selectedProducts.map(p => p.id);
    return selectedProducts
      .filter(p => !p.markup_percent || p.markup_percent === 0)
      .map(p => p.id);
  }, [selectedProducts, overrideExisting]);

  const doApply = async () => {
    if (!valid) { toast.error('Enter a value between 0 and 99.9'); return; }
    if (targetIds.length === 0) {
      toast.info('No products to update (all selected have NPM already set).');
      return;
    }
    setApplying(true);
    const newMarkup = npmToMarkup(npmPct / 100);
    const { error } = await (supabase as any)
      .from('products')
      .update({ markup_percent: newMarkup, updated_at: new Date().toISOString() })
      .in('id', targetIds);
    setApplying(false);
    if (error) { toast.error('Failed to update: ' + error.message); return; }
    toast.success(
      `Set NPM to ${npmPct.toFixed(1)}% on ${targetIds.length} product${targetIds.length === 1 ? '' : 's'}. ` +
      `Prices refresh next time each product is opened, or when you regenerate the quote.`
    );
    onOpenChange(false);
    onApplied();
  };

  const handleApply = () => {
    if (!valid) return;
    if (selectedProducts.length > 25 && overrideExisting) {
      setConfirmOpen(true);
    } else {
      doApply();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set Net Profit Margin for {selectedProducts.length} products</DialogTitle>
            <DialogDescription>
              Updates the NPM stored on each product. To set a default margin for all future products on this inquiry, edit the inquiry's NPM Override in Inquiry Settings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-npm" className="text-xs">Target NPM (%)</Label>
              <Input
                id="bulk-npm"
                type="number"
                step="0.1"
                min={0}
                max={99.9}
                placeholder="e.g. 20.0"
                value={npmInput}
                onChange={e => setNpmInput(e.target.value)}
                autoFocus
              />
              {valid && (
                <p className="text-[11px] text-muted-foreground">
                  Preview: at {npmPct.toFixed(1)}% margin, the markup multiplier is {markupPct.toFixed(1)}%.
                </p>
              )}
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={overrideExisting}
                onCheckedChange={(v) => setOverrideExisting(!!v)}
                className="mt-0.5"
              />
              <div className="text-xs">
                <div>Override individual product values</div>
                <div className="text-muted-foreground">
                  {overrideExisting
                    ? `Will update all ${selectedProducts.length} selected products.`
                    : `Only updates products with no NPM set yet (${targetIds.length} of ${selectedProducts.length}).`}
                </div>
              </div>
            </label>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
            <Button onClick={handleApply} disabled={applying || !valid}>
              {applying ? 'Applying…' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply NPM of {npmPct.toFixed(1)}% to {targetIds.length} products?</AlertDialogTitle>
            <AlertDialogDescription>
              This will overwrite existing values.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); doApply(); }}>
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
