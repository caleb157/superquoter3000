// Inquiry → Send to Odoo: several products at once. Each HQ item used across the selected
// products is decided once (existing Odoo product, new item, or not in the BOM) and applies to
// every product that uses it; quantities stay each product's own (src/lib/odoo-bom.ts).
// Admins send the products one after another through odoo-bom-push, which reuses anything
// already in Odoo by SKU, so a new component shared by two products is created once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, Send, XCircle } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
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
import { OdooProductPicker } from '@/components/odoo-export/OdooProductPicker';
import { SkuPrefixBar } from '@/components/odoo-export/SkuPrefixBar';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { computeResults, loadBundle } from '@/lib/costing-workspace';
import {
  applyPrefixes, applyShared, bomQty, editNewItem, buildDraftLines, checkAcross, checkDraft, combinedBomSheet, combinedProductsSheet, defaultFinished,
  displayName, pushPayload, readLastPrefixes, sharedItems, writeLastPrefixes,
  type DraftLine, type FinishedDraft, type Issue, type LineStatus, type OdooProduct, type Prefixes, type ProductDraft, type SharedItem,
} from '@/lib/odoo-bom';
import {
  loadLinks, odooMeta, odooProductsBySku, pushToOdoo, removeLink, saveLink, suggestOdooProducts, type OdooMeta, type PushResult,
} from '@/lib/odoo-products';

type Base = { productId: string; finished: FinishedDraft; lines: DraftLine[] };
type SendState = { state: 'sending' | 'done' | 'error'; result?: PushResult; error?: string; problems?: string[] };
type Saved = { shared: Record<string, SharedItem>; finished: Record<string, FinishedDraft>; prefixes?: Prefixes };

const storeKey = (id: string) => `odoo-bom-bulk:${id}`;
const readSaved = (id: string): Saved | null => {
  try { const s = localStorage.getItem(storeKey(id)); return s ? JSON.parse(s) : null; } catch { return null; }
};
const writeSaved = (id: string, s: Saved) => { try { localStorage.setItem(storeKey(id), JSON.stringify(s)); } catch { /* per-browser draft only */ } };
const clearSaved = (id: string) => { try { localStorage.removeItem(storeKey(id)); } catch { /* ignore */ } };
/** Applies the SKU prefixes to every product: finished SKUs per product, raw pieces through their (per-product) shared item. */
function fillPrefixes(bases: Base[], finished: Record<string, FinishedDraft>, shared: Map<string, SharedItem>, next: Prefixes, prev: Prefixes | null) {
  const fin = { ...finished };
  const sh = new Map(shared);
  for (const b of bases) {
    const r = applyPrefixes(fin[b.productId] ?? b.finished, applyShared(b.lines, sh), next, prev);
    fin[b.productId] = r.finished;
    for (const l of r.lines) {
      const s = sh.get(l.key);
      if (s && s.newItem.sku !== l.newItem.sku) sh.set(l.key, { ...s, newItem: { ...s.newItem, sku: l.newItem.sku } });
    }
  }
  return { finished: fin, shared: sh };
}
const num = (v: string) => (v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export default function InquiryOdooExport() {
  const { id: inquiryId = '' } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const wanted = useMemo(() => (params.get('products') || '').split(',').filter(Boolean), [params]);

  const [title, setTitle] = useState('Inquiry');
  useDocumentTitle(`Send to Odoo · ${title}`);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bases, setBases] = useState<Base[]>([]);
  const [finished, setFinished] = useState<Record<string, FinishedDraft>>({});
  const [shared, setShared] = useState<Map<string, SharedItem>>(new Map());
  const [prefixes, setPrefixes] = useState<Prefixes>({ product: '', raw: '' });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [linksAvailable, setLinksAvailable] = useState(true);
  const [meta, setMeta] = useState<OdooMeta | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Set<string> | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, OdooProduct[]>>({});
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Record<string, SendState>>({});
  const ready = useRef(false);

  const drafts: ProductDraft[] = useMemo(
    () => bases.map(b => ({ productId: b.productId, finished: finished[b.productId] ?? b.finished, lines: applyShared(b.lines, shared) })),
    [bases, finished, shared],
  );
  const chosen = useMemo(() => drafts.filter(d => picked.has(d.productId)), [drafts, picked]);
  const items = useMemo(() => sharedItems(chosen), [chosen]);

  const checkOdoo = useCallback(async (ds: ProductDraft[]) => {
    setChecking(true);
    try {
      const skus = ds.flatMap(d => [d.finished.sku, ...d.lines.map(l => (l.status === 'new' ? l.newItem.sku : l.match?.sku || ''))])
        .filter(s => s && !/-$/.test(s.trim()));
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
    try {
      const b = await loadBundle(inquiryId);
      if (!b) throw new Error('Inquiry not found.');
      setTitle(b.inq?.rfq_number || b.inq?.title || 'Inquiry');
      const results = computeResults(b);
      const products = wanted.length ? b.products.filter(p => wanted.includes(p.id)) : b.products;
      const probe = products.map(p => buildDraftLines(results.get(p.id)?.resolvedCogsRows ?? [], new Map(), p.id));
      void probe;
      const links = new Map(); // matches are never remembered between products
      setLinksAvailable(true);
      const nextBases: Base[] = products.map(p => {
        const r = results.get(p.id);
        let f = defaultFinished(p, { volumeM3: r?.finalUnitCbm ?? null });
        // A finished-product draft started on the product's own Odoo tab carries over.
        try { const own = JSON.parse(localStorage.getItem(`odoo-bom-draft:${p.id}`) || 'null'); if (own?.finished) f = { ...f, ...own.finished }; } catch { /* none */ }
        return { productId: p.id, finished: f, lines: buildDraftLines(r?.resolvedCogsRows ?? [], links, p.id) };
      });
      const saved = readSaved(inquiryId);
      const sh = new Map<string, SharedItem>();
      for (const base of nextBases) {
        for (const l of base.lines) if (!sh.has(l.key)) sh.set(l.key, { status: l.status, match: l.match, newItem: l.newItem });
      }
      // A saved decision wins, unless the item has since been linked to an Odoo product.
      if (saved) for (const [k, v] of Object.entries(saved.shared)) if (sh.has(k) && !(sh.get(k)!.match && !v.match)) sh.set(k, v);
      const fin: Record<string, FinishedDraft> = Object.fromEntries(nextBases.map(x => [x.productId, { ...x.finished, ...(saved?.finished?.[x.productId] ?? {}) }]));
      const px = saved?.prefixes ?? { product: '', raw: readLastPrefixes().raw };
      const filled = fillPrefixes(nextBases, fin, sh, px, null);
      setBases(nextBases);
      setFinished(filled.finished);
      setShared(filled.shared);
      setPrefixes(px);
      setPicked(new Set(nextBases.map(x => x.productId)));
      setSent({});
      ready.current = true;
      setLoading(false);

      const ds = nextBases.map(x => ({ ...x, finished: filled.finished[x.productId], lines: applyShared(x.lines, filled.shared) }));
      odooMeta().then(setMeta).catch(e => setLookupError(e instanceof Error ? e.message : String(e)));
      checkOdoo(ds);
      const unmatched = [...sh.entries()].filter(([, v]) => v.status !== 'skip' && !v.match).map(([k]) => ds.flatMap(d => d.lines).find(l => l.key === k)!.hqName);
      suggestOdooProducts([...new Set(unmatched)]).then(setSuggestions).catch(() => { /* shown as lookup error */ });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [inquiryId, wanted, checkOdoo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ready.current) return;
    writeSaved(inquiryId, { shared: Object.fromEntries(shared), finished, prefixes });
  }, [shared, finished, prefixes, inquiryId]);

  const changePrefixes = (next: Prefixes) => {
    const filled = fillPrefixes(bases, Object.fromEntries(bases.map(b => [b.productId, finished[b.productId] ?? b.finished])), shared, next, prefixes);
    setFinished(filled.finished);
    setShared(filled.shared);
    setPrefixes(next);
    writeLastPrefixes(next);
  };

  const issuesByProduct = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const d of chosen) m.set(d.productId, checkDraft(d.finished, d.lines, existing));
    return m;
  }, [chosen, existing]);
  const across = useMemo(() => checkAcross(chosen), [chosen]);
  const blocked = (id: string) => (issuesByProduct.get(id) ?? []).some(i => i.level === 'error');
  const sendable = chosen.filter(d => !blocked(d.productId) && sent[d.productId]?.state !== 'done');

  const patchShared = (key: string, patch: Partial<SharedItem>) =>
    setShared(prev => { const n = new Map(prev); n.set(key, { ...n.get(key)!, ...patch }); return n; });
  const patchNew = (key: string, patch: Partial<SharedItem['newItem']>) =>
    setShared(prev => { const n = new Map(prev); const s = n.get(key)!; n.set(key, { ...s, newItem: editNewItem(s.newItem, patch) }); return n; });
  const patchFinished = (id: string, patch: Partial<FinishedDraft>) =>
    setFinished(prev => ({ ...prev, [id]: { ...(prev[id] ?? bases.find(b => b.productId === id)!.finished), ...patch } }));

  const pick = async (first: DraftLine, p: OdooProduct) => {
    patchShared(first.key, { status: 'match', match: p });
    if (linksAvailable && !(await saveLink(first.key, first.cogsType, first.hqName, p))) setLinksAvailable(false);
  };
  const setStatus = async (first: DraftLine, status: LineStatus) => {
    const cur = shared.get(first.key);
    patchShared(first.key, { status, ...(status !== 'match' ? { match: null } : {}) });
    if (status !== 'match' && cur?.match && linksAvailable) await removeLink(first.key);
  };

  const download = (kind: 'products' | 'bom') => {
    if (!chosen.length) return;
    const aoa = kind === 'products' ? combinedProductsSheet(chosen, existing) : combinedBomSheet(chosen);
    if (kind === 'products' && aoa.length < 2) { toast.info('Nothing new to create: every product is already in Odoo.'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
    XLSX.writeFile(wb, `${String(title).replace(/[^A-Za-z0-9._-]+/g, '-')}_${kind}.xlsx`);
  };

  const sendAll = async () => {
    setConfirmOpen(false);
    setSending(true);
    let sh = shared;
    let ok = 0;
    for (const d0 of sendable) {
      // Re-apply the latest shared decisions: items created for an earlier product are now matched.
      const base = bases.find(b => b.productId === d0.productId)!;
      const d = { ...d0, lines: applyShared(base.lines, sh) };
      setSent(prev => ({ ...prev, [d.productId]: { state: 'sending' } }));
      try {
        const r = await pushToOdoo(pushPayload(d.productId, d.finished, d.lines, existing));
        setSent(prev => ({ ...prev, [d.productId]: { state: 'done', result: r } }));
        ok += 1;
        const bySku = new Map(r.created.concat(r.reused).map(c => [c.sku.toUpperCase(), c.id]));
        const next = new Map(sh);
        for (const l of d.lines) {
          if (l.status !== 'new') continue;
          const pid = bySku.get(l.newItem.sku.trim().toUpperCase());
          if (!pid) continue;
          const m: OdooProduct = { id: pid, sku: l.newItem.sku.trim(), name: l.newItem.name.trim(), display_name: displayName(l.newItem.sku, l.newItem.name), uom: l.newItem.uom };
          next.set(l.key, { status: 'match', match: m, newItem: l.newItem });
          if (linksAvailable) saveLink(l.key, l.cogsType, l.hqName, m);
        }
        sh = next;
        setShared(next);
      } catch (e) {
        const err = e as Error & { details?: { problems?: string[] } | null };
        setSent(prev => ({ ...prev, [d.productId]: { state: 'error', error: err?.message || String(e), problems: err?.details?.problems } }));
      }
    }
    setSending(false);
    checkOdoo(bases.map(b => ({ productId: b.productId, finished: finished[b.productId] ?? b.finished, lines: applyShared(b.lines, sh) })));
    if (ok) toast.success(`${ok} product${ok === 1 ? '' : 's'} sent to Odoo.`);
  };

  const catList = meta?.categories ?? [];
  const uomList = meta?.uoms.map(u => u.name) ?? [];
  const newCount = new Set(items.filter(i => shared.get(i.key)?.status === 'new').map(i => shared.get(i.key)!.newItem.sku.trim().toUpperCase())).size;
  const allIssues = [
    ...across,
    ...chosen.flatMap(d => (issuesByProduct.get(d.productId) ?? []).map(i => ({ ...i, where: `${d.finished.sku || d.finished.name} · ${i.where}` }))),
  ];

  return (
    <AppLayout>
      <div className="px-3 sm:px-4 py-3 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" onClick={() => navigate(`/inquiry/${inquiryId}`)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <PageBreadcrumbs canonical={[{ label: 'Inquiries', to: '/inquiries' }, { label: title, to: `/inquiry/${inquiryId}` }]} current="Send to Odoo" />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <h1 className="page-title">Send to Odoo</h1>
            <p className="text-xs text-muted-foreground">Each item is decided once for every product that uses it. Quantities stay each product's own.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => checkOdoo(chosen)} disabled={checking || loading}>
            {checking ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />} Check Odoo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { clearSaved(inquiryId); load(); }} disabled={loading}>Start over</Button>
        </div>

        {loading && <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading the costing…</div>}
        {!loading && loadError && <div className="p-6 text-sm text-destructive">{loadError}</div>}
        {!loading && !loadError && (
          <>
            <SkuPrefixBar value={prefixes} onChange={changePrefixes} />
            <datalist id="odoo-cats">{catList.map(c => <option key={c} value={c} />)}</datalist>
            <datalist id="odoo-uoms">{uomList.map(u => <option key={u} value={u} />)}</datalist>
            {lookupError && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                Odoo can't be read right now ({lookupError}). You can still fill in the draft and download the files; SKUs aren't checked against Odoo.
              </div>
            )}
            {!linksAvailable && (
              <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                Matches aren't remembered for the next product yet (the odoo_component_links table hasn't been added).
              </div>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Products <span className="font-normal text-muted-foreground">· {chosen.length} of {drafts.length} selected</span></CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox checked={drafts.length > 0 && picked.size === drafts.length}
                          onCheckedChange={v => setPicked(v === true ? new Set(drafts.map(d => d.productId)) : new Set())} />
                      </TableHead>
                      <TableHead className="min-w-[220px]">Name</TableHead>
                      <TableHead className="min-w-[150px]">SKU</TableHead>
                      <TableHead className="min-w-[120px]">BOM reference</TableHead>
                      <TableHead className="min-w-[220px]">Category · tracked</TableHead>
                      <TableHead className="min-w-[160px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map(d => {
                      const f = d.finished;
                      const s = sent[d.productId];
                      const errs = (issuesByProduct.get(d.productId) ?? []).filter(i => i.level === 'error').length;
                      const inOdoo = !!existing?.has(f.sku.trim().toUpperCase());
                      return (
                        <TableRow key={d.productId} className={picked.has(d.productId) ? '' : 'opacity-50'}>
                          <TableCell className="align-top">
                            <Checkbox checked={picked.has(d.productId)}
                              onCheckedChange={v => setPicked(prev => { const n = new Set(prev); if (v === true) n.add(d.productId); else n.delete(d.productId); return n; })} />
                          </TableCell>
                          <TableCell className="align-top"><Input className="h-8 text-xs" value={f.name} onChange={e => patchFinished(d.productId, { name: e.target.value })} /></TableCell>
                          <TableCell className="align-top"><Input className="h-8 text-xs" value={f.sku} placeholder="e.g. RWH-ADC4-DARK" onChange={e => patchFinished(d.productId, { sku: e.target.value })} /></TableCell>
                          <TableCell className="align-top"><Input className="h-8 text-xs" value={f.code} onChange={e => patchFinished(d.productId, { code: e.target.value })} /></TableCell>
                          <TableCell className="align-top">
                            <div className="flex items-center gap-2">
                              <Input list="odoo-cats" className="h-8 text-xs" value={f.category} onChange={e => patchFinished(d.productId, { category: e.target.value })} />
                              <Checkbox checked={f.tracked} onCheckedChange={v => patchFinished(d.productId, { tracked: v === true })} title="Track inventory" />
                            </div>
                          </TableCell>
                          <TableCell className="align-top space-y-1">
                            {s?.state === 'sending' && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Sending…</span>}
                            {s?.state === 'done' && s.result && (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" /> Sent{s.result.bomReused ? ' (BOM already there)' : ''}</span>
                                <div className="flex gap-2">
                                  <a className="inline-flex items-center gap-0.5 underline" href={s.result.productUrl} target="_blank" rel="noopener noreferrer">Product <ExternalLink className="h-3 w-3" /></a>
                                  {s.result.bomUrl && <a className="inline-flex items-center gap-0.5 underline" href={s.result.bomUrl} target="_blank" rel="noopener noreferrer">BOM <ExternalLink className="h-3 w-3" /></a>}
                                </div>
                              </div>
                            )}
                            {s?.state === 'error' && <div className="text-destructive">{s.error}{s.problems?.map(p => <div key={p}>{p}</div>)}</div>}
                            {!s && (errs > 0
                              ? <Badge variant="destructive">{errs} to fix</Badge>
                              : existing ? <Badge variant={inOdoo ? 'secondary' : 'outline'}>{inOdoo ? 'Already in Odoo' : 'New in Odoo'}</Badge> : null)}
                            <button type="button" className="block text-muted-foreground underline" onClick={() => navigate(`/product/${d.productId}?tab=odoo`)}>Open product tab</button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Items <span className="font-normal text-muted-foreground">· {items.length} across the selected products, {newCount} new in Odoo</span></CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">HQ costing item</TableHead>
                      <TableHead className="w-[110px]">Action</TableHead>
                      <TableHead className="min-w-[260px]">Odoo product</TableHead>
                      <TableHead className="min-w-[250px]">Category · tracked</TableHead>
                      <TableHead className="w-[110px]">Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(({ key, first, usedIn }) => {
                      const s = shared.get(key)!;
                      const sugg = !s.match && s.status !== 'skip' ? (suggestions[first.hqName] ?? []) : [];
                      const skuTaken = s.status === 'new' && !!existing?.has(s.newItem.sku.trim().toUpperCase());
                      const unconvertible = chosen.some(d => d.lines.some(l => l.key === key && l.status !== 'skip' && !bomQty(l).ok));
                      return (
                        <TableRow key={key} className={s.status === 'skip' ? 'opacity-50' : ''}>
                          <TableCell className="align-top">
                            <div className="font-medium">{first.hqName}</div>
                            <div className="text-muted-foreground">{first.cogsType} · {first.hqUnit || 'units'} · in {usedIn} product{usedIn === 1 ? '' : 's'}</div>
                          </TableCell>
                          <TableCell className="align-top">
                            <Select value={s.status} onValueChange={v => setStatus(first, v as LineStatus)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="match">Existing</SelectItem>
                                <SelectItem value="new">New item</SelectItem>
                                <SelectItem value="skip">Not in BOM</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="align-top space-y-1.5">
                            {s.status === 'match' && <OdooProductPicker value={s.match} initialQuery={first.hqName} onPick={p => pick(first, p)} />}
                            {s.status === 'new' && (
                              <>
                                <Input className="h-8 text-xs" placeholder="Name" value={s.newItem.name} onChange={e => patchNew(key, { name: e.target.value })} />
                                <div className="flex gap-1.5">
                                  <Input className={`h-8 text-xs ${skuTaken ? 'border-destructive' : ''}`} placeholder="SKU" value={s.newItem.sku} onChange={e => patchNew(key, { sku: e.target.value })} />
                                  <Input className="h-8 text-xs w-24" placeholder="Cost ₹" inputMode="decimal" value={s.newItem.cost ?? ''} onChange={e => patchNew(key, { cost: num(e.target.value) })} />
                                </div>
                              </>
                            )}
                            {sugg.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {sugg.map(p => (
                                  <button key={p.id ?? p.sku} type="button" onClick={() => pick(first, p)}
                                    className="rounded border px-1.5 py-0.5 text-[11px] text-left hover:bg-muted" title="Use this Odoo product">
                                    Use {p.display_name}
                                  </button>
                                ))}
                              </div>
                            )}
                            {unconvertible && <div className="text-warning">Unit can't be converted; set the quantity on the product's Odoo tab.</div>}
                          </TableCell>
                          <TableCell className="align-top">
                            {s.status === 'new' ? (
                              <div className="flex items-center gap-2">
                                <Input list="odoo-cats" className="h-8 text-xs" value={s.newItem.category} onChange={e => patchNew(key, { category: e.target.value })} />
                                <Checkbox checked={s.newItem.tracked} onCheckedChange={v => patchNew(key, { tracked: v === true })} title="Track inventory" />
                              </div>
                            ) : s.status === 'match' && s.match ? (
                              <span className="text-muted-foreground">{[s.match.category, s.match.tracked == null ? null : s.match.tracked ? 'tracked' : 'not tracked'].filter(Boolean).join(' · ') || 'In Odoo'}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="align-top">
                            {s.status === 'new'
                              ? <Input list="odoo-uoms" className="h-8 text-xs" value={s.newItem.uom} onChange={e => patchNew(key, { uom: e.target.value })} />
                              : s.status === 'match' ? <span>{s.match?.uom || '—'}</span> : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {items.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No costed material lines in the selected products.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {allIssues.length > 0 && (
              <Card>
                <CardContent className="py-3 space-y-1">
                  {allIssues.map((i, n) => (
                    <div key={n} className="flex items-start gap-2 text-xs">
                      {i.level === 'error' ? <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />}
                      <span><span className="font-medium">{i.where}:</span> {i.msg}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <Button onClick={() => setConfirmOpen(true)} disabled={sending || !sendable.length || across.some(i => i.level === 'error') || !!lookupError}>
                  {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                  Send {sendable.length} to Odoo
                </Button>
              )}
              <Button variant="outline" onClick={() => download('products')} disabled={!chosen.length}><Download className="h-4 w-4 mr-1.5" /> Products file</Button>
              <Button variant="outline" onClick={() => download('bom')} disabled={!chosen.length}><Download className="h-4 w-4 mr-1.5" /> BOM file</Button>
              <span className="text-xs text-muted-foreground">
                {chosen.length > sendable.length ? `${chosen.length - sendable.length} selected product${chosen.length - sendable.length === 1 ? '' : 's'} won't be sent until fixed. ` : ''}
                Files: import the products file first, then the BOM file.
              </span>
            </div>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Send {sendable.length} product{sendable.length === 1 ? '' : 's'} to Odoo?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-1 text-sm">
                      <div>Up to {newCount} new item{newCount === 1 ? '' : 's'} will be created, each once.</div>
                      <div>Each product gets its BOM, unless it already has one in Odoo.</div>
                      <div>Products are sent one after another; one failing doesn't stop the rest.</div>
                      <div className="text-muted-foreground pt-1">Odoo records can be archived afterwards but not undone from HQ.</div>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={sendAll}>Send to Odoo</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </AppLayout>
  );
}
