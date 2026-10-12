import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Copy, Link2, Send, Trophy, Loader2, ExternalLink, Printer, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { fmt } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { statusToneClass } from '@/lib/status-tone';
import {
  addVendorToSheet, buildReplyGrid, formatDay, isOpenRfq, isOutsourcedProduct, loadSheet, markSent, pickWinner, priceTone, productSpecs,
  saveReply, whatsappMessage, type GridRow, type SheetBundle, type SheetRfq, type SheetVendor,
} from '@/lib/vendor-rfq-sheet';

const STATUS_COLORS: Record<string, string> = {
  draft: statusToneClass('idle'),
  sent: statusToneClass('progress'),
  responded: statusToneClass('complete'),
  accepted: statusToneClass('complete'),
  rejected: statusToneClass('issue'),
};
const STATUS_LABEL: Record<string, string> = { draft: 'Not sent', sent: 'Sent', responded: 'Replied', accepted: 'Accepted', rejected: 'Rejected' };

const num = (s: string): number | null => {
  const n = parseFloat(s.replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Price + lead time inputs for one vendor on one product; saves on blur. */
function ReplyCell({ rfq, row, onSaved }: { rfq: SheetRfq; row: GridRow; onSaved: () => void }) {
  const cell = row.cells[rfq.id];
  const [price, setPrice] = useState(cell?.price != null ? String(cell.price) : '');
  const [lead, setLead] = useState(cell?.lead != null ? String(cell.lead) : '');
  useEffect(() => {
    setPrice(cell?.price != null ? String(cell.price) : '');
    setLead(cell?.lead != null ? String(cell.lead) : '');
  }, [cell?.price, cell?.lead]);
  if (!cell) return <span className="text-muted-foreground/50">—</span>;

  const commit = async () => {
    const p = num(price);
    const l = num(lead);
    if (p === cell.price && (l == null ? null : Math.round(l)) === cell.lead) return;
    try {
      await saveReply(rfq.id, cell.lineId, p, l == null ? null : Math.round(l));
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the reply');
    }
  };
  const tone = priceTone(cell.price, row.target);
  const cheapest = row.cheapestRfqId === rfq.id;
  return (
    <div className={cn('rounded-md p-1 space-y-1', cheapest && 'bg-emerald-50 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:ring-emerald-800', cell.picked && 'ring-2 ring-primary')}>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground w-3">₹</span>
        <Input
          inputMode="decimal" className={cn('h-7 text-xs text-right', tone === 'good' && 'text-emerald-700 dark:text-emerald-400 font-medium', tone === 'over' && 'text-red-600 dark:text-red-400 font-medium')}
          value={price} onChange={e => setPrice(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Price" aria-label={`${rfq.vendor_name} price for ${row.name}`}
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground w-3">d</span>
        <Input
          inputMode="numeric" className="h-7 text-xs text-right" value={lead} onChange={e => setLead(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Days" aria-label={`${rfq.vendor_name} lead time for ${row.name}`}
        />
      </div>
    </div>
  );
}

const VendorRfqSheet = () => {
  const { batchId } = useParams<{ batchId: string }>();
  const { user } = useAuth();
  const [bundle, setBundle] = useState<SheetBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [entities, setEntities] = useState<any[]>([]);
  const [entityId, setEntityId] = useState<string>('');
  const [contactName, setContactName] = useState<string | null>(null);
  const [showTarget, setShowTarget] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [layout, setLayout] = useState<'cards' | 'table'>('cards');
  const [allVendors, setAllVendors] = useState<SheetVendor[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const first = bundle?.rfqs[0];
  useDocumentTitle(first ? `RFQ sheet ${first.rfq_number || ''}`.trim() : 'RFQ sheet');

  const reload = useCallback(async () => {
    if (!batchId) return;
    try {
      setBundle(await loadSheet(batchId));
    } catch (e: any) {
      toast.error(e?.message || 'Could not load the RFQ sheet');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('company_entities').select('*').order('name');
      const list = data || [];
      setEntities(list);
      // Vendors are in India, so the sheet comes from the Indian entity unless you pick another.
      const indian = list.find((e: any) => (e.country || '').toLowerCase().includes('india'));
      setEntityId((indian || list[0])?.id || '');
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('vendors').select('id, name, email, phone, address').order('name');
      setAllVendors(data || []);
    })();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await (supabase as any).from('profiles').select('display_name').eq('user_id', user.id).maybeSingle();
      setContactName(data?.display_name || null);
    })();
  }, [user?.id]);

  const entity = entities.find(e => e.id === entityId) || null;
  // The open sheet (made with no vendor picked) is for printing; replies are logged per vendor.
  const vendorRfqs = useMemo(() => (bundle?.rfqs || []).filter(r => !isOpenRfq(r)), [bundle]);
  const rows = useMemo(() => (bundle ? buildReplyGrid(vendorRfqs, bundle.lines, bundle.responses) : []), [bundle, vendorRfqs]);
  const itemCount = useMemo(() => new Set((bundle?.lines || []).map(l => l.product_id || l.item_name)).size, [bundle]);
  const productMap = useMemo(() => new Map((bundle?.products || []).map((p: any) => [p.id, p])), [bundle]);
  const inquiryLabel = bundle?.inquiry ? [bundle.inquiry.rfq_number, bundle.inquiry.title].filter(Boolean).join(' · ') : null;
  const linesFor = (rfqId: string) => (bundle?.lines || []).filter(l => l.vendor_rfq_id === rfqId);

  const downloadPdf = async (rfq: SheetRfq, mode: 'download' | 'print' = 'download') => {
    setBusy(`pdf:${rfq.id}`);
    try {
      const [{ pdf }, { default: VendorRfqPdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/vendor-rfq/VendorRfqPdfDocument'),
      ]);
      const lines = linesFor(rfq.id).map(l => {
        const p: any = l.product_id ? productMap.get(l.product_id) : null;
        const spec = p ? productSpecs(p, bundle?.cogs || []) : null;
        return {
          name: l.item_name, sku: p?.sku ?? null, photo_url: l.product_photo_url || p?.photo_url || null,
          dimensions: l.dimensions || null, finish: p ? (p.notes_finishes || p.finishing_difficulty || null) : null,
          description: p ? null : l.description || null, notes: p ? null : l.notes || null,
          quantity: Number(l.quantity) || 0, units: l.units, target_price: l.target_price,
          specs: spec ? spec.specs : [l.dimensions ? { label: 'Size', value: l.dimensions } : null, l.description ? { label: 'Details', value: l.description } : null].filter(Boolean) as { label: string; value: string }[],
          noteLines: spec ? spec.notes : (l.notes ? [l.notes] : []),
        };
      });
      const r: any = rfq;
      const blob = await pdf(
        <VendorRfqPdfDocument
          rfqNumber={rfq.rfq_number || 'RFQ'} date={(rfq.created_at || '').slice(0, 10) || null} replyBy={rfq.response_due}
          vendor={{ name: rfq.vendor_name, phone: rfq.vendor_phone, email: rfq.vendor_email, address: r.vendor_address }}
          entity={entity} contactName={contactName} inquiryLabel={bundle?.inquiry?.rfq_number || null}
          notes={r.notes || null} showTarget={showTarget} layout={layout} lines={lines}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      if (mode === 'print') {
        // Opens the PDF in a new tab, where the browser's print button prints it.
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(rfq.rfq_number || 'RFQ').replace(/[^a-z0-9-_]+/gi, '_')}${rfq.vendor_name ? `-${rfq.vendor_name.replace(/[^a-z0-9-_]+/gi, '_')}` : ''}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('RFQ PDF failed', e);
      toast.error('Could not make the PDF');
    } finally {
      setBusy(null);
    }
  };

  const downloadAll = async () => {
    for (const rfq of bundle?.rfqs || []) await downloadPdf(rfq);
  };

  const addVendor = async (v: SheetVendor) => {
    setAddOpen(false);
    if (!batchId) return;
    try {
      await addVendorToSheet(batchId, v, user?.id);
      await reload();
      toast.success(`${v.name} added; type their reply in the grid`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not add the vendor');
    }
  };

  const copyMessage = async (rfq: SheetRfq) => {
    const text = whatsappMessage({
      vendorName: rfq.vendor_name, rfqNumber: rfq.rfq_number, itemCount: linesFor(rfq.id).length,
      replyBy: rfq.response_due, senderName: contactName, companyName: entity?.name,
    });
    await navigator.clipboard.writeText(text);
    toast.success('Message copied, paste it with the PDF');
  };

  const copyLink = async (rfq: SheetRfq) => {
    if (!rfq.share_token) { toast.error('This RFQ has no share link'); return; }
    await navigator.clipboard.writeText(`${window.location.origin}/vendor-rfq/view/${rfq.share_token}`);
    toast.success('Vendor link copied');
  };

  const sendAll = async (ids: string[]) => {
    try { await markSent(ids); await reload(); toast.success('Marked as sent'); } catch (e: any) { toast.error(e?.message || 'Could not update'); }
  };

  const pick = async (row: GridRow, rfqId: string) => {
    const cell = row.cells[rfqId];
    const rfq = bundle?.rfqs.find(r => r.id === rfqId);
    if (!cell || cell.price == null || !rfq) return;
    setBusy(`pick:${row.key}`);
    try {
      await pickWinner({
        lineIdsForProduct: Object.values(row.cells).map(c => c.lineId), winnerLineId: cell.lineId, productId: row.productId,
        vendorName: rfq.vendor_name || '', price: cell.price, isOutsourced: isOutsourcedProduct(productMap.get(row.productId || '')),
      });
      await reload();
      toast.success(row.productId ? `${rfq.vendor_name} at ${fmt.inr(cell.price)} written into ${row.name}'s costing` : `${rfq.vendor_name} picked`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not pick the winner');
    } finally {
      setBusy(null);
    }
  };

  const pickAllCheapest = async () => {
    const todo = rows.filter(r => r.cheapestRfqId && r.pickedRfqId !== r.cheapestRfqId);
    for (const r of todo) await pick(r, r.cheapestRfqId!);
  };

  if (loading) return <AppLayout><div className="py-12 text-center text-muted-foreground">Loading…</div></AppLayout>;
  if (!bundle || bundle.rfqs.length === 0) return <AppLayout><div className="py-12 text-center text-muted-foreground">RFQ sheet not found.</div></AppLayout>;

  const rfqs = vendorRfqs;
  const unsent = rfqs.filter(r => r.status === 'draft').map(r => r.id);
  const replyBy = bundle.rfqs[0].response_due;
  const onSheet = new Set(rfqs.map(r => r.vendor_id).filter(Boolean));
  const addable = allVendors.filter(v => !onSheet.has(v.id));
  const vendorTotal = (rfqId: string) => rows.reduce((s, r) => s + (r.cells[rfqId]?.price || 0) * r.quantity, 0);
  const canPickCheapest = rows.some(r => r.cheapestRfqId && r.pickedRfqId !== r.cheapestRfqId);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {bundle.inquiry ? (
            <Button variant="ghost" size="sm" className="gap-1.5" asChild>
              <Link to={`/inquiry/${bundle.inquiry.id}?tab=quotes`}><ArrowLeft className="h-3.5 w-3.5" /> {inquiryLabel}</Link>
            </Button>
          ) : <span />}
          <div className="text-xs text-muted-foreground">
            {itemCount} item{itemCount === 1 ? '' : 's'} · {rfqs.length ? `${rfqs.length} vendor${rfqs.length === 1 ? '' : 's'}` : 'no vendor yet'}
            {replyBy ? ` · reply by ${formatDay(replyBy)}` : ''}
          </div>
        </div>
        <h1 className="text-lg font-semibold">Vendor RFQ sheet</h1>

        {/* Send-out */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Company" /></SelectTrigger>
                  <SelectContent>{entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">PDF layout</Label>
                <Select value={layout} onValueChange={v => setLayout(v as 'cards' | 'table')}>
                  <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cards">Large photos and specs</SelectItem>
                    <SelectItem value="table">Compact table</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs pb-1.5">
                <Switch checked={showTarget} onCheckedChange={setShowTarget} /> Show our target price on the PDF
              </label>
              <div className="flex gap-2 ml-auto">
                <Popover open={addOpen} onOpenChange={setAddOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add vendor</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Search vendors…" />
                      <CommandList>
                        <CommandEmpty>No vendors found.</CommandEmpty>
                        <CommandGroup>
                          {addable.map(v => <CommandItem key={v.id} value={v.name} onSelect={() => addVendor(v)} className="text-xs">{v.name}</CommandItem>)}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {bundle.rfqs.length > 1 && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadAll} disabled={!!busy}>
                    <Download className="h-3.5 w-3.5" /> All PDFs
                  </Button>
                )}
                {unsent.length > 0 && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => sendAll(unsent)}>
                    <Send className="h-3.5 w-3.5" /> Mark all sent
                  </Button>
                )}
              </div>
            </div>
            <div className="divide-y rounded-md border">
              {bundle.rfqs.map(r => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium min-w-[10rem]">{isOpenRfq(r) ? 'Open sheet, no vendor' : r.vendor_name || 'Vendor'}</span>
                  <span className="font-mono text-xs text-muted-foreground">{r.rfq_number}</span>
                  {!isOpenRfq(r) && <Badge variant="secondary" className={cn('text-[10px]', STATUS_COLORS[r.status || 'draft'])}>{STATUS_LABEL[r.status || 'draft'] || r.status}</Badge>}
                  <div className="ml-auto flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => downloadPdf(r, 'print')} disabled={busy === `pdf:${r.id}`}>
                      <Printer className="h-3 w-3" /> Print
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => downloadPdf(r)} disabled={busy === `pdf:${r.id}`}>
                      {busy === `pdf:${r.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} PDF
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => copyMessage(r)}>
                      <Copy className="h-3 w-3" /> Message
                    </Button>
                    {!isOpenRfq(r) && (
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => copyLink(r)}>
                        <Link2 className="h-3 w-3" /> Link
                      </Button>
                    )}
                    {r.status === 'draft' && !isOpenRfq(r) && (
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => sendAll([r.id])}>
                        <Send className="h-3 w-3" /> Sent
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Open this vendor's RFQ">
                      <Link to={`/vendor-rfq/${r.id}`}><ExternalLink className="h-3 w-3" /></Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Replies */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Replies</h2>
              <span className="text-xs text-muted-foreground">Type each vendor's price (₹ per piece) and lead time (days). The cheapest reply per item is outlined green; prices at or under target are green, over target red.</span>
              {canPickCheapest && (
                <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={pickAllCheapest} disabled={!!busy}>
                  <Trophy className="h-3.5 w-3.5" /> Pick cheapest for all
                </Button>
              )}
            </div>
            {rfqs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No vendors on this sheet yet. Print it or send it to anyone, then press <span className="font-medium">Add vendor</span> for each vendor who replies and type their prices here.</p>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="sticky left-0 z-10 bg-card text-left font-medium p-2 min-w-[14rem]">Item</th>
                    <th className="text-right font-medium p-2 w-16">Qty</th>
                    <th className="text-right font-medium p-2 w-20">Target</th>
                    {rfqs.map(r => <th key={r.id} className="text-left font-medium p-2 min-w-[8.5rem]">{r.vendor_name || 'Vendor'}</th>)}
                    <th className="text-left font-medium p-2 min-w-[9rem]">Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const winner = row.pickedRfqId ? rfqs.find(r => r.id === row.pickedRfqId) : null;
                    const winCell = row.pickedRfqId ? row.cells[row.pickedRfqId] : null;
                    return (
                      <tr key={row.key} className="align-top">
                        <td className="sticky left-0 z-10 bg-card border-t p-2">
                          <div className="flex items-center gap-2">
                            {row.photo ? <img src={row.photo} alt="" className="h-9 w-9 rounded object-cover shrink-0" /> : <div className="h-9 w-9 rounded bg-muted shrink-0" />}
                            {row.productId ? <Link to={`/product/${row.productId}`} className="font-medium hover:underline">{row.name}</Link> : <span className="font-medium">{row.name}</span>}
                          </div>
                        </td>
                        <td className="border-t p-2 text-right tabular-nums">{row.quantity.toLocaleString('en-IN')}</td>
                        <td className="border-t p-2 text-right tabular-nums">{row.target ? fmt.inr(row.target) : '—'}</td>
                        {rfqs.map(r => (
                          <td key={r.id} className="border-t p-1">
                            <ReplyCell rfq={r} row={row} onSaved={reload} />
                            {row.cells[r.id]?.price != null && row.pickedRfqId !== r.id && (
                              <Button size="sm" variant="ghost" className="h-6 w-full mt-0.5 text-[11px]" onClick={() => pick(row, r.id)} disabled={busy === `pick:${row.key}`}>
                                Pick winner
                              </Button>
                            )}
                          </td>
                        ))}
                        <td className="border-t p-2">
                          {winner && winCell ? (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1 font-medium"><Trophy className="h-3 w-3 text-amber-500" /> {winner.vendor_name}</div>
                              <div className="text-muted-foreground">{fmt.inr(winCell.price || 0)}{winCell.lead != null ? ` · ${winCell.lead} d` : ''}</div>
                              {row.productId && <div className="text-muted-foreground">In costing</div>}
                            </div>
                          ) : busy === `pick:${row.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="font-medium">
                    <td className="sticky left-0 z-10 bg-card border-t p-2">Total</td>
                    <td className="border-t" />
                    <td className="border-t p-2 text-right tabular-nums">{fmt.inr(rows.reduce((s, r) => s + (r.target || 0) * r.quantity, 0))}</td>
                    {rfqs.map(r => <td key={r.id} className="border-t p-2 tabular-nums">{vendorTotal(r.id) ? fmt.inr(vendorTotal(r.id)) : '—'}</td>)}
                    <td className="border-t" />
                  </tr>
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default VendorRfqSheet;
