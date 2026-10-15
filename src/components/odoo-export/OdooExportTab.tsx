// Product "Odoo" tab: review a product's BOM against Odoo, then send the new components,
// the product (unless it's already in Odoo) and a new BOM straight to Odoo (admins), or
// download the two import files. Quantities come from the costing engine (src/lib/odoo-bom.ts);
// Odoo is read live. Nothing is remembered between products: every line is picked here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { computeResults, loadProductBundle } from '@/lib/costing-workspace';
import { calcICDimensions, calcIcOd, calcMcOd, getBoxOdOffsets, productMasterCartonPlan } from '@/lib/calculations';
import {
  bomQty, bomSheet, buildDraftLines, cartonItem, cartonKind, checkDraft, defaultFinished, displayName, editNewItem, fileStem,
  joinSku, productsSheet, pushPayload, splitSku,
  type CartonSize, type DraftLine, type FinishedDraft, type LineStatus, type OdooProduct,
} from '@/lib/odoo-bom';
import {
  loadStandardComponents, odooMeta, odooProductsBySku, odooSkuPrefixes, pushToOdoo,
  type OdooMeta, type PushResult, type SkuPrefix, type StandardComponent,
} from '@/lib/odoo-products';
import { OdooProductPicker } from './OdooProductPicker';
import { OptionCombobox } from './OptionCombobox';

type Saved = { finished: FinishedDraft; lines: Record<string, Pick<DraftLine, 'status' | 'match' | 'newItem' | 'qtyOverride'>>; added?: DraftLine[] };
const storeKey = (id: string) => `odoo-bom-draft:v2:${id}`;
const readSaved = (id: string): Saved | null => {
  try { const s = localStorage.getItem(storeKey(id)); return s ? JSON.parse(s) : null; } catch { return null; }
};
const writeSaved = (id: string, s: Saved) => { try { localStorage.setItem(storeKey(id), JSON.stringify(s)); } catch { /* per-browser draft only */ } };
const clearSaved = (id: string) => { try { localStorage.removeItem(storeKey(id)); } catch { /* ignore */ } };

const num = (v: string) => (v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const upper = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
const ADDED = 'Added';

type Cartons = { PIC: { size: CartonSize; ply: string | null }; PMC: { size: CartonSize; ply: string | null } };

function addedLine(match: OdooProduct | null, qtyPerUnit: number | null): DraftLine {
  return {
    lineId: `added:${crypto.randomUUID()}`, key: '', cogsType: ADDED, hqName: match?.name || '', hqQty: 1, hqUnit: match?.uom || 'Units',
    hqCostPerUnit: 0, vendor: '', status: 'match', match,
    newItem: { name: '', sku: '', category: 'All / Expenses / Raw Materials AVCO Automatic', tracked: true, uom: 'Units', purchaseUom: '', cost: null, hsn: '' },
    qtyOverride: qtyPerUnit,
  };
}

export function OdooExportTab({ productId }: { productId: string }) {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [finished, setFinished] = useState<FinishedDraft | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [cartons, setCartons] = useState<Cartons | null>(null);
  const [meta, setMeta] = useState<OdooMeta | null>(null);
  const [prefixList, setPrefixList] = useState<SkuPrefix[]>([]);
  const [standard, setStandard] = useState<StandardComponent[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Set<string> | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const [sendError, setSendError] = useState<{ msg: string; problems?: string[] } | null>(null);
  const ready = useRef(false);
  const cartonAuto = useRef<Record<string, { name: string; sku: string }>>({});

  const checkOdoo = useCallback(async (f: FinishedDraft, ls: DraftLine[]) => {
    setChecking(true);
    try {
      const skus = [f.exists ? '' : f.sku, ...ls.map(l => (l.status === 'new' ? l.newItem.sku : ''))].filter(s => s && !/-$/.test(s.trim()) && !/^-/.test(s.trim()));
      const found = await odooProductsBySku(skus);
      setExisting(new Set(found.map(p => p.sku.trim().toUpperCase())));
      setLookupError(null);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
      setExisting(null);
    } finally {
      setChecking(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    ready.current = false;
    cartonAuto.current = {};
    try {
      const b = await loadProductBundle(productId);
      if (!b) throw new Error('Product not found.');
      const product = b.products.find(p => p.id === productId);
      const res = computeResults(b).get(productId);
      const rows = res?.resolvedCogsRows ?? b.cogs.filter(c => c.product_id === productId);

      // Estimated outside carton sizes (as costed) for the PIC / PMC names and SKUs.
      const cbmRow = b.cbm.find(c => c.product_id === productId) || null;
      const productType = b.productTypes.find(t => t.id === product?.product_type_id) || null;
      const icAuto = calcICDimensions(Number(product?.width_inch) || 0, Number(product?.depth_inch) || 0, Number(product?.height_inch) || 0, productType?.pkg_ic_add_per_side_in ?? 0.5);
      const icOd = calcIcOd(cbmRow?.ic_width ?? icAuto.ic_width, cbmRow?.ic_depth ?? icAuto.ic_depth, cbmRow?.ic_height ?? icAuto.ic_height,
        getBoxOdOffsets(b.boxData || [], cbmRow?.ic_type || '7 ply'));
      const plan = productMasterCartonPlan({ product, cbmRow, boxData: b.boxData, productType, globalSettings: b.gs });
      const mcOd = calcMcOd(plan.mc.width, plan.mc.depth, plan.mc.height, getBoxOdOffsets(b.boxData || [], cbmRow?.mc_type || '7 ply'));
      setCartons({
        PIC: { size: { w: icOd.ic_od_width, d: icOd.ic_od_depth, h: icOd.ic_od_height }, ply: cbmRow?.ic_type || null },
        PMC: { size: { w: mcOd.mc_od_width, d: mcOd.mc_od_depth, h: mcOd.mc_od_height }, ply: cbmRow?.mc_type || null },
      });

      let ls = buildDraftLines(rows, new Map(), productId);
      let f = defaultFinished(product, { volumeM3: res?.finalUnitCbm ?? null });
      const saved = readSaved(productId);
      if (saved) {
        f = { ...f, ...saved.finished };
        ls = ls.map(l => (saved.lines[l.lineId] ? { ...l, ...saved.lines[l.lineId] } : l));
        ls = [...ls, ...(saved.added ?? [])];
      }
      setFinished(f);
      setLines(ls);
      setResult(null);
      setSendError(null);
      ready.current = true;
      setLoading(false);

      // Live Odoo reads, in the background.
      odooMeta().then(setMeta).catch(e => setLookupError(e instanceof Error ? e.message : String(e)));
      odooSkuPrefixes().then(setPrefixList).catch(() => { /* typing still works */ });
      loadStandardComponents().then(setStandard).catch(() => setStandard([]));
      checkOdoo(f, ls);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [productId, checkOdoo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ready.current || !finished) return;
    const savedLines: Saved['lines'] = {};
    for (const l of lines) if (l.cogsType !== ADDED) savedLines[l.lineId] = { status: l.status, match: l.match, newItem: l.newItem, qtyOverride: l.qtyOverride };
    writeSaved(productId, { finished, lines: savedLines, added: lines.filter(l => l.cogsType === ADDED) });
  }, [finished, lines, productId]);

  // Carton names and SKUs follow the product name and base SKU, until someone types over them.
  const base = finished ? splitSku(finished.sku).base : '';
  const fname = finished?.name ?? '';
  useEffect(() => {
    if (!cartons || !ready.current) return;
    setLines(prev => prev.map(l => {
      const kind = cartonKind(l.cogsType, l.hqName);
      if (!kind) return l;
      const next = cartonItem(kind, fname, base, cartons[kind].size, cartons[kind].ply);
      const last = cartonAuto.current[l.lineId];
      const n = { ...l.newItem };
      if (!last ? n.name === l.hqName || !n.name : n.name === last.name) n.name = next.name;
      if (!last ? !n.sku : n.sku === last.sku) n.sku = next.sku;
      cartonAuto.current[l.lineId] = next;
      return n.name === l.newItem.name && n.sku === l.newItem.sku ? l : { ...l, newItem: n };
    }));
  }, [cartons, base, fname]);

  const issues = useMemo(() => (finished ? checkDraft(finished, lines, existing) : []), [finished, lines, existing]);
  const errors = issues.filter(i => i.level === 'error');

  const patchLine = (lineId: string, patch: Partial<DraftLine>) =>
    setLines(prev => prev.map(l => (l.lineId === lineId ? { ...l, ...patch } : l)));
  const patchNew = (lineId: string, patch: Partial<DraftLine['newItem']>) =>
    setLines(prev => prev.map(l => (l.lineId === lineId ? { ...l, newItem: editNewItem(l.newItem, patch) } : l)));
  const patchFinished = (patch: Partial<FinishedDraft>) => setFinished(prev => (prev ? { ...prev, ...patch } : prev));
  const removeLine = (lineId: string) => setLines(prev => prev.filter(l => l.lineId !== lineId));
  const addStandard = (s: StandardComponent) =>
    setLines(prev => [...prev, addedLine({ id: s.odoo_product_id, sku: s.sku, name: s.name, display_name: displayName(s.sku, s.name), uom: s.uom }, s.default_qty)]);

  const download = (kind: 'products' | 'bom') => {
    if (!finished) return;
    const aoa = kind === 'products' ? productsSheet(finished, lines, existing) : bomSheet(finished, lines);
    if (kind === 'products' && aoa.length < 2) { toast.info('Nothing new to create: every product is already in Odoo.'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
    XLSX.writeFile(wb, `${fileStem(finished)}_${kind}.xlsx`);
  };

  const send = async () => {
    if (!finished) return;
    setConfirmOpen(false);
    setSending(true);
    setSendError(null);
    try {
      const r = await pushToOdoo(pushPayload(productId, finished, lines, existing));
      setResult(r);
      // New components now exist in Odoo: show them as matched so a second send doesn't recreate them.
      const bySku = new Map(r.created.concat(r.reused).map(c => [c.sku.toUpperCase(), c.id]));
      const next = lines.map(l => {
        if (l.status !== 'new') return l;
        const id = bySku.get(l.newItem.sku.trim().toUpperCase());
        if (!id) return l;
        const m: OdooProduct = { id, sku: l.newItem.sku.trim(), name: l.newItem.name.trim(), display_name: displayName(l.newItem.sku, l.newItem.name), uom: l.newItem.uom };
        return { ...l, status: 'match' as const, match: m };
      });
      setLines(next);
      const prod = r.created.concat(r.reused).find(c => c.kind === 'product');
      let f = finished;
      if (!finished.exists && prod) {
        f = { ...finished, exists: true, existing: { id: prod.id, sku: finished.sku.trim(), name: finished.name.trim(), display_name: displayName(finished.sku, finished.name), uom: finished.uom } };
        setFinished(f);
      }
      checkOdoo(f, next);
      toast.success('BOM created in Odoo.');
    } catch (e) {
      const err = e as Error & { details?: { problems?: string[] } | null };
      setSendError({ msg: err?.message || String(e), problems: err?.details?.problems });
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading the costing…</div>;
  if (loadError || !finished) return <div className="p-6 text-sm text-destructive">{loadError || 'Could not load the product.'}</div>;

  const units = finished.bomUnits > 0 ? finished.bomUnits : 1;
  const live = lines.filter(l => l.status !== 'skip');
  const newCount = new Set(lines.filter(l => l.status === 'new').map(l => l.newItem.sku.trim().toUpperCase())).size;
  const catList = meta?.categories ?? [];
  const uomList = meta?.uoms.map(u => ({ value: u.name, hint: u.category })) ?? [];
  const parts = splitSku(finished.sku);
  const setPart = (k: 'prefix' | 'base' | 'suffix', v: string) =>
    patchFinished({ sku: joinSku({ ...parts, [k]: k === 'suffix' ? v.toUpperCase().replace(/[^A-Z0-9_]/g, '') : upper(v) }) });
  const prefixOpts = prefixList.filter(p => p.saleable > 0).map(p => ({ value: p.prefix, hint: `${p.saleable} products · e.g. ${p.sample}` }));
  const inBom = new Set(lines.filter(l => l.status === 'match' && l.match).map(l => l.match!.sku.trim().toUpperCase()));
  const chips = standard.filter(s => !inBom.has(s.sku.trim().toUpperCase()));

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">
          Pick each line's Odoo product (or create it), then send the product and a new BOM to Odoo, or download the import files.
        </p>
        <Button variant="outline" size="sm" onClick={() => checkOdoo(finished, lines)} disabled={checking}>
          {checking ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />} Check Odoo
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { clearSaved(productId); load(); }}>Start over</Button>
      </div>

      {lookupError && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          Odoo can't be read right now ({lookupError}). You can still fill in the draft and download the files; SKUs aren't checked against Odoo.
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-3">
            Finished product
            <label className="flex items-center gap-1.5 text-xs font-normal">
              <Checkbox checked={finished.exists} onCheckedChange={v => patchFinished({ exists: v === true })} />
              Already in Odoo
            </label>
            {!finished.exists && <Badge variant="outline">New in Odoo</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {finished.exists ? (
            <Field label="Odoo product" wide>
              <OdooProductPicker value={finished.existing} onPick={p => patchFinished({ existing: p })} />
            </Field>
          ) : (
            <>
              <Field label="Name" wide><Input value={finished.name} onChange={e => patchFinished({ name: e.target.value })} /></Field>
              <Field label="SKU (prefix - base - suffix)" wide>
                <div className="flex items-center gap-1">
                  <div className="w-28"><OptionCombobox value={parts.prefix} options={prefixOpts} allowCustom placeholder="Prefix" className="h-10 font-mono" onChange={v => setPart('prefix', v)} /></div>
                  <span className="text-muted-foreground">-</span>
                  <Input className="font-mono" placeholder="Base" value={parts.base} onChange={e => setPart('base', e.target.value)} />
                  <span className="text-muted-foreground">-</span>
                  <Input className="font-mono" placeholder="Suffix, e.g. CHST" value={parts.suffix} onChange={e => setPart('suffix', e.target.value)} />
                </div>
              </Field>
              <Field label="Category" wide><OptionCombobox value={finished.category} options={catList} loading={!meta} className="h-10" onChange={v => patchFinished({ category: v })} /></Field>
              <Field label="Unit"><OptionCombobox value={finished.uom} options={uomList} loading={!meta} className="h-10" onChange={v => patchFinished({ uom: v })} /></Field>
              <Field label="Track inventory">
                <div className="h-10 flex items-center"><Checkbox checked={finished.tracked} onCheckedChange={v => patchFinished({ tracked: v === true })} /></div>
              </Field>
              <Field label="Sales price"><Input inputMode="decimal" value={finished.salePrice ?? ''} onChange={e => patchFinished({ salePrice: num(e.target.value) })} /></Field>
              <Field label="HSN code"><Input value={finished.hsn} onChange={e => patchFinished({ hsn: e.target.value })} /></Field>
              <Field label="Weight (kg)"><Input inputMode="decimal" value={finished.weightKg ?? ''} onChange={e => patchFinished({ weightKg: num(e.target.value) })} /></Field>
              <Field label="Volume (m³)"><Input inputMode="decimal" value={finished.volumeM3 ?? ''} onChange={e => patchFinished({ volumeM3: num(e.target.value) })} /></Field>
              <Field label="Image">
                {finished.imageUrl
                  ? <img src={finished.imageUrl} alt={finished.name} className="h-10 w-10 rounded object-cover border" />
                  : <span className="text-xs text-muted-foreground h-10 flex items-center">No HQ photo</span>}
              </Field>
            </>
          )}
          <Field label="BOM reference"><Input value={finished.code} placeholder="optional" onChange={e => patchFinished({ code: e.target.value })} /></Field>
          <Field label="Units per BOM">
            <Input inputMode="numeric" value={finished.bomUnits || ''} onChange={e => patchFinished({ bomUnits: num(e.target.value) ?? 0 })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            BOM lines <span className="font-normal text-muted-foreground">· {live.length} in the BOM, {newCount} new in Odoo{units !== 1 ? ` · quantities for ${units} units` : ''}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">HQ costing line</TableHead>
                <TableHead className="w-[110px]">Action</TableHead>
                <TableHead className="min-w-[280px]">Odoo product</TableHead>
                <TableHead className="min-w-[260px]">Category · tracked</TableHead>
                <TableHead className="w-[120px]">Unit</TableHead>
                <TableHead className="w-[110px]">BOM qty</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map(l => {
                const q = bomQty(l, units);
                const skuTaken = l.status === 'new' && !!existing?.has(l.newItem.sku.trim().toUpperCase());
                const added = l.cogsType === ADDED;
                return (
                  <TableRow key={l.lineId} className={l.status === 'skip' ? 'opacity-50' : ''}>
                    <TableCell className="align-top">
                      {added ? (
                        <div className="text-muted-foreground italic">Added line</div>
                      ) : (
                        <>
                          <div className="font-medium">{l.hqName}</div>
                          <div className="text-muted-foreground">{l.cogsType} · {+l.hqQty.toFixed(4)} {l.hqUnit || 'units'}{l.vendor ? ` · ${l.vendor}` : ''}</div>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <Select value={l.status} onValueChange={v => patchLine(l.lineId, { status: v as LineStatus })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="match">Existing</SelectItem>
                          <SelectItem value="new">New item</SelectItem>
                          {!added && <SelectItem value="skip">Not in BOM</SelectItem>}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="align-top space-y-1.5">
                      {l.status === 'match' && <OdooProductPicker value={l.match} onPick={p => patchLine(l.lineId, { match: p })} />}
                      {l.status === 'new' && (
                        <>
                          <Input className="h-8 text-xs" placeholder="Name" value={l.newItem.name} onChange={e => patchNew(l.lineId, { name: e.target.value })} />
                          <Input className={`h-8 text-xs font-mono ${skuTaken ? 'border-destructive' : ''}`} placeholder="SKU" value={l.newItem.sku} onChange={e => patchNew(l.lineId, { sku: e.target.value })} />
                        </>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {l.status === 'new' ? (
                        <div className="flex items-center gap-2">
                          <OptionCombobox value={l.newItem.category} options={catList} loading={!meta} onChange={v => patchNew(l.lineId, { category: v })} />
                          <Checkbox checked={l.newItem.tracked} onCheckedChange={v => patchNew(l.lineId, { tracked: v === true })} title="Track inventory" />
                        </div>
                      ) : l.status === 'match' && l.match ? (
                        <span className="text-muted-foreground">{[l.match.category, l.match.tracked == null ? null : l.match.tracked ? 'tracked' : 'not tracked'].filter(Boolean).join(' · ') || 'In Odoo'}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      {l.status === 'new'
                        ? <OptionCombobox value={l.newItem.uom} options={uomList} loading={!meta} onChange={v => patchNew(l.lineId, { uom: v })} />
                        : l.status === 'match' ? <span>{l.match?.uom || '—'}</span> : null}
                    </TableCell>
                    <TableCell className="align-top">
                      {l.status !== 'skip' && (
                        <Input className={`h-8 text-xs ${q.ok ? '' : 'border-warning'}`} inputMode="decimal"
                          value={q.qty}
                          onChange={e => { const v = num(e.target.value); patchLine(l.lineId, { qtyOverride: v == null ? null : v / units }); }} />
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {added && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLine(l.lineId)} aria-label="Remove line">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">This product has no costed material lines.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <div className="border-t px-3 py-3 space-y-2">
            <Button variant="outline" size="sm" onClick={() => setLines(prev => [...prev, addedLine(null, 1)])}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add line
            </Button>
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1">Suggested:</span>
                {chips.map(s => (
                  <button key={s.id} type="button" onClick={() => addStandard(s)}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-foreground hover:bg-primary/20 transition-colors"
                    title={`Add ${s.default_qty} ${s.uom} per unit`}>
                    <Plus className="h-3 w-3" /> {s.name} <span className="font-mono text-muted-foreground">{s.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {issues.length > 0 && (
        <Card>
          <CardContent className="py-3 space-y-1">
            {issues.map((i, n) => (
              <div key={n} className="flex items-start gap-2 text-xs">
                {i.level === 'error' ? <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />}
                <span><span className="font-medium">{i.where || 'Added line'}:</span> {i.msg}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {sendError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs space-y-1">
          <div className="font-medium">{sendError.msg}</div>
          {sendError.problems?.map(p => <div key={p}>{p}</div>)}
          <div className="text-muted-foreground">Components already created stay in Odoo; sending again reuses them.</div>
        </div>
      )}
      {result && (
        <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Sent to Odoo</div>
          <div>Created: {result.created.length ? result.created.map(c => c.sku).join(', ') : 'nothing new'}{result.reused.length ? ` · already there: ${result.reused.map(c => c.sku).join(', ')}` : ''}</div>
          <div>New BOM created.</div>
          <div className="flex gap-3">
            <a className="inline-flex items-center gap-1 underline" href={result.productUrl} target="_blank" rel="noopener noreferrer">Open product <ExternalLink className="h-3 w-3" /></a>
            {result.bomUrl && <a className="inline-flex items-center gap-1 underline" href={result.bomUrl} target="_blank" rel="noopener noreferrer">Open BOM <ExternalLink className="h-3 w-3" /></a>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <Button onClick={() => setConfirmOpen(true)} disabled={sending || errors.length > 0 || !!lookupError}
            title={errors.length ? 'Fix the problems listed above first' : lookupError ? 'Odoo is not reachable' : undefined}>
            {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />} Send to Odoo
          </Button>
        )}
        <Button variant="outline" onClick={() => download('products')} disabled={finished.exists}>
          <Download className="h-4 w-4 mr-1.5" /> Products file
        </Button>
        <Button variant="outline" onClick={() => download('bom')} disabled={live.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> BOM file
        </Button>
        <span className="text-xs text-muted-foreground">Files: import the products file first, then the BOM file.</span>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {finished.exists ? finished.existing?.sku : finished.sku} to Odoo?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <div>{newCount} new component{newCount === 1 ? '' : 's'} will be created.</div>
                <div>{finished.exists ? `The BOM is added to ${finished.existing?.display_name}.` : `${finished.sku} will be created as a new product${finished.imageUrl ? ', with its photo' : ''}.`}</div>
                <div>A new BOM for {units} unit{units === 1 ? '' : 's'} with {live.length} line{live.length === 1 ? '' : 's'} will be created.</div>
                <div className="text-muted-foreground pt-1">Odoo records can be archived afterwards but not undone from HQ.</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={send}>Send to Odoo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs text-muted-foreground block">{label}</span>
      {children}
    </div>
  );
}
