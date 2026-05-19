import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { updateQuoteLineItems } from '@/lib/quote-creation';
import { fmt } from '@/lib/formatters';

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

type SavedPatch = {
  id: string;
  products: any[];
  totals: { sku_count: number; total_qty: number; grand_total: number; total_cbm: number };
  payment_terms?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: any | null;
  // onSaved receives an optimistic patch so the parent can merge it into local state
  // immediately, without waiting on a refetch.
  onSaved: (patch: SavedPatch) => void;
};

type Status = 'idle' | 'saving' | 'saved' | 'error';

export function EditQuoteLinesDialog({ open, onOpenChange, snapshot, onSaved }: Props) {
  const [lines, setLines] = useState<Array<SnapshotLine & { _key: string }>>([]);
  const [paymentTerms, setPaymentTerms] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const initialSerialRef = useRef<string>('');
  const initialPaymentTermsRef = useRef<string>('');
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currency: string = snapshot?.currency || 'USD';
  const fmtMoney = (n: number) => fmt.money(n, currency);

  // Load lines + reset transient state whenever the dialog opens for a new snapshot.
  useEffect(() => {
    if (!open || !snapshot) return;
    const initial: SnapshotLine[] = (snapshot.products || []) as SnapshotLine[];
    const seeded = initial.map((l, i) => ({ ...l, _key: `line-${i}-${l.product_id || 'x'}` }));
    setLines(seeded);
    initialSerialRef.current = JSON.stringify(serializeLines(seeded));
    const pt = (snapshot.payment_terms ?? '') as string;
    setPaymentTerms(pt);
    initialPaymentTermsRef.current = pt;
    setStatus('idle');
    setErrorMsg(null);
  }, [open, snapshot]);

  // Cancel a pending auto-close if the user reopens or unmounts.
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const totals = useMemo(() => {
    const qty = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
    const grand = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price_usd || 0), 0);
    const cbm = lines.reduce((s, l) => s + Number(l.unit_cbm || 0) * Number(l.quantity || 0), 0);
    return { qty, grand, cbm, sku: lines.length };
  }, [lines]);

  const dirty = useMemo(
    () => JSON.stringify(serializeLines(lines)) !== initialSerialRef.current
      || paymentTerms !== initialPaymentTermsRef.current,
    [lines, paymentTerms],
  );

  const update = (key: string, patch: Partial<SnapshotLine>) => {
    setLines(prev => prev.map(l => l._key === key ? { ...l, ...patch } : l));
    if (status !== 'idle' && status !== 'saving') setStatus('idle');
  };

  const removeLine = (key: string) => {
    setLines(prev => prev.filter(l => l._key !== key));
    if (status !== 'idle' && status !== 'saving') setStatus('idle');
  };

  const handleSave = async () => {
    if (!snapshot || !dirty || status === 'saving') return;
    setStatus('saving');
    setErrorMsg(null);

    const payload = lines.map(({ _key, ...rest }) => rest);
    const result = await updateQuoteLineItems(snapshot.id, payload, { payment_terms: paymentTerms });

    if (result.error) {
      setStatus('error');
      setErrorMsg(result.error);
      toast.error(`Save failed: ${result.error}`);
      return;
    }

    // Re-baseline so further edits are detected as dirty again.
    initialSerialRef.current = JSON.stringify(serializeLines(lines));
    initialPaymentTermsRef.current = paymentTerms;
    setStatus('saved');
    toast.success('Quote updated');

    // Push the optimistic patch up so the Quotes list reflects new totals immediately.
    onSaved({
      id: snapshot.id,
      products: result.products ?? payload,
      totals: result.totals ?? {
        sku_count: payload.length,
        total_qty: totals.qty,
        grand_total: totals.grand,
        total_cbm: totals.cbm,
      },
      payment_terms: result.payment_terms ?? (paymentTerms.trim() || null),
    });

    closeTimerRef.current = setTimeout(() => onOpenChange(false), 700);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && status === 'saving') return; // block close while in-flight
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onOpenChange(next);
  };

  const saveLabel =
    status === 'saving' ? 'Saving…' :
    status === 'saved' ? 'Saved' :
    dirty ? 'Save changes' : 'No changes';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
                    disabled={status === 'saving'}
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
                  disabled={status === 'saving'}
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
                  disabled={status === 'saving'}
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
                  disabled={status === 'saving'}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-md border p-3 bg-card space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Payment terms</Label>
          <Input
            value={paymentTerms}
            onChange={e => { setPaymentTerms(e.target.value); if (status !== 'idle' && status !== 'saving') setStatus('idle'); }}
            placeholder="e.g. 50% advance, 50% before shipment"
            className="h-8 text-xs"
            disabled={status === 'saving'}
          />
          <p className="text-[10px] text-muted-foreground">Shown near the top of the customer-facing quote. Leave blank to omit.</p>
        </div>

        {status === 'error' && errorMsg && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMsg}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {lines.length} line{lines.length === 1 ? '' : 's'} · {totals.qty.toLocaleString()} units ·{' '}
            <span className="font-semibold text-foreground">{fmtMoney(totals.grand)}</span>
            {dirty && status === 'idle' && (
              <Badge variant="outline" className="ml-2 text-[10px] font-medium">
                Unsaved
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={status === 'saving'}
            >
              {status === 'saved' ? 'Close' : 'Cancel'}
            </Button>
            <Button
              onClick={handleSave}
              disabled={status === 'saving' || status === 'saved' || !dirty || lines.length === 0}
              className="gap-1.5 min-w-[130px]"
            >
              {status === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {status === 'saved' && <Check className="h-3.5 w-3.5" />}
              {saveLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Strip the volatile `_key` before comparing so dirty-tracking only reflects real
// data changes (not re-renders).
function serializeLines(lines: Array<SnapshotLine & { _key: string }>) {
  return lines.map(({ _key, ...rest }) => rest);
}
