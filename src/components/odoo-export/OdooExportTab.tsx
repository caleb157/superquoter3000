// Product "Odoo" tab: review a product's BOM against Odoo, then send the new components,
// the product and its BOM straight to Odoo (admins), or download the two import files.
// Quantities come from the costing engine (src/lib/odoo-bom.ts); Odoo is read live.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, Send, XCircle } from 'lucide-react';
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
import {
  bomQty, bomSheet, buildDraftLines, checkDraft, defaultFinished, displayName, fileStem, productsSheet, pushPayload,
  type DraftLine, type FinishedDraft, type LineStatus, type OdooProduct,
} from '@/lib/odoo-bom';
import {
  loadLinks, odooMeta, odooProductsBySku, pushToOdoo, removeLink, saveLink, suggestOdooProducts,
  type OdooMeta, type PushResult,
} from '@/lib/odoo-products';
import { OdooProductPicker } from './OdooProductPicker';

type Saved = { finished: FinishedDraft; lines: Record<string, Pick<DraftLine, 'status' | 'match' | 'newItem' | 'qtyOverride'>> };
const storeKey = (id: string) => `odoo-bom-draft:${id}`;
const readSaved = (id: string): Saved | null => {
  try { const s = localStorage.getItem(storeKey(id)); return s ? JSON.parse(s) : null; } catch { return null; }
};
const writeSaved = (id: string, s: Saved) => { try { localStorage.setItem(storeKey(id), JSON.stringify(s)); } catch { /* per-browser draft only */ } };
const clearSaved = (id: string) => { try { localStorage.removeItem(storeKey(id)); } catch { /* ignore */ } };

const num = (v: string) => (v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function OdooExportTab({ productId }: { productId: string }) {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [finished, setFinished] = useState<FinishedDraft | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [linksAvailable, setLinksAvailable] = useState(true);
  const [meta, setMeta] = useState<OdooMeta | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Set<string> | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, OdooProduct[]>>({});
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const [sendError, setSendError] = useState<{ msg: string; problems?: string[] } | null>(null);
  const ready = useRef(false);

  const checkOdoo = useCallback(async (f: FinishedDraft, ls: DraftLine[]) => {
    setChecking(true);
    try {
      const skus = [f.sku, ...ls.map(l => (l.status === 'new' ? l.newItem.sku : l.match?.sku || ''))].filter(s => s && !/-$/.test(s.trim()));
      const found = await odooProductsBySku(skus);
      setExisting(new Set(found.map(p => p.sku.trim().toUpperCase())));
      setLookupError(null);
      return found;
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
      setExisting(null);
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    ready.current = false;
    try {
      const b = await loadProductBundle(productId);
      if (!b) throw new Error('Product not found.');
      const product = b.products.find(p => p.id === productId);
      const res = computeResults(b).get(productId);
      const rows = res?.resolvedCogsRows ?? b.cogs.filter(c => c.product_id === productId);
      const keysProbe = buildDraftLines(rows, new Map());
      const { links, available } = await loadLinks([...new Set(keysProbe.map(l => l.key))]);
      setLinksAvailable(available);
      let ls = buildDraftLines(rows, links);
      let f = defaultFinished(product, { volumeM3: res?.finalUnitCbm ?? null });
      const saved = readSaved(productId);
      if (saved) {
        f = { ...f, ...saved.finished };
        ls = ls.map(l => (saved.lines[l.lineId] ? { ...l, ...saved.lines[l.lineId] } : l));
      }
      setFinished(f);
      setLines(ls);
      setResult(null);
      setSendError(null);
      ready.current = true;
      setLoading(false);

      // Live Odoo reads, in the background.
      odooMeta().then(setMeta).catch(e => setLookupError(e instanceof Error ? e.message : String(e)));
      checkOdoo(f, ls);
      const unmatched = ls.filter(l => l.status !== 'skip' && !l.match).map(l => l.hqName);
      suggestOdooProducts([...new Set(unmatched)]).then(setSuggestions).catch(() => { /* lookup error shown already */ });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [productId, checkOdoo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ready.current || !finished) return;
    const savedLines: Saved['lines'] = {};
    for (const l of lines) savedLines[l.lineId] = { status: l.status, match: l.match, newItem: l.newItem, qtyOverride: l.qtyOverride };
    writeSaved(productId, { finished, lines: savedLines });
  }, [finished, lines, productId]);

  const issues = useMemo(() => (finished ? checkDraft(finished, lines, existing) : []), [finished, lines, existing]);
  const errors = issues.filter(i => i.level === 'error');

  const patchLine = (lineId: string, patch: Partial<DraftLine>) =>
    setLines(prev => prev.map(l => (l.lineId === lineId ? { ...l, ...patch } : l)));
  const patchNew = (lineId: string, patch: Partial<DraftLine['newItem']>) =>
    setLines(prev => prev.map(l => (l.lineId === lineId ? { ...l, newItem: { ...l.newItem, ...patch } } : l)));
  const patchFinished = (patch: Partial<FinishedDraft>) => setFinished(prev => (prev ? { ...prev, ...patch } : prev));

  const pick = async (l: DraftLine, p: OdooProduct) => {
    patchLine(l.lineId, { status: 'match', match: p, qtyOverride: null });
    if (linksAvailable && !(await saveLink(l.key, l.cogsType, l.hqName, p))) setLinksAvailable(false);
  };
  const setStatus = async (l: DraftLine, status: LineStatus) => {
    patchLine(l.lineId, { status, qtyOverride: null });
    if (status !== 'match' && l.match && linksAvailable) {
      await removeLink(l.key);
      patchLine(l.lineId, { match: null });
    }
  };

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
      // Remember every new component as matched, so the next product that uses it is pre-matched.
      const bySku = new Map(r.created.concat(r.reused).map(c => [c.sku.toUpperCase(), c.id]));
      const next = lines.map(l => {
        if (l.status !== 'new') return l;
        const id = bySku.get(l.newItem.sku.trim().toUpperCase());
        if (!id) return l;
        const m: OdooProduct = { id, sku: l.newItem.sku.trim(), name: l.newItem.name.trim(), display_name: displayName(l.newItem.sku, l.newItem.name), uom: l.newItem.uom };
        if (linksAvailable) saveLink(l.key, l.cogsType, l.hqName, m);
        return { ...l, status: 'match' as const, match: m };
      });
      setLines(next);
      checkOdoo(finished, next);
      toast.success(r.bomReused ? 'Sent. The product already had a BOM in Odoo, so no new BOM was made.' : 'Product and BOM created in Odoo.');
    } catch (e) {
      const err = e as Error & { details?: { problems?: string[] } | null };
      setSendError({ msg: err?.message || String(e), problems: err?.details?.problems });
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading the costing…</div>;
  if (loadError || !finished) return <div className="p-6 text-sm text-destructive">{loadError || 'Could not load the product.'}</div>;

  const live = lines.filter(l => l.status !== 'skip');
  const newCount = new Set(lines.filter(l => l.status === 'new').map(l => l.newItem.sku.trim().toUpperCase())).size;
  const finishedInOdoo = !!existing?.has(finished.sku.trim().toUpperCase());
  const catList = meta?.categories ?? [];
  const uomList = meta?.uoms.map(u => u.name) ?? [];

  return (
    <div className="space-y-4 pt-2">
      <datalist id="odoo-cats">{catList.map(c => <option key={c} value={c} />)}</datalist>
      <datalist id="odoo-uoms">{uomList.map(u => <option key={u} value={u} />)}</datalist>
      <datalist id="odoo-routes">{(meta?.routes ?? []).map(r => <option key={r} value={r} />)}</datalist>
      <datalist id="odoo-companies">{(meta?.companies ?? []).map(c => <option key={c} value={c} />)}</datalist>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">
          Check each line against Odoo, then send the product and its BOM to Odoo, or download the two import files.
        </p>
        <Button variant="outline" size="sm" onClick={() => checkOdoo(finished, lines)} disabled={checking}>
          {checking ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />} Check Odoo
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { clearSaved(productId); load(); }}>Start over</Button>
      </div>

      {lookupError && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          Odoo can't be read right now ({lookupError}). You can still fill in the draft and download the files; SKUs aren't checked against Odoo.
        </div>
      )}
      {!linksAvailable && (
        <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
          Matches aren't remembered for the next product yet (the odoo_component_links table hasn't been added).
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Finished product
            {existing && (finishedInOdoo
              ? <Badge variant="secondary">Already in Odoo</Badge>
              : <Badge variant="outline">New in Odoo</Badge>)}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" wide><Input value={finished.name} onChange={e => patchFinished({ name: e.target.value })} /></Field>
          <Field label="SKU"><Input value={finished.sku} placeholder="e.g. RWH-ADC4-DARK" onChange={e => patchFinished({ sku: e.target.value })} /></Field>
          <Field label="BOM reference"><Input value={finished.code} placeholder="e.g. RADC Dark" onChange={e => patchFinished({ code: e.target.value })} /></Field>
          <Field label="Category" wide><Input list="odoo-cats" value={finished.category} onChange={e => patchFinished({ category: e.target.value })} /></Field>
          <Field label="Unit"><Input list="odoo-uoms" value={finished.uom} onChange={e => patchFinished({ uom: e.target.value })} /></Field>
          <Field label="Track inventory">
            <div className="h-10 flex items-center"><Checkbox checked={finished.tracked} onCheckedChange={v => patchFinished({ tracked: v === true })} /></div>
          </Field>
          <Field label="Sales price"><Input inputMode="decimal" value={finished.salePrice ?? ''} onChange={e => patchFinished({ salePrice: num(e.target.value) })} /></Field>
          <Field label="HSN code"><Input value={finished.hsn} onChange={e => patchFinished({ hsn: e.target.value })} /></Field>
          <Field label="Weight (kg)"><Input inputMode="decimal" value={finished.weightKg ?? ''} onChange={e => patchFinished({ weightKg: num(e.target.value) })} /></Field>
          <Field label="Volume (m³)"><Input inputMode="decimal" value={finished.volumeM3 ?? ''} onChange={e => patchFinished({ volumeM3: num(e.target.value) })} /></Field>
          <Field label="Route"><Input list="odoo-routes" value={finished.route} onChange={e => patchFinished({ route: e.target.value })} /></Field>
          <Field label="Company" wide><Input list="odoo-companies" value={finished.company} onChange={e => patchFinished({ company: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">BOM lines <span className="font-normal text-muted-foreground">· {live.length} in the BOM, {newCount} new in Odoo</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">HQ costing line</TableHead>
                <TableHead className="w-[110px]">Action</TableHead>
                <TableHead className="min-w-[260px]">Odoo product</TableHead>
                <TableHead className="min-w-[250px]">Category · tracked</TableHead>
                <TableHead className="w-[110px]">Unit</TableHead>
                <TableHead className="w-[110px]">BOM qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map(l => {
                const q = bomQty(l);
                const sugg = !l.match && l.status !== 'skip' ? (suggestions[l.hqName] ?? []) : [];
                const skuTaken = l.status === 'new' && !!existing?.has(l.newItem.sku.trim().toUpperCase());
                return (
                  <TableRow key={l.lineId} className={l.status === 'skip' ? 'opacity-50' : ''}>
                    <TableCell className="align-top">
                      <div className="font-medium">{l.hqName}</div>
                      <div className="text-muted-foreground">{l.cogsType} · {+l.hqQty.toFixed(4)} {l.hqUnit || 'units'}{l.vendor ? ` · ${l.vendor}` : ''}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Select value={l.status} onValueChange={v => setStatus(l, v as LineStatus)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="match">Existing</SelectItem>
                          <SelectItem value="new">New item</SelectItem>
                          <SelectItem value="skip">Not in BOM</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="align-top space-y-1.5">
                      {l.status === 'match' && <OdooProductPicker value={l.match} initialQuery={l.hqName} onPick={p => pick(l, p)} />}
                      {l.status === 'new' && (
                        <>
                          <Input className="h-8 text-xs" placeholder="Name" value={l.newItem.name} onChange={e => patchNew(l.lineId, { name: e.target.value })} />
                          <div className="flex gap-1.5">
                            <Input className={`h-8 text-xs ${skuTaken ? 'border-destructive' : ''}`} placeholder="SKU" value={l.newItem.sku} onChange={e => patchNew(l.lineId, { sku: e.target.value })} />
                            <Input className="h-8 text-xs w-24" placeholder="Cost ₹" inputMode="decimal" value={l.newItem.cost ?? ''} onChange={e => patchNew(l.lineId, { cost: num(e.target.value) })} />
                          </div>
                        </>
                      )}
                      {sugg.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {sugg.map(p => (
                            <button key={p.id ?? p.sku} type="button" onClick={() => pick(l, p)}
                              className="rounded border px-1.5 py-0.5 text-[11px] text-left hover:bg-muted" title="Use this Odoo product">
                              Use {p.display_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {l.status === 'new' ? (
                        <div className="flex items-center gap-2">
                          <Input list="odoo-cats" className="h-8 text-xs" value={l.newItem.category} onChange={e => patchNew(l.lineId, { category: e.target.value })} />
                          <Checkbox checked={l.newItem.tracked} onCheckedChange={v => patchNew(l.lineId, { tracked: v === true })} title="Track inventory" />
                        </div>
                      ) : l.status === 'match' && l.match ? (
                        <span className="text-muted-foreground">{[l.match.category, l.match.tracked == null ? null : l.match.tracked ? 'tracked' : 'not tracked'].filter(Boolean).join(' · ') || 'In Odoo'}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      {l.status === 'new'
                        ? <Input list="odoo-uoms" className="h-8 text-xs" value={l.newItem.uom} onChange={e => patchNew(l.lineId, { uom: e.target.value, })} />
                        : l.status === 'match' ? <span>{l.match?.uom || '—'}</span> : null}
                    </TableCell>
                    <TableCell className="align-top">
                      {l.status !== 'skip' && (
                        <Input className={`h-8 text-xs ${q.ok ? '' : 'border-amber-500'}`} inputMode="decimal"
                          value={l.qtyOverride ?? q.qty}
                          onChange={e => patchLine(l.lineId, { qtyOverride: num(e.target.value) })} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">This product has no costed material lines.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {issues.length > 0 && (
        <Card>
          <CardContent className="py-3 space-y-1">
            {issues.map((i, n) => (
              <div key={n} className="flex items-start gap-2 text-xs">
                {i.level === 'error' ? <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />}
                <span><span className="font-medium">{i.where}:</span> {i.msg}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {sendError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs space-y-1">
          <div className="font-medium">{sendError.msg}</div>
          {sendError.problems?.map(p => <div key={p}>{p}</div>)}
          <div className="text-muted-foreground">Anything already created stays in Odoo; sending again reuses it instead of making duplicates.</div>
        </div>
      )}
      {result && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Sent to Odoo</div>
          <div>Created: {result.created.length ? result.created.map(c => c.sku).join(', ') : 'nothing new'}{result.reused.length ? ` · already there: ${result.reused.map(c => c.sku).join(', ')}` : ''}</div>
          <div>{result.bomReused ? 'The product already had a BOM, so no second BOM was made.' : 'BOM created.'}</div>
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
        <Button variant="outline" onClick={() => download('products')} disabled={!finished.sku.trim()}>
          <Download className="h-4 w-4 mr-1.5" /> Products file
        </Button>
        <Button variant="outline" onClick={() => download('bom')} disabled={!finished.sku.trim() || live.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> BOM file
        </Button>
        <span className="text-xs text-muted-foreground">Files: import the products file first, then the BOM file.</span>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {finished.sku || finished.name} to Odoo?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <div>{newCount} new component{newCount === 1 ? '' : 's'} will be created.</div>
                <div>{finishedInOdoo ? `${finished.sku} is already in Odoo and will be reused.` : `${finished.sku} will be created as a new product.`}</div>
                <div>A BOM with {live.length} line{live.length === 1 ? '' : 's'} will be created, unless the product already has one.</div>
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
    <label className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
