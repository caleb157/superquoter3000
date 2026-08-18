import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, X, ArrowUp, ArrowDown, GripVertical, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { updateQuoteLineItems } from '@/lib/quote-creation';
import { fmt } from '@/lib/formatters';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FreightInput, FreightMode } from '@/lib/freight';
import { supabase } from '@/integrations/supabase/client';

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
  totals: { sku_count: number; total_qty: number; grand_total: number; total_cbm: number; freight?: any };
  payment_terms?: string | null;
  incoterm?: string | null;
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
  const [incoterm, setIncoterm] = useState<string>('');
  const [shippingTypes, setShippingTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [freightMode, setFreightMode] = useState<FreightMode>('sea');
  const [freightRate, setFreightRate] = useState<string>('');
  const [dimDivisor, setDimDivisor] = useState<string>('5000');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const initialSerialRef = useRef<string>('');
  const initialPaymentTermsRef = useRef<string>('');
  const initialIncotermRef = useRef<string>('');
  const initialFreightRef = useRef<string>('');
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
    const ic = ((snapshot as any).incoterm ?? '') as string;
    setIncoterm(ic);
    initialIncotermRef.current = ic;
    const f = snapshot?.totals?.freight ?? null;
    const fm = (f?.mode === 'air' ? 'air' : 'sea') as FreightMode;
    const fr = f?.rate != null ? String(f.rate) : '';
    const fd = f?.dim_divisor != null ? String(f.dim_divisor) : '5000';
    setFreightMode(fm);
    setFreightRate(fr);
    setDimDivisor(fd);
    initialFreightRef.current = `${fm}|${fr}|${fd}`;
    setStatus('idle');
    setErrorMsg(null);
    (async () => {
      const { data } = await supabase.from('shipping_types').select('id, name').order('name');
      setShippingTypes((data ?? []) as any);
    })();
  }, [open, snapshot]);

  // Cancel a pending auto-close if the user reopens or unmounts.
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const totals = useMemo(() => {
    const qty = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
    const grand = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price_usd || 0), 0);
    const cbm = lines.reduce((s, l) => s + Number(l.unit_cbm || 0) * Number(l.quantity || 0), 0);
    return { qty, grand, cbm, sku: lines.length };
  }, [lines]);

  const freightSerial = `${freightMode}|${freightRate}|${dimDivisor}`;
  const dirty = useMemo(
    () => JSON.stringify(serializeLines(lines)) !== initialSerialRef.current
      || paymentTerms !== initialPaymentTermsRef.current
      || incoterm !== initialIncotermRef.current
      || freightSerial !== initialFreightRef.current,
    [lines, paymentTerms, incoterm, freightSerial],
  );

  const update = (key: string, patch: Partial<SnapshotLine>) => {
    setLines(prev => prev.map(l => l._key === key ? { ...l, ...patch } : l));
    if (status !== 'idle' && status !== 'saving') setStatus('idle');
  };

  const removeLine = (key: string) => {
    setLines(prev => prev.filter(l => l._key !== key));
    if (status !== 'idle' && status !== 'saving') setStatus('idle');
  };

  const moveLine = (key: string, dir: -1 | 1) => {
    setLines(prev => {
      const idx = prev.findIndex(l => l._key === key);
      if (idx < 0) return prev;
      const swap = idx + dir;
      if (swap < 0 || swap >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
    if (status !== 'idle' && status !== 'saving') setStatus('idle');
  };

  // --- Drag & drop reordering ---
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const reorder = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setLines(prev => {
      const from = prev.findIndex(l => l._key === fromKey);
      const to = prev.findIndex(l => l._key === toKey);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    if (status !== 'idle' && status !== 'saving') setStatus('idle');
  };

  // --- Column sorting ---
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const sortBy = (field: 'name' | 'quantity' | 'unit_price_usd' | 'total', dirOverride?: 'asc' | 'desc') => {
    const dir = dirOverride ?? sortDir;
    setLines(prev => {
      const next = prev.slice().sort((a, b) => {
        let cmp = 0;
        if (field === 'name') cmp = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
        else if (field === 'total') {
          cmp = (Number(a.quantity || 0) * Number(a.unit_price_usd || 0)) - (Number(b.quantity || 0) * Number(b.unit_price_usd || 0));
        } else cmp = Number(a[field] || 0) - Number(b[field] || 0);
        return dir === 'desc' ? -cmp : cmp;
      });
      return next;
    });
    if (status !== 'idle' && status !== 'saving') setStatus('idle');
  };


  const handleSave = async () => {
    if (!snapshot || !dirty || status === 'saving') return;
    setStatus('saving');
    setErrorMsg(null);

    const payload = lines.map(({ _key, ...rest }) => rest);
    const freightRateNum = Number(freightRate || 0);
    const freight: FreightInput | null = freightRateNum > 0
      ? { mode: freightMode, rate: freightRateNum, dim_divisor: Number(dimDivisor || 5000) }
      : null;
    const result = await updateQuoteLineItems(snapshot.id, payload, { payment_terms: paymentTerms, freight, incoterm });

    if (result.error) {
      setStatus('error');
      setErrorMsg(result.error);
      toast.error(`Save failed: ${result.error}`);
      return;
    }

    // Re-baseline so further edits are detected as dirty again.
    initialSerialRef.current = JSON.stringify(serializeLines(lines));
    initialPaymentTermsRef.current = paymentTerms;
    initialIncotermRef.current = incoterm;
    initialFreightRef.current = freightSerial;
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
      incoterm: result.incoterm ?? (incoterm.trim() || null),
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
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-3">
          <DialogTitle>Edit quote line items</DialogTitle>
          <DialogDescription>
            Adjust the name, quantity, or unit price for each line. Totals will be recalculated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2 space-y-4">
        <div className="rounded-md border p-3 bg-card space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Incoterm <span className="text-muted-foreground">(optional)</span></Label>
          <Select
            value={incoterm}
            onValueChange={(v) => { setIncoterm(v === '__clear__' ? '' : v); if (status !== 'idle' && status !== 'saving') setStatus('idle'); }}
            disabled={status === 'saving'}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="No incoterm" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__clear__">No incoterm</SelectItem>
              {shippingTypes.map(s => (
                <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">Optional. Shown at the top of the quote when set.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Sort lines</span>
          {([
            { key: 'name', label: 'Name' },
            { key: 'quantity', label: 'Qty' },
            { key: 'unit_price_usd', label: 'Price' },
            { key: 'total', label: 'Line total' },
          ] as const).map(opt => (
            <Button
              key={opt.key}
              type="button" size="sm" variant="outline"
              className="h-7 gap-1 text-[11px]"
              disabled={status === 'saving' || lines.length < 2}
              onClick={() => sortBy(opt.key)}
            >
              {opt.label}
              <ArrowUpDown className="h-3 w-3 opacity-60" />
            </Button>
          ))}
          <Button
            type="button" size="sm" variant="ghost"
            className="h-7 gap-1 text-[11px] ml-auto"
            disabled={status === 'saving'}
            onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
            title="Toggle sort direction"
          >
            {sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {sortDir === 'asc' ? 'Ascending' : 'Descending'}
          </Button>
        </div>

        <div className="space-y-2">
          {lines.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">No line items.</div>
          ) : lines.map((line, idx) => (
            <div
              key={line._key}
              onDragOver={(e) => { if (dragKey) { e.preventDefault(); if (overKey !== line._key) setOverKey(line._key); } }}
              onDrop={(e) => { e.preventDefault(); if (dragKey) reorder(dragKey, line._key); setDragKey(null); setOverKey(null); }}
              className={`grid grid-cols-12 gap-2 items-end rounded-md border p-2 bg-card transition-colors ${
                dragKey === line._key ? 'opacity-50' : ''
              } ${overKey === line._key && dragKey && dragKey !== line._key ? 'border-primary ring-1 ring-primary/40' : ''}`}
            >
              <div className="col-span-5">
                <Label className="text-[10px] text-muted-foreground">Display name</Label>
                <div className="flex items-center gap-1.5">
                  <span
                    draggable={status !== 'saving'}
                    onDragStart={(e) => { setDragKey(line._key); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                    title="Drag to reorder"
                    className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground px-0.5"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
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
              <div className="col-span-2 flex items-center justify-end gap-1 pb-0.5">
                <span className="text-[11px] tabular-nums text-muted-foreground mr-1">
                  {fmtMoney(Number(line.quantity || 0) * Number(line.unit_price_usd || 0))}
                </span>
                <Button
                  type="button" variant="ghost" size="icon" className="h-7 w-7"
                  title="Move up"
                  onClick={() => moveLine(line._key, -1)}
                  disabled={status === 'saving' || idx === 0}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" variant="ghost" size="icon" className="h-7 w-7"
                  title="Move down"
                  onClick={() => moveLine(line._key, 1)}
                  disabled={status === 'saving' || idx === lines.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
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

        <div className="rounded-md border p-3 bg-card space-y-2">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Freight Estimate (Rough)</Label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Mode</Label>
              <Select
                value={freightMode}
                onValueChange={(v) => { setFreightMode(v as FreightMode); if (status !== 'idle' && status !== 'saving') setStatus('idle'); }}
                disabled={status === 'saving'}
              >
                <SelectTrigger className="h-8 mt-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sea">Sea (per CBM)</SelectItem>
                  <SelectItem value="air">Air (per kg)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">
                Rate ({currency}/{freightMode === 'sea' ? 'CBM' : 'kg'})
              </Label>
              <Input
                type="number" step="any" inputMode="decimal"
                value={freightRate}
                onChange={e => { setFreightRate(e.target.value); if (status !== 'idle' && status !== 'saving') setStatus('idle'); }}
                className="h-8 mt-1 text-xs text-right" placeholder="0"
                disabled={status === 'saving'}
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">
                {freightMode === 'air' ? 'DIM divisor' : '\u00A0'}
              </Label>
              <Input
                type="number" step="any" inputMode="decimal"
                value={dimDivisor}
                onChange={e => { setDimDivisor(e.target.value); if (status !== 'idle' && status !== 'saving') setStatus('idle'); }}
                className="h-8 mt-1 text-xs text-right"
                disabled={status === 'saving' || freightMode !== 'air'}
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {freightMode === 'sea'
              ? 'Total CBM × rate. Shown as a separate line on the customer quote.'
              : 'Chargeable kg = max(actual kg, L×W×H cm ÷ divisor). Set rate to 0 to hide.'}
          </p>
        </div>

        {status === 'error' && errorMsg && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMsg}
          </div>
        )}

        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-4 flex items-center justify-between sm:justify-between gap-3">
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
