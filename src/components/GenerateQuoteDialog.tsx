import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { createQuoteSnapshot, defaultValidUntil, type QuoteProductInput } from '@/lib/quote-creation';
import { getHardwareSyncPlan, applyHardwareSync, type HardwareSyncPlan, type HardwareConflict, type ConflictResolution } from '@/lib/hardware-sync';
import { HardwareSyncDialog } from '@/components/HardwareSyncDialog';
import { QuotePriceReviewDialog } from '@/components/QuotePriceReviewDialog';

type Product = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number | null;
  quote_stage: string | null;
  target_price_usd: number | null;
  markup_percent: number | null;
};

type Entity = { id: string; name: string };

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
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState<string>('');
  const [currency, setCurrency] = useState<'USD' | 'INR'>('USD');
  const [validUntil, setValidUntil] = useState<string>(defaultValidUntil());
  const [saving, setSaving] = useState(false);
  const [hwPlan, setHwPlan] = useState<HardwareSyncPlan | null>(null);
  const [hwOpen, setHwOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingLines, setPendingLines] = useState<QuoteProductInput[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setValidUntil(defaultValidUntil());
    (async () => {
      const [prodRes, entRes, inqRes] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, sku, quantity, quote_stage, target_price_usd, markup_percent')
          .eq('customer_rfq_id', inquiryId)
          .order('name'),
        supabase.from('company_entities').select('id, name').order('name'),
        (supabase as any).from('customer_rfqs').select('quoting_entity_id, quoting_currency').eq('id', inquiryId).maybeSingle(),
      ]);
      setProducts((prodRes.data ?? []) as Product[]);
      const ents = (entRes.data ?? []) as Entity[];
      setEntities(ents);
      const inq = inqRes.data;
      const preferredEntity = inq?.quoting_entity_id && ents.find(e => e.id === inq.quoting_entity_id)
        ? inq.quoting_entity_id
        : (ents[0]?.id ?? '');
      setEntityId(preferredEntity);
      setCurrency((inq?.quoting_currency as 'USD' | 'INR') || 'USD');
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
    if (!entityId) { toast.error('Select a company entity'); return; }
    setReviewOpen(true);
  };

  const handleReviewConfirm = async (lines: QuoteProductInput[]) => {
    setPendingLines(lines);
    setSaving(true);
    const productIds = Array.from(new Set(lines.map(l => l.id)));
    const plan = await getHardwareSyncPlan(productIds);
    if (plan.newItems.length === 0 && plan.conflicts.length === 0) {
      await finalizeQuote([], lines);
      return;
    }
    setHwPlan(plan);
    setReviewOpen(false);
    setHwOpen(true);
    setSaving(false);
  };

  const finalizeQuote = async (
    resolved: Array<HardwareConflict & { resolution: ConflictResolution }>,
    lines?: QuoteProductInput[],
  ) => {
    setSaving(true);
    if (hwPlan) {
      const sync = await applyHardwareSync(hwPlan.newItems, resolved);
      if (sync.error) { setSaving(false); toast.error('Hardware sync failed: ' + sync.error); return; }
      if (sync.added || sync.updated) {
        toast.success(`Hardware library: +${sync.added} added, ${sync.updated} updated`);
      }
    }
    const linesToUse = lines ?? pendingLines ?? products.filter(p => selected.has(p.id)).map(p => ({
      id: p.id, name: p.name, target_price_usd: p.target_price_usd, markup_percent: p.markup_percent,
    } as QuoteProductInput));
    const result = await createQuoteSnapshot({
      inquiryId,
      selectedProducts: linesToUse,
      entityId,
      validUntil,
      currency,
    });
    setSaving(false);
    setHwOpen(false);
    setHwPlan(null);
    setReviewOpen(false);
    setPendingLines(null);
    if (result.error) { toast.error(result.error); return; }
    toast.success(`Quote draft created${inquiryNumber ? ' for ' + inquiryNumber : ''}`);
    onCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Quote{inquiryNumber ? ` — ${inquiryNumber}` : ''}</DialogTitle>
          <p className="text-xs text-muted-foreground">Select products and quote details</p>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Company entity</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Select entity..." /></SelectTrigger>
              <SelectContent>
                {entities.length === 0 ? (
                  <SelectItem value="__none__" disabled>No entities configured</SelectItem>
                ) : entities.map(e => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Currency</Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v as 'USD' | 'INR')}>
              <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD ($)</SelectItem>
                <SelectItem value="INR">INR (₹)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-3">
            <Label className="text-xs">Valid until</Label>
            <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="h-9 mt-1" />
          </div>
        </div>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
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
            <Button onClick={submit} disabled={selected.size === 0 || saving || !entityId}>
              {saving ? 'Creating…' : 'Review prices…'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <QuotePriceReviewDialog
        open={reviewOpen}
        onOpenChange={(o) => { if (!o) { setReviewOpen(false); setSaving(false); } }}
        selectedProducts={products.filter(p => selected.has(p.id)).map(p => ({
          id: p.id, name: p.name, quantity: p.quantity, target_price_usd: p.target_price_usd, markup_percent: p.markup_percent,
        }))}
        currency={currency}
        onConfirm={handleReviewConfirm}
        saving={saving}
      />
      <HardwareSyncDialog
        open={hwOpen}
        plan={hwPlan}
        onCancel={() => { setHwOpen(false); setHwPlan(null); setSaving(false); setPendingLines(null); }}
        onConfirm={(resolved) => finalizeQuote(resolved, pendingLines || undefined)}
      />
    </Dialog>
  );
}
