import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';

const COGS_TYPES = ['Raw Piece', 'Subcontracting', 'Finishing Materials', 'Packaging', 'Hardware', 'Accessories', 'Components', 'Wood', 'Other'];
const UNIT_OPTIONS = ['pc', 'L', 'kg', 'g', 'm', 'ft', 'sq ft', 'cft', 'set'];
const LABOR_TYPE_OPTIONS = ['Manufacturing', 'QC', 'Finishing', 'Assembly', 'Packaging', 'Market'];

type LaborDraft = { _key: string; labor_type: string; man_hours_per_unit: number };
const newLaborRow = (lt = 'QC'): LaborDraft => ({ _key: `l-${Math.random().toString(36).slice(2, 9)}`, labor_type: lt, man_hours_per_unit: 0 });
const PACKAGING_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '__keep__', label: 'Keep current per product' },
  { value: 'ic_only', label: 'IC only' },
  { value: 'ic_mc', label: 'IC + MC' },
  { value: 'corrugate_bubble', label: 'Corrugate + Bubble Wrap' },
  { value: 'no_packaging', label: 'No packaging' },
  { value: 'bulk_pack', label: 'Bulk pack' },
];

type DraftRow = {
  _key: string;
  cogs_type: string;
  component_name: string;
  components_per_product: number;
  unit_cost_inr: number;
  units: string;
  include: 'Yes' | 'No';
};

type RawRow = {
  _key: string;
  component_name: string;
  components_per_product: number;
  unit_cost_inr: number;
  units: string;
  vendor_name: string;
  include: 'Yes' | 'No';
};

const newRawRow = (name = ''): RawRow => ({
  _key: `raw-${Math.random().toString(36).slice(2, 9)}`,
  component_name: name,
  components_per_product: 1,
  unit_cost_inr: 0,
  units: 'pc',
  vendor_name: '',
  include: 'Yes',
});

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProductIds: string[];
  selectedProductNames: string[];
  onApplied: () => void;
};

const newRow = (): DraftRow => ({
  _key: `r-${Math.random().toString(36).slice(2, 9)}`,
  cogs_type: 'Finishing Materials',
  component_name: '',
  components_per_product: 0,
  unit_cost_inr: 0,
  units: 'pc',
  include: 'Yes',
});

export function BulkCostingUpdateDialog({ open, onOpenChange, selectedProductIds, selectedProductNames, onApplied }: Props) {
  const [rows, setRows] = useState<DraftRow[]>([newRow()]);
  const [saving, setSaving] = useState(false);
  const [knownNames, setKnownNames] = useState<string[]>([]);

  const [packagingType, setPackagingType] = useState<string>('__keep__');
  const [bulkPiecesPerBox, setBulkPiecesPerBox] = useState<number>(5);
  const [bulkShrinkPct, setBulkShrinkPct] = useState<number>(100);

  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [replaceAllRaw, setReplaceAllRaw] = useState(false);

  const [shippingTypes, setShippingTypes] = useState<{ id: string; name: string; per_unit: string; cost_inr: number }[]>([]);
  const [shippingTypeId, setShippingTypeId] = useState<string>('__keep__');

  const [laborRows, setLaborRows] = useState<LaborDraft[]>([]);

  const productCount = selectedProductIds.length;

  // Pull existing component names from the selected products to show as suggestions —
  // makes "match by name" predictable.
  useEffect(() => {
    if (!open || selectedProductIds.length === 0) { setKnownNames([]); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from('cogs_items')
        .select('component_name')
        .in('product_id', selectedProductIds);
      const set = new Set<string>();
      (data || []).forEach((r: any) => {
        const n = (r.component_name || '').trim();
        if (n) set.add(n);
      });
      setKnownNames(Array.from(set).sort());
    })();
  }, [open, selectedProductIds]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await (supabase as any).from('shipping_types').select('id, name, per_unit, cost_inr').order('name');
      setShippingTypes(data || []);
    })();
  }, [open]);

  useEffect(() => {
    if (open) {
      setRows([newRow()]);
      setPackagingType('__keep__');
      setBulkPiecesPerBox(5);
      setBulkShrinkPct(100);
      setRawRows([]);
      setReplaceAllRaw(false);
      setShippingTypeId('__keep__');
    }
  }, [open]);

  const addRow = () => setRows(prev => [...prev, newRow()]);
  const removeRow = (key: string) => setRows(prev => prev.filter(r => r._key !== key));
  const update = (key: string, patch: Partial<DraftRow>) =>
    setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));

  const addRawRow = () => setRawRows(prev => [...prev, newRawRow()]);
  const removeRawRow = (key: string) => setRawRows(prev => prev.filter(r => r._key !== key));
  const updateRaw = (key: string, patch: Partial<RawRow>) =>
    setRawRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));

  const validRawRows = useMemo(
    () => rawRows.filter(r => r.component_name.trim().length > 0),
    [rawRows],
  );

  const validRows = useMemo(
    () => rows.filter(r => r.component_name.trim().length > 0),
    [rows],
  );

  const handleApply = async () => {
    if (productCount === 0) { toast.error('No products selected'); return; }
    const willUpdatePackaging = packagingType !== '__keep__';
    const willUpdateRaw = validRawRows.length > 0 || replaceAllRaw;
    const willUpdateShipping = shippingTypeId !== '__keep__';
    if (validRows.length === 0 && !willUpdatePackaging && !willUpdateRaw && !willUpdateShipping) {
      toast.error('Add at least one row, raw piece, packaging type, or shipping type');
      return;
    }

    setSaving(true);

    // Pull all existing cogs_items for selected products in one shot — used to match by lower-cased name.
    const { data: existing, error: fetchErr } = await (supabase as any)
      .from('cogs_items')
      .select('id, product_id, component_name, sort_order, cogs_type')
      .in('product_id', selectedProductIds);

    if (fetchErr) {
      toast.error('Failed to read existing rows: ' + fetchErr.message);
      setSaving(false);
      return;
    }

    const existingByProductByName = new Map<string, Map<string, { id: string; sort_order: number | null }>>();
    const maxSortByProduct = new Map<string, number>();
    const rawIdsByProduct = new Map<string, string[]>();
    (existing || []).forEach((row: any) => {
      const pid = row.product_id;
      if (!existingByProductByName.has(pid)) existingByProductByName.set(pid, new Map());
      const nameKey = (row.component_name || '').trim().toLowerCase();
      if (nameKey) existingByProductByName.get(pid)!.set(nameKey, { id: row.id, sort_order: row.sort_order ?? 0 });
      const cur = maxSortByProduct.get(pid) ?? 0;
      maxSortByProduct.set(pid, Math.max(cur, row.sort_order ?? 0));
      if ((row.cogs_type || '') === 'Raw Piece') {
        if (!rawIdsByProduct.has(pid)) rawIdsByProduct.set(pid, []);
        rawIdsByProduct.get(pid)!.push(row.id);
      }
    });

    const updates: Array<{ id: string; patch: any }> = [];
    const inserts: any[] = [];
    let rawUpdatedCount = 0;
    let rawInsertedCount = 0;

    for (const pid of selectedProductIds) {
      const productExisting = existingByProductByName.get(pid) ?? new Map();
      let nextSort = (maxSortByProduct.get(pid) ?? 0) + 1;

      for (const r of validRows) {
        const nameKey = r.component_name.trim().toLowerCase();
        const match = productExisting.get(nameKey);
        const patch = {
          cogs_type: r.cogs_type,
          component_name: r.component_name.trim(),
          components_per_product: Number(r.components_per_product) || 0,
          unit_cost_inr: Number(r.unit_cost_inr) || 0,
          units: r.units,
          include: r.include,
          is_auto_calculated: false,
        };
        if (match) {
          updates.push({ id: match.id, patch });
        } else {
          inserts.push({ ...patch, product_id: pid, sort_order: nextSort });
          nextSort += 1;
        }
      }

      // Raw pieces: overwrite by name across selected SKUs
      for (const r of validRawRows) {
        const nameKey = r.component_name.trim().toLowerCase();
        const match = productExisting.get(nameKey);
        const patch: any = {
          cogs_type: 'Raw Piece',
          component_name: r.component_name.trim(),
          components_per_product: Number(r.components_per_product) || 0,
          unit_cost_inr: Number(r.unit_cost_inr) || 0,
          units: r.units,
          include: r.include,
          vendor_name: r.vendor_name?.trim() || null,
          is_auto_calculated: false,
        };
        if (match) {
          updates.push({ id: match.id, patch });
          rawUpdatedCount += 1;
        } else {
          inserts.push({ ...patch, product_id: pid, sort_order: nextSort });
          nextSort += 1;
          rawInsertedCount += 1;
        }
      }
    }

    // Optional: clear pre-existing Raw Piece rows that aren't in the new set, per product
    const deleteRawIds: string[] = [];
    if (replaceAllRaw) {
      const newNameKeys = new Set(validRawRows.map(r => r.component_name.trim().toLowerCase()));
      for (const pid of selectedProductIds) {
        const existingRawIds = rawIdsByProduct.get(pid) ?? [];
        const productExisting = existingByProductByName.get(pid) ?? new Map();
        // Build reverse map id -> name
        const nameByMatchId = new Map<string, string>();
        productExisting.forEach((v, k) => nameByMatchId.set(v.id, k));
        for (const id of existingRawIds) {
          const nameKey = nameByMatchId.get(id) ?? '';
          if (!newNameKeys.has(nameKey)) deleteRawIds.push(id);
        }
      }
    }

    const updatePromises = updates.map(u =>
      (supabase as any).from('cogs_items').update(u.patch).eq('id', u.id),
    );
    const insertPromise = inserts.length > 0
      ? (supabase as any).from('cogs_items').insert(inserts)
      : Promise.resolve({ error: null });

    const packagingPatch: any = willUpdatePackaging ? { packaging_type: packagingType } : null;
    if (willUpdatePackaging && packagingType === 'bulk_pack') {
      packagingPatch.bulk_pieces_per_box = Math.max(1, Math.floor(Number(bulkPiecesPerBox) || 1));
      packagingPatch.bulk_shrink_factor = Math.min(1, Math.max(0, (Number(bulkShrinkPct) || 0) / 100));
    }
    const packagingPromise = willUpdatePackaging
      ? (supabase as any).from('products').update(packagingPatch).in('id', selectedProductIds)
      : Promise.resolve({ error: null });

    const deletePromise = deleteRawIds.length > 0
      ? (supabase as any).from('cogs_items').delete().in('id', deleteRawIds)
      : Promise.resolve({ error: null });

    // Bulk shipping type: upsert one shipping_items row per selected product
    let shippingPromise: Promise<any> = Promise.resolve({ error: null });
    if (willUpdateShipping) {
      shippingPromise = (async () => {
        const { data: existingShip, error: fetchShipErr } = await (supabase as any)
          .from('shipping_items')
          .select('id, product_id')
          .in('product_id', selectedProductIds);
        if (fetchShipErr) return { error: fetchShipErr };
        const existingByPid = new Map<string, string>();
        (existingShip || []).forEach((r: any) => existingByPid.set(r.product_id, r.id));
        const toInsert: any[] = [];
        const toUpdateIds: string[] = [];
        for (const pid of selectedProductIds) {
          const existingId = existingByPid.get(pid);
          if (existingId) toUpdateIds.push(existingId);
          else toInsert.push({ product_id: pid, shipping_type_id: shippingTypeId, include: true });
        }
        const ops: Promise<any>[] = [];
        if (toUpdateIds.length > 0) {
          ops.push((supabase as any).from('shipping_items').update({ shipping_type_id: shippingTypeId }).in('id', toUpdateIds));
        }
        if (toInsert.length > 0) {
          ops.push((supabase as any).from('shipping_items').insert(toInsert));
        }
        const res = await Promise.all(ops);
        return { error: res.find((r: any) => r?.error)?.error ?? null };
      })();
    }

    const results = await Promise.all([...updatePromises, insertPromise, packagingPromise, deletePromise, shippingPromise]);
    const firstError = results.find((r: any) => r?.error)?.error;
    setSaving(false);

    if (firstError) {
      toast.error('Apply failed: ' + firstError.message);
      return;
    }

    const parts: string[] = [];
    if (validRows.length > 0) {
      parts.push(`${validRows.length} row${validRows.length === 1 ? '' : 's'} (${updates.length - rawUpdatedCount} updated, ${inserts.length - rawInsertedCount} added)`);
    }
    if (validRawRows.length > 0) {
      parts.push(`${validRawRows.length} raw piece${validRawRows.length === 1 ? '' : 's'} (${rawUpdatedCount} updated, ${rawInsertedCount} added)`);
    }
    if (deleteRawIds.length > 0) {
      parts.push(`${deleteRawIds.length} stale raw row${deleteRawIds.length === 1 ? '' : 's'} removed`);
    }
    if (willUpdatePackaging) {
      const label = PACKAGING_TYPE_OPTIONS.find(o => o.value === packagingType)?.label ?? packagingType;
      parts.push(`packaging → ${label}`);
    }
    if (willUpdateShipping) {
      const label = shippingTypes.find(s => s.id === shippingTypeId)?.name ?? 'shipping';
      parts.push(`shipping → ${label}`);
    }
    toast.success(`Applied ${parts.join(' + ')} to ${productCount} SKU${productCount === 1 ? '' : 's'}`);
    onApplied();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk update costing rows</DialogTitle>
          <DialogDescription>
            Apply these COGS rows to {productCount} selected SKU{productCount === 1 ? '' : 's'}. Rows are matched by name
            (case-insensitive) — existing rows are updated, new ones are added. Each SKU stays editable individually.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-3 py-2 max-h-20 overflow-y-auto">
          <div className="text-[11px] text-muted-foreground mb-1">Applying to:</div>
          <div className="flex flex-wrap gap-1">
            {selectedProductNames.slice(0, 30).map((n, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">{n}</Badge>
            ))}
            {selectedProductNames.length > 30 && (
              <Badge variant="outline" className="text-[10px]">+{selectedProductNames.length - 30} more</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-md border p-2">
          <Label className="text-xs whitespace-nowrap">Packaging type</Label>
          <Select value={packagingType} onValueChange={setPackagingType}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PACKAGING_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">Overwrites every selected SKU when not "keep current".</span>
        </div>

        {packagingType === 'bulk_pack' && (
          <div className="flex items-center gap-3 rounded-md border p-2 bg-muted/30">
            <Label className="text-xs whitespace-nowrap">Bulk pack defaults</Label>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Pieces / MC</span>
              <Input
                type="number"
                min={1}
                value={bulkPiecesPerBox}
                onChange={e => setBulkPiecesPerBox(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-8 w-20 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Height per extra piece (%)</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={bulkShrinkPct}
                onChange={e => setBulkShrinkPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                className="h-8 w-20 text-xs"
              />
            </div>
            <span className="text-[11px] text-muted-foreground">100% = no nesting. Applied to every selected SKU.</span>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-md border p-2">
          <Label className="text-xs whitespace-nowrap">Shipping type</Label>
          <Select value={shippingTypeId} onValueChange={setShippingTypeId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__keep__" className="text-xs">Keep current per product</SelectItem>
              {shippingTypes.map(s => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {s.name} ({s.per_unit} @ ₹{s.cost_inr})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">Sets shipping type on every selected SKU.</span>
        </div>
        <div className="rounded-md border p-2 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">Raw pieces (overwrite by name)</Label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                <Checkbox checked={replaceAllRaw} onCheckedChange={(v) => setReplaceAllRaw(!!v)} />
                Replace ALL existing raw pieces (delete others)
              </label>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addRawRow}>
                <Plus className="h-3 w-3" /> Add raw
              </Button>
            </div>
          </div>
          {rawRows.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">No raw piece overrides — add a row to overwrite raw pieces in selected SKUs.</div>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground px-1">
                <div className="col-span-3">Raw piece name</div>
                <div className="col-span-2">Vendor</div>
                <div className="col-span-2">Qty / unit</div>
                <div className="col-span-1">Units</div>
                <div className="col-span-2">Cost INR</div>
                <div className="col-span-2 text-center">Incl.</div>
              </div>
              {rawRows.map(r => (
                <div key={r._key} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3">
                    <Input value={r.component_name} onChange={e => updateRaw(r._key, { component_name: e.target.value })} placeholder="e.g. Mango wood seat" className="h-8 text-xs" />
                  </div>
                  <div className="col-span-2">
                    <Input value={r.vendor_name} onChange={e => updateRaw(r._key, { vendor_name: e.target.value })} placeholder="Vendor (optional)" className="h-8 text-xs" />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" step="any" inputMode="decimal" value={r.components_per_product} onChange={e => updateRaw(r._key, { components_per_product: Number(e.target.value) })} className="h-8 text-xs text-right" />
                  </div>
                  <div className="col-span-1">
                    <Select value={r.units} onValueChange={(v) => updateRaw(r._key, { units: v })}>
                      <SelectTrigger className="h-8 text-xs px-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNIT_OPTIONS.map(u => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Input type="number" step="any" inputMode="decimal" value={r.unit_cost_inr} onChange={e => updateRaw(r._key, { unit_cost_inr: Number(e.target.value) })} className="h-8 text-xs text-right" />
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <Checkbox checked={r.include === 'Yes'} onCheckedChange={(v) => updateRaw(r._key, { include: v ? 'Yes' : 'No' })} />
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeRawRow(r._key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {knownNames.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            <span className="font-medium">Existing names in these SKUs:</span>{' '}
            {knownNames.slice(0, 12).map((n, i) => (
              <button
                key={n}
                type="button"
                className="inline-flex items-center gap-1 mr-1 rounded border px-1.5 py-0.5 hover:bg-accent text-foreground"
                onClick={() => {
                  // Drop the suggestion into the first empty row, or add a new one
                  const empty = rows.find(r => !r.component_name.trim());
                  if (empty) update(empty._key, { component_name: n });
                  else setRows(prev => [...prev, { ...newRow(), component_name: n }]);
                }}
                title="Click to use this name"
              >
                {n}
              </button>
            ))}
            {knownNames.length > 12 && <span>+{knownNames.length - 12} more</span>}
          </div>
        )}

        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground px-1">
            <div className="col-span-3">Type</div>
            <div className="col-span-3">Component name</div>
            <div className="col-span-2">Qty / unit</div>
            <div className="col-span-1">Units</div>
            <div className="col-span-2">Cost INR</div>
            <div className="col-span-1 text-center">Incl.</div>
          </div>
          {rows.map(r => (
            <div key={r._key} className="grid grid-cols-12 gap-2 items-center rounded-md border p-2 bg-card">
              <div className="col-span-3">
                <Select value={r.cogs_type} onValueChange={(v) => update(r._key, { cogs_type: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COGS_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Input
                  value={r.component_name}
                  onChange={e => update(r._key, { component_name: e.target.value })}
                  placeholder="e.g. Walnut stain"
                  className="h-8 text-xs"
                  list={`bulk-name-suggest-${r._key}`}
                />
                <datalist id={`bulk-name-suggest-${r._key}`}>
                  {knownNames.map(n => <option key={n} value={n} />)}
                </datalist>
              </div>
              <div className="col-span-2">
                <Input
                  type="number" step="any" inputMode="decimal"
                  value={r.components_per_product}
                  onChange={e => update(r._key, { components_per_product: Number(e.target.value) })}
                  className="h-8 text-xs text-right"
                />
              </div>
              <div className="col-span-1">
                <Select value={r.units} onValueChange={(v) => update(r._key, { units: v })}>
                  <SelectTrigger className="h-8 text-xs px-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map(u => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Input
                  type="number" step="any" inputMode="decimal"
                  value={r.unit_cost_inr}
                  onChange={e => update(r._key, { unit_cost_inr: Number(e.target.value) })}
                  className="h-8 text-xs text-right"
                />
              </div>
              <div className="col-span-1 flex items-center justify-center gap-1">
                <Checkbox
                  checked={r.include === 'Yes'}
                  onCheckedChange={(v) => update(r._key, { include: v ? 'Yes' : 'No' })}
                />
                <Button
                  type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                  onClick={() => removeRow(r._key)}
                  disabled={rows.length === 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" /> Add row
          </Button>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {validRows.length} valid row{validRows.length === 1 ? '' : 's'} × {productCount} SKU{productCount === 1 ? '' : 's'} = {validRows.length * productCount} row write{validRows.length * productCount === 1 ? '' : 's'}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleApply} disabled={saving || productCount === 0 || (validRows.length === 0 && validRawRows.length === 0 && !replaceAllRaw && packagingType === '__keep__' && shippingTypeId === '__keep__')} className="gap-1.5">
              <Check className="h-3.5 w-3.5" /> {saving ? 'Applying…' : 'Apply to selected'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
