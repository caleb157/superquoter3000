// Inquiry → Send to Odoo, step 1: final products only. Each checked product is created in Odoo
// as a template with one variant (global "variant" attribute); materials and the BOM are done
// later, per product, on its Odoo tab. Products already created from HQ (products.odoo_product_id)
// show "In Odoo" and can't be sent again. The finished-product draft is shared with the
// product tab (same localStorage key), so nothing is typed twice. Also exports the DKT-side
// import sheet (DKT's Odoo has no API).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, Send, Wrench, XCircle } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { OptionCombobox } from '@/components/odoo-export/OptionCombobox';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { computeResults, loadBundle } from '@/lib/costing-workspace';
import { checkFinishedOnly, defaultFinished, dktProductsSheet, joinSku, pushPayload, splitSku, type FinishedDraft } from '@/lib/odoo-bom';
import { odooMeta, odooProductsBySku, odooSkuPrefixes, pushToOdoo, type OdooMeta, type SkuPrefix } from '@/lib/odoo-products';

type Row = { productId: string; finished: FinishedDraft; odooId: number | null; odooSku: string | null };
type SendState = { state: 'sending' | 'done' | 'error'; url?: string | null; error?: string; problems?: string[] };

const draftKey = (id: string) => `odoo-bom-draft:v2:${id}`;
const readDraft = (id: string): { finished?: Partial<FinishedDraft>; lines?: unknown; added?: unknown } | null => {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); } catch { return null; }
};
const writeFinished = (id: string, f: FinishedDraft) => {
  try { const d = readDraft(id) ?? { lines: {} }; localStorage.setItem(draftKey(id), JSON.stringify({ ...d, finished: f })); } catch { /* per-browser */ }
};
const num = (v: string) => (v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const upper = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

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
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<OdooMeta | null>(null);
  const [prefixList, setPrefixList] = useState<SkuPrefix[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Set<string> | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Record<string, SendState>>({});
  const ready = useRef(false);

  const checkOdoo = useCallback(async (rs: Row[]) => {
    setChecking(true);
    try {
      const found = await odooProductsBySku(rs.map(r => r.finished.sku).filter(s => /^[^-]+-[^-]+-[^-]+$/.test(s.trim())));
      setExisting(new Set(found.map(p => p.sku.trim().toUpperCase())));
      setLookupError(null);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
      setExisting(null);
    } finally { setChecking(false); }
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
      const next: Row[] = products.map(p => {
        let f = defaultFinished(p, { volumeM3: results.get(p.id)?.finalUnitCbm ?? null });
        const own = readDraft(p.id)?.finished;
        if (own) f = { ...f, ...own, variant: own.variant ?? '', customerSku: own.customerSku ?? f.customerSku };
        const link = p as { odoo_product_id?: number | null; odoo_sku?: string | null };
        return { productId: p.id, finished: f, odooId: link.odoo_product_id ?? null, odooSku: link.odoo_sku ?? null };
      });
      setRows(next);
      setPicked(new Set(next.filter(r => !r.odooId).map(r => r.productId)));
      setSent({});
      ready.current = true;
      setLoading(false);
      odooMeta().then(setMeta).catch(e => setLookupError(e instanceof Error ? e.message : String(e)));
      odooSkuPrefixes().then(setPrefixList).catch(() => { /* typing still works */ });
      checkOdoo(next);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [inquiryId, wanted, checkOdoo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (ready.current) for (const r of rows) writeFinished(r.productId, r.finished); }, [rows]);

  const patch = (id: string, p: Partial<FinishedDraft>) =>
    setRows(prev => prev.map(r => (r.productId === id ? { ...r, finished: { ...r.finished, ...p } } : r)));

  const issues = useMemo(() => new Map(rows.map(r => [r.productId, r.odooId ? [] : checkFinishedOnly(r.finished, existing)])), [rows, existing]);
  const chosen = rows.filter(r => picked.has(r.productId));
  const sendable = chosen.filter(r => !r.odooId && sent[r.productId]?.state !== 'done' && !(issues.get(r.productId) ?? []).length);

  const sendAll = async () => {
    setConfirmOpen(false);
    setSending(true);
    let ok = 0;
    for (const r of sendable) {
      setSent(prev => ({ ...prev, [r.productId]: { state: 'sending' } }));
      try {
        const res = await pushToOdoo(pushPayload(r.productId, { ...r.finished, exists: false, existing: null }, [], existing, 'product'));
        const prod = res.created.concat(res.reused).find(c => c.kind === 'product');
        setSent(prev => ({ ...prev, [r.productId]: { state: 'done', url: res.productUrl } }));
        setRows(prev => prev.map(x => (x.productId === r.productId ? { ...x, odooId: prod?.id ?? x.odooId, odooSku: r.finished.sku } : x)));
        ok += 1;
      } catch (e) {
        const err = e as Error & { details?: { problems?: string[] } | null };
        setSent(prev => ({ ...prev, [r.productId]: { state: 'error', error: err?.message || String(e), problems: err?.details?.problems } }));
      }
    }
    setSending(false);
    if (ok) toast.success(`${ok} product${ok === 1 ? '' : 's'} created in Odoo.`);
  };

  const downloadDkt = () => {
    if (!chosen.length) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dktProductsSheet(chosen.map(r => ({ name: r.finished.name, customerSku: r.finished.customerSku })))), 'Sheet1');
    XLSX.writeFile(wb, `${String(title).replace(/[^A-Za-z0-9._-]+/g, '-')}_DKT_products.xlsx`);
  };

  const catList = meta?.categories ?? [];
  const prefixOpts = prefixList.filter(p => p.saleable > 0).map(p => ({ value: p.prefix, hint: `${p.saleable} products · e.g. ${p.sample}` }));

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
            <h1 className="page-title">Send to Odoo · final products</h1>
            <p className="text-xs text-muted-foreground">Step 1: create the final products. Step 2, any time later: open each product's BOM to create its materials and the BOM.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => checkOdoo(rows)} disabled={checking || loading}>
            {checking ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />} Check Odoo
          </Button>
          <Button variant="outline" size="sm" onClick={downloadDkt} disabled={!chosen.length}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> DKT products file
          </Button>
        </div>

        {loading && <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {!loading && loadError && <div className="p-6 text-sm text-destructive">{loadError}</div>}
        {!loading && !loadError && (
          <>
            {lookupError && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                Odoo can't be read right now ({lookupError}). SKUs aren't checked and nothing can be sent.
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={rows.length > 0 && picked.size === rows.length}
                onCheckedChange={v => setPicked(v === true ? new Set(rows.map(r => r.productId)) : new Set())} />
              {chosen.length} of {rows.length} selected
            </label>

            {rows.map(r => {
              const f = r.finished;
              const parts = splitSku(f.sku);
              const setPart = (k: 'prefix' | 'base' | 'suffix', v: string) =>
                patch(r.productId, { sku: joinSku({ ...parts, [k]: k === 'suffix' ? v.toUpperCase().replace(/[^A-Z0-9_]/g, '') : upper(v) }) });
              const s = sent[r.productId];
              const errs = issues.get(r.productId) ?? [];
              const inOdoo = !!r.odooId;
              return (
                <Card key={r.productId} className={picked.has(r.productId) ? '' : 'opacity-60'}>
                  <CardContent className="p-3 flex gap-3">
                    <Checkbox className="mt-1" checked={picked.has(r.productId)}
                      onCheckedChange={v => setPicked(prev => { const n = new Set(prev); if (v === true) n.add(r.productId); else n.delete(r.productId); return n; })} />
                    {f.imageUrl
                      ? <img src={f.imageUrl} alt={f.name} className="h-20 w-20 rounded object-cover border shrink-0" />
                      : <div className="h-20 w-20 rounded border bg-muted shrink-0 flex items-center justify-center text-[10px] text-muted-foreground">No photo</div>}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {inOdoo
                          ? <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> In Odoo · {r.odooSku || f.sku}</Badge>
                          : errs.length ? <Badge variant="destructive">{errs.length} to fix</Badge> : <Badge variant="outline">Ready</Badge>}
                        {s?.state === 'sending' && <span className="inline-flex items-center gap-1 text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Creating…</span>}
                        {s?.state === 'done' && s.url && <a className="inline-flex items-center gap-0.5 text-xs underline" href={s.url} target="_blank" rel="noopener noreferrer">Open in Odoo <ExternalLink className="h-3 w-3" /></a>}
                        <Button variant="ghost" size="sm" className="h-7 ml-auto" onClick={() => navigate(`/product/${r.productId}?tab=odoo`)}>
                          <Wrench className="h-3.5 w-3.5 mr-1.5" /> Materials &amp; BOM
                        </Button>
                      </div>
                      <fieldset disabled={inOdoo} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 text-xs">
                        <F label="Product name (template)" span={3}><Input className="h-8 text-xs" value={f.name} onChange={e => patch(r.productId, { name: e.target.value })} /></F>
                        <F label="Category" span={2}><OptionCombobox value={f.category} options={catList} loading={!meta} className="h-8 text-xs" onChange={v => patch(r.productId, { category: v })} /></F>
                        <F label="HSN"><Input className="h-8 text-xs" value={f.hsn} onChange={e => patch(r.productId, { hsn: e.target.value })} /></F>
                        <F label="SKU (prefix - base - suffix)" span={3}>
                          <div className="flex items-center gap-1">
                            <div className="w-24"><OptionCombobox value={parts.prefix} options={prefixOpts} allowCustom placeholder="Prefix" className="h-8 text-xs font-mono" onChange={v => setPart('prefix', v)} /></div>
                            <span>-</span><Input className="h-8 text-xs font-mono" placeholder="Base" value={parts.base} onChange={e => setPart('base', e.target.value)} />
                            <span>-</span><Input className="h-8 text-xs font-mono" placeholder="Suffix" value={parts.suffix} onChange={e => setPart('suffix', e.target.value)} />
                          </div>
                        </F>
                        <F label="Variant"><Input className="h-8 text-xs" placeholder="Standard" value={f.variant} onChange={e => patch(r.productId, { variant: e.target.value })} /></F>
                        <F label="Customer SKU (tag)"><Input className="h-8 text-xs" value={f.customerSku} onChange={e => patch(r.productId, { customerSku: e.target.value })} /></F>
                        <F label="Tracked"><div className="h-8 flex items-center"><Checkbox checked={f.tracked} onCheckedChange={v => patch(r.productId, { tracked: v === true })} /></div></F>
                        <F label="Volume (m³)"><Input className="h-8 text-xs" inputMode="decimal" value={f.volumeM3 ?? ''} onChange={e => patch(r.productId, { volumeM3: num(e.target.value) })} /></F>
                        <F label="Weight (kg)"><Input className="h-8 text-xs" inputMode="decimal" value={f.weightKg ?? ''} onChange={e => patch(r.productId, { weightKg: num(e.target.value) })} /></F>
                      </fieldset>
                      {!inOdoo && errs.map((i, n) => <div key={n} className="flex items-center gap-1.5 text-xs text-destructive"><XCircle className="h-3 w-3" /> {i.msg}</div>)}
                      {s?.state === 'error' && <div className="text-xs text-destructive">{s.error}{s.problems?.map(p => <div key={p}>{p}</div>)}</div>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {rows.length === 0 && <div className="p-6 text-sm text-muted-foreground">No products in this inquiry.</div>}

            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <Button onClick={() => setConfirmOpen(true)} disabled={sending || !sendable.length || !!lookupError}>
                  {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                  Create {sendable.length} product{sendable.length === 1 ? '' : 's'} in Odoo
                </Button>
              )}
              <Button variant="outline" onClick={downloadDkt} disabled={!chosen.length}><Download className="h-4 w-4 mr-1.5" /> DKT products file</Button>
              <span className="text-xs text-muted-foreground">Products already in Odoo are skipped, so nothing is created twice.</span>
            </div>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Create {sendable.length} product{sendable.length === 1 ? '' : 's'} in Odoo?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-1 text-sm">
                      <div>Each becomes a product with one variant (on the "variant" attribute), its SKU, photo, volume, weight and customer-SKU tag.</div>
                      <div>No materials or BOMs are created now.</div>
                      <div className="text-muted-foreground pt-1">Odoo records can be archived afterwards but not undone from HQ.</div>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={sendAll}>Create in Odoo</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function F({ label, span = 1, children }: { label: string; span?: number; children: React.ReactNode }) {
  const cls = span === 3 ? 'lg:col-span-3 sm:col-span-2' : span === 2 ? 'lg:col-span-2' : '';
  return <div className={`space-y-0.5 ${cls}`}><span className="text-[11px] text-muted-foreground block">{label}</span>{children}</div>;
}
