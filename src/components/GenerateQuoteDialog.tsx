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
import { computeProductUnitPrices, type ProductPriceCostMap } from '@/lib/product-pricing';
import { AlertTriangle } from 'lucide-react';
import { getHardwareSyncPlan, applyHardwareSync, type HardwareSyncPlan, type HardwareConflict, type ConflictResolution } from '@/lib/hardware-sync';
import { HardwareSyncDialog } from '@/components/HardwareSyncDialog';
import { QuotePriceReviewDialog } from '@/components/QuotePriceReviewDialog';
import { CurrencyCombobox } from '@/components/CurrencyCombobox';
import { convertFromInr, hasImportRate, loadCurrencyMap } from '@/lib/currency';
import type { FreightInput, FreightMode } from '@/lib/freight';

type Product = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number | null;
  quote_stage: string | null;
  target_price_usd: number | null;
  markup_percent: number | null;
};

type AssemblyLite = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number | null;
  markup_percent: number | null;
  components: Array<{ product_id: string; quantity_per_assembly: number }>;
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
  const [assemblies, setAssemblies] = useState<AssemblyLite[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // products
  const [selectedAsm, setSelectedAsm] = useState<Set<string>>(new Set()); // assemblies
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [validUntil, setValidUntil] = useState<string>(defaultValidUntil());
  const [saving, setSaving] = useState(false);
  const [hwPlan, setHwPlan] = useState<HardwareSyncPlan | null>(null);
  const [hwOpen, setHwOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingLines, setPendingLines] = useState<QuoteProductInput[] | null>(null);
  // Optional rough freight estimate
  const [freightMode, setFreightMode] = useState<FreightMode>('sea');
  const [freightRate, setFreightRate] = useState<string>('');
  const [dimDivisor, setDimDivisor] = useState<string>('5000');
  const [priceMap, setPriceMap] = useState<ProductPriceCostMap>({});

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSelectedAsm(new Set());
    setValidUntil(defaultValidUntil());
    (async () => {
      const [prodRes, asmRes, entRes, inqRes] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, sku, quantity, quote_stage, target_price_usd, markup_percent')
          .eq('customer_rfq_id', inquiryId)
          .order('name'),
        (supabase as any)
          .from('product_assemblies')
          .select('id, name, sku, quantity, markup_percent, assembly_components(product_id, quantity_per_assembly)')
          .eq('customer_rfq_id', inquiryId)
          .order('name'),
        supabase.from('company_entities').select('id, name').order('name'),
        (supabase as any).from('customer_rfqs').select('quoting_entity_id, quoting_currency').eq('id', inquiryId).maybeSingle(),
      ]);
      setProducts((prodRes.data ?? []) as Product[]);
      setAssemblies(((asmRes.data ?? []) as any[]).map(a => ({
        id: a.id, name: a.name, sku: a.sku, quantity: a.quantity, markup_percent: a.markup_percent,
        components: a.assembly_components || [],
      })));
      const ents = (entRes.data ?? []) as Entity[];
      setEntities(ents);
      const inq = inqRes.data;
      const preferredEntity = inq?.quoting_entity_id && ents.find(e => e.id === inq.quoting_entity_id)
        ? inq.quoting_entity_id
        : (ents[0]?.id ?? '');
      setEntityId(preferredEntity);
      setCurrency((inq?.quoting_currency as string) || 'USD');
      // Fetch price map (with stored/drift info) for warning banner
      const allIds = [
        ...((prodRes.data ?? []) as any[]).map(p => p.id),
        ...((asmRes.data ?? []) as any[]).flatMap(a => (a.assembly_components || []).map((c: any) => c.product_id)),
      ];
      if (allIds.length > 0) {
        const pm = await computeProductUnitPrices(Array.from(new Set(allIds)));
        setPriceMap(pm);
      } else {
        setPriceMap({});
      }
    })();
  }, [open, inquiryId]);

  const allSelected = products.length > 0 && products.every(p => selected.has(p.id));
  const toggleAll = (v: boolean) => setSelected(v ? new Set(products.map(p => p.id)) : new Set());
  const toggleOne = (id: string, v: boolean) => {
    const next = new Set(selected);
    if (v) next.add(id); else next.delete(id);
    setSelected(next);
  };
  const toggleAsm = (id: string, v: boolean) => {
    const next = new Set(selectedAsm);
    if (v) next.add(id); else next.delete(id);
    setSelectedAsm(next);
  };

  const totalSelected = selected.size + selectedAsm.size;

  const submit = async () => {
    if (totalSelected === 0) return;
    if (!entityId) { toast.error('Select a company entity'); return; }
    setReviewOpen(true);
  };

  const [reviewItems, setReviewItems] = useState<any[]>([]);
  const buildReviewItems = async () => {
    const prods = products.filter(p => selected.has(p.id)).map(p => ({
      id: p.id, name: p.name, quantity: p.quantity, target_price_usd: p.target_price_usd, markup_percent: p.markup_percent,
    }));
    const chosenAsm = assemblies.filter(a => selectedAsm.has(a.id));
    if (chosenAsm.length === 0) { setReviewItems(prods); return; }
    // Compute component-driven reference price for each assembly (in display currency)
    const allCompIds = Array.from(new Set(chosenAsm.flatMap(a => a.components.map(c => c.product_id))));
    const priceMap = await computeProductUnitPrices(allCompIds);
    const fx = (Object.values(priceMap)[0] as any)?.exchange_rate ?? 90;
    const asmItems = chosenAsm.map(a => {
      const unitCostUsd = a.components.reduce((sum, c) => {
        const entry = priceMap[c.product_id];
        const costUsd = entry?.unit_cost_usd ?? 0;
        return sum + costUsd * (c.quantity_per_assembly || 1);
      }, 0);
      const markup = a.markup_percent ?? 0.2;
      const usdPrice = unitCostUsd * (1 + markup);
      const refPrice = currency === 'INR' ? usdPrice * fx : usdPrice;
      return {
        id: a.id,
        name: a.name,
        quantity: a.quantity,
        is_assembly: true,
        reference_price_usd: refPrice, // in display currency
      };
    });
    setReviewItems([...prods, ...asmItems]);
  };

  useEffect(() => {
    if (reviewOpen) { buildReviewItems(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewOpen]);

  const handleReviewConfirm = async (lines: QuoteProductInput[]) => {
    setPendingLines(lines);
    setSaving(true);
    // Only sync hardware for real product lines (not assemblies)
    const productIds = Array.from(new Set(lines.filter(l => !l.assembly_id).map(l => l.id)));
    const plan = productIds.length > 0
      ? await getHardwareSyncPlan(productIds)
      : { newItems: [], conflicts: [] } as HardwareSyncPlan;
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
    const freightRateNum = Number(freightRate || 0);
    const freight: FreightInput | null = freightRateNum > 0
      ? { mode: freightMode, rate: freightRateNum, dim_divisor: Number(dimDivisor || 5000) }
      : null;
    const result = await createQuoteSnapshot({
      inquiryId,
      selectedProducts: linesToUse,
      entityId,
      validUntil,
      currency,
      freight,
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto mx-2 sm:mx-auto">
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
            <div className="mt-1">
              <CurrencyCombobox value={currency} onChange={(v) => setCurrency(v as any)} />
            </div>
          </div>
          <div className="col-span-3">
            <Label className="text-xs">Valid until</Label>
            <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="h-9 mt-1" />
          </div>
          <div className="col-span-3 rounded-md border bg-muted/30 p-2.5 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Freight Estimate (Rough) <span className="font-normal normal-case">— optional</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Mode</Label>
                <Select value={freightMode} onValueChange={(v) => setFreightMode(v as FreightMode)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sea">Sea (per CBM)</SelectItem>
                    <SelectItem value="air">Air (per kg, chargeable)</SelectItem>
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
                  onChange={e => setFreightRate(e.target.value)}
                  className="h-9 mt-1 text-right" placeholder="0"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">
                  {freightMode === 'air' ? 'DIM divisor' : '\u00A0'}
                </Label>
                <Input
                  type="number" step="any" inputMode="decimal"
                  value={dimDivisor}
                  onChange={e => setDimDivisor(e.target.value)}
                  className="h-9 mt-1 text-right"
                  disabled={freightMode !== 'air'}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {freightMode === 'sea'
                ? 'Total CBM × rate. Shown as a separate line below the quote total.'
                : 'Chargeable kg = max(actual kg, L×W×H cm ÷ divisor). Sum across all lines × rate.'}
            </p>
          </div>
        </div>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {products.length === 0 && assemblies.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No products or assemblies in this inquiry.</div>
          ) : (
            <>
              {products.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground border-b">
                    <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} />
                    <span className="flex-1">Products — select all / none</span>
                  </div>
                  {products.map(p => {
                    const stage = p.quote_stage ? QUOTE_STAGE_LABEL[p.quote_stage] : null;
                    return (
                      <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 rounded cursor-pointer">
                        <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggleOne(p.id, !!v)} />
                        <span className="flex-1 min-w-0 truncate">
                          {p.name}
                          {p.sku && <span className="ml-2 italic text-[11px] text-muted-foreground/70">{p.sku}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{p.quantity ?? 0}</span>
                        {stage && <Badge variant="secondary" className={`text-[10px] ${stage.cls}`}>{stage.label}</Badge>}
                      </label>
                    );
                  })}
                </>
              )}
              {assemblies.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground border-b mt-2">
                    <span className="flex-1">Assemblies (kits)</span>
                  </div>
                  {assemblies.map(a => (
                    <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 rounded cursor-pointer">
                      <Checkbox checked={selectedAsm.has(a.id)} onCheckedChange={(v) => toggleAsm(a.id, !!v)} />
                      <span className="flex-1 min-w-0 truncate">
                        {a.name}
                        {a.sku && <span className="ml-2 italic text-[11px] text-muted-foreground/70">{a.sku}</span>}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">{a.components.length} comp</Badge>
                      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{a.quantity ?? 0}</span>
                    </label>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">{totalSelected} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={totalSelected === 0 || saving || !entityId}>
              {saving ? 'Creating…' : 'Review prices…'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <QuotePriceReviewDialog
        open={reviewOpen}
        onOpenChange={(o) => { if (!o) { setReviewOpen(false); setSaving(false); } }}
        selectedProducts={reviewItems}
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
