import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { updateQuoteLineItems } from '@/lib/quote-creation';

type SnapshotLine = {
  product_id?: string | null;
  name: string;
  sku?: string | null;
  photo_url?: string | null;
  quantity: number;
  unit_price_usd: number; // already in display currency
  unit_cbm?: number | null;
  width_inch?: number | null;
  depth_inch?: number | null;
  height_inch?: number | null;
  weight_kg?: number | null;
  moq?: number | null;
  variant_id?: string | null;
  variant_name?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: any | null;
  onSaved: () => void;
};

export function EditQuoteLinesDialog({ open, onOpenChange, snapshot, onSaved }: Props) {
  const [lines, setLines] = useState<Array<SnapshotLine & { _key: string }>>([]);
  const [saving, setSaving] = useState(false);

  const currency: 'USD' | 'INR' = snapshot?.currency === 'INR' ? 'INR' : 'USD';
  const sym = currency === 'INR' ? '₹' : '$';
  const fmtMoney = (n: number) => `${sym}${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    if (!open || !snapshot) return;
    const initial: SnapshotLine[] = (snapshot.products || []) as SnapshotLine[];
    setLines(initial.map((l, i) => ({ ...l, _key: `line-${i}-${l.product_id || 'x'}` })));
  }, [open, snapshot]);

  const totals = useMemo(() => {
    const qty = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
    const grand = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price_usd || 0), 0);
    return { qty, grand };
  }, [lines]);

  const update = (key: string, patch: Partial<SnapshotLine>) => {
    setLines(prev => prev.map(l => l._key === key ? { ...l, ...patch } : l));
  };

  const removeLine = (key: string) => setLines(prev => prev.filter(l => l._key !== key));

  const handleSave = async () => {
    if (!snapshot) return;
    setSaving(true);
    const payload = lines.map(({ _key, ...rest }) => rest);
    const { error } = await updateQuoteLineItems(snapshot.id, payload);
    setSaving(false);
    if (error) { toast.error(error); return; }
    toast.success('Quote updated');
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit quote line items</DialogTitle>
          <DialogDescription>
            Adjust the name, quantity, or unit price for each line. Totals will be recalculated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {lines.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">No line items.</div>
          ) : lines.map(line => (
            <div key={line._key} className="grid grid-cols-12 gap-2 items-end rounded-md border p-2 bg-card">
              <div className="col-span-5">
                <Label className="text-[10px] text-muted-foreground">Display name</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={line.name}
                    onChange={e => update(line._key, { name: e.target.value })}
                    className="h-8 text-xs"
                  />
                  {line.variant_name && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">{line.variant_name}</Badge>
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] text-muted-foreground">Qty</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={e => update(line._key, { quantity: Number(e.target.value) })}
                  className="h-8 text-xs text-right"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-[10px] text-muted-foreground">Unit price ({currency})</Label>
                <Input
                  type="number"
                  step="any"
                  value={line.unit_price_usd}
                  onChange={e => update(line._key, { unit_price_usd: Number(e.target.value) })}
                  className="h-8 text-xs text-right"
                />
              </div>
              <div className="col-span-2 flex items-center justify-end gap-2 pb-0.5">
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {fmtMoney(Number(line.quantity || 0) * Number(line.unit_price_usd || 0))}
                </span>
                <Button
                  type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                  title="Remove line"
                  onClick={() => removeLine(line._key)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {lines.length} line{lines.length === 1 ? '' : 's'} · {totals.qty.toLocaleString()} units · <span className="font-semibold text-foreground">{fmtMoney(totals.grand)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || lines.length === 0}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
