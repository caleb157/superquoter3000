import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { FqHeader } from '@/components/freight-quotes/FqHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Plus } from 'lucide-react';
import { BUCKETS, BUCKET_LABEL, computeQuote } from '@/lib/freight-quotes/calculations';
import { laneOf, loadQuotes, loadRefs, usd, type FqQuote } from '@/lib/freight-quotes/data';
import { buildCsv, downloadCsv } from '@/lib/csv-export';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { supabase } from '@/integrations/supabase/client';

type Row = FqQuote & { id: string };
const ALL = '__all';

export default function FreightQuotes() {
  const nav = useNavigate();
  const [quotes, setQuotes] = useState<Row[]>([]);
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof loadRefs>> | null>(null);
  const [f, setF] = useState({ search: '', vendor: ALL, customer: ALL, product: ALL, mode: ALL, status: ALL, lane: ALL, from: '', to: '' });
  const [sel, setSel] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);

  useEffect(() => { Promise.all([loadQuotes(), loadRefs()]).then(([q, r]) => { setQuotes(q); setRefs(r); }); }, []);
  const name = (list: { id: string; name: string }[] = [], id: string | null) => list.find(x => x.id === id)?.name || '';

  const rows = useMemo(() => quotes.map(q => ({
    q, t: computeQuote(q, q.lines), lane: laneOf(q),
    vendor: name(refs?.vendors, q.vendor_id), customer: name(refs?.customers, q.customer_id), product: name(refs?.products, q.product_id),
  })), [quotes, refs]);
  const lanes = [...new Set(rows.map(r => r.lane))].sort();

  const filtered = rows.filter(r => {
    const s = f.search.toLowerCase();
    if (s && ![r.vendor, r.customer, r.product, r.lane, r.q.reference_no || '', r.q.notes || ''].join(' ').toLowerCase().includes(s)) return false;
    if (f.vendor !== ALL && r.q.vendor_id !== f.vendor) return false;
    if (f.customer !== ALL && r.q.customer_id !== f.customer) return false;
    if (f.product !== ALL && r.q.product_id !== f.product) return false;
    if (f.mode !== ALL && r.q.mode !== f.mode) return false;
    if (f.status !== ALL && r.q.status !== f.status) return false;
    if (f.lane !== ALL && r.lane !== f.lane) return false;
    if (f.from && (r.q.quote_date || '') < f.from) return false;
    if (f.to && (r.q.quote_date || '') > f.to) return false;
    return true;
  });

  const exportList = () => downloadCsv('freight-quotes.csv', buildCsv([{
    title: 'Freight quotes', headers: ['Date', 'Vendor', 'Customer', 'Product', 'Lane', 'Mode', 'Status', 'CBM', 'Chargeable W/M', 'FOB USD', 'CIF USD', 'DDP USD', 'DDP $/CBM', 'Reference'],
    rows: filtered.map(r => [r.q.quote_date, r.vendor, r.customer, r.product, r.lane, r.q.mode, r.q.status, r.q.cbm, r.t.chargeable_wm.toFixed(3), r.t.fob_usd.toFixed(2), r.t.cif_usd.toFixed(2), r.t.ddp_usd.toFixed(2), r.t.per_cbm.ddp?.toFixed(2), r.q.reference_no]),
  }]));
  const exportLines = () => downloadCsv('freight-quote-lines.csv', buildCsv([{
    title: 'Freight quote line items', headers: ['Quote date', 'Vendor', 'Lane', 'Reference', 'Charge', 'Normalized', 'Bucket', 'Basis', 'Rate', 'Currency', 'Minimum', 'Qty', 'User estimate', 'Applicable', 'Reason', 'Optional', 'Status', 'Amount', 'Amount USD'],
    rows: filtered.flatMap(r => r.q.lines.map((l, i) => {
      const lr = r.t.lines[i];
      return [r.q.quote_date, r.vendor, r.lane, r.q.reference_no, l.raw_label, l.normalized_name, l.bucket, l.charge_basis, l.rate, l.currency, l.minimum_amount, lr.quantity.toFixed(3), l.user_estimate, l.applicable ? 'yes' : 'no', l.applicable_reason, l.is_optional ? 'yes' : 'no', lr.status, lr.amount_original?.toFixed(2), lr.amount_usd?.toFixed(2)];
    })),
  }]));

  const removeQuotes = async (ids: string[]) => {
    const { error } = await (supabase as any).from('fq_quotes').delete().in('id', ids);
    if (error) throw error;
    setQuotes(qs => qs.filter(q => !ids.includes(q.id)));
    setSel(s => s.filter(x => !ids.includes(x)));
  };
  const sel4 = rows.filter(r => sel.includes(r.q.id));
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const F = (k: keyof typeof f, placeholder: string, opts: { v: string; l: string }[]) => (
    <Select value={f[k]} onValueChange={v => setF({ ...f, [k]: v })}>
      <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent><SelectItem value={ALL}>All {placeholder}</SelectItem>{opts.map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
    </Select>
  );

  return (
    <AppLayout>
      <div className="p-3 md:p-4 max-w-[1600px] mx-auto">
        <FqHeader title="Freight Quote Tracker" actions={<>
          {sel.length > 0 && <ConfirmDeleteButton buttonVariant="outline" className="h-8 px-2 text-xs gap-1 text-destructive" itemLabel={`${sel.length} selected quote${sel.length > 1 ? 's' : ''}`} onConfirm={() => removeQuotes(sel)} />}
          <Button variant="outline" size="sm" disabled={sel.length < 2 || sel.length > 4} onClick={() => setCompare(true)}>Compare ({sel.length})</Button>
          <Button variant="outline" size="sm" onClick={exportList}><Download className="h-3.5 w-3.5 mr-1" />Quotes CSV</Button>
          <Button variant="outline" size="sm" onClick={exportLines}><Download className="h-3.5 w-3.5 mr-1" />Line items CSV</Button>
          <Button size="sm" onClick={() => nav('/freight-quotes/new')}><Plus className="h-3.5 w-3.5 mr-1" />New quote</Button>
        </>} />

        <div className="flex flex-wrap gap-2 mb-2">
          <Input className="h-8 text-xs w-48" placeholder="Search…" value={f.search} onChange={e => setF({ ...f, search: e.target.value })} />
          {F('vendor', 'vendors', (refs?.vendors || []).map(v => ({ v: v.id, l: v.name })))}
          {F('customer', 'customers', (refs?.customers || []).map(v => ({ v: v.id, l: v.name })))}
          {F('product', 'products', (refs?.products || []).map(v => ({ v: v.id, l: v.name })))}
          {F('lane', 'lanes', lanes.map(l => ({ v: l, l })))}
          {F('mode', 'modes', ['LCL', 'FCL', 'air'].map(v => ({ v, l: v })))}
          {F('status', 'statuses', ['received', 'accepted', 'rejected', 'expired'].map(v => ({ v, l: v })))}
          <Input type="date" className="h-8 text-xs w-36" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} />
          <Input type="date" className="h-8 text-xs w-36" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} />
        </div>

        <div className="border rounded overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <tr><th className="w-8" /><th className="text-left px-2 py-1.5">Date</th><th className="text-left px-2">Vendor</th><th className="text-left px-2">Customer</th><th className="text-left px-2">Product</th><th className="text-left px-2">Lane</th><th className="px-2">Mode</th><th className="px-2">Status</th><th className="text-right px-2">CBM</th><th className="text-right px-2">FOB</th><th className="text-right px-2">CIF</th><th className="text-right px-2">DDP</th><th className="text-right px-2">$/CBM</th><th className="w-8" /></tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.q.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => nav(`/freight-quotes/${r.q.id}`)}>
                  <td className="px-2" onClick={e => e.stopPropagation()}><Checkbox checked={sel.includes(r.q.id)} onCheckedChange={() => toggle(r.q.id)} /></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.q.quote_date}</td>
                  <td className="px-2"><Link to={`/freight-quotes/${r.q.id}`} className="hover:underline" onClick={e => e.stopPropagation()}>{r.vendor || '—'}</Link></td>
                  <td className="px-2">{r.customer || '—'}</td><td className="px-2">{r.product || '—'}</td>
                  <td className="px-2 whitespace-nowrap">{r.lane}</td><td className="px-2 text-center">{r.q.mode}</td>
                  <td className="px-2 text-center"><Badge variant={r.q.status === 'accepted' ? 'default' : 'outline'} className="text-[10px]">{r.q.status}</Badge></td>
                  <td className="px-2 text-right font-mono">{r.q.cbm ?? '—'}</td>
                  <td className="px-2 text-right font-mono">{usd(r.t.fob_usd)}</td><td className="px-2 text-right font-mono">{usd(r.t.cif_usd)}</td>
                  <td className="px-2 text-right font-mono">{usd(r.t.ddp_usd)}{r.t.unpriced_count > 0 && <span className="text-warning" title="Has unpriced at-actuals lines">*</span>}</td>
                  <td className="px-2 text-right font-mono">{usd(r.t.per_cbm.ddp, 2)}</td>
                  <td className="px-1" onClick={e => e.stopPropagation()}><ConfirmDeleteButton iconOnly itemLabel="freight quote" onConfirm={() => removeQuotes([r.q.id])} /></td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={14} className="text-center py-6 text-muted-foreground">No quotes yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">* has unpriced "at actuals" charges. Select 2–4 quotes to compare, or select any to delete.</p>

        <Dialog open={compare} onOpenChange={setCompare}>
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-auto">
            <DialogHeader><DialogTitle>Compare quotes</DialogTitle></DialogHeader>
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase text-muted-foreground"><th className="text-left px-2" />{sel4.map(r => <th key={r.q.id} className="text-right px-2">{r.vendor}<div className="font-normal normal-case">{r.q.quote_date} · {r.q.mode}</div></th>)}</tr></thead>
              <tbody>
                {[['Lane', (r: any) => r.lane], ['CBM', (r: any) => r.q.cbm ?? '—'], ['Chargeable W/M', (r: any) => r.t.chargeable_wm.toFixed(2)]].map(([l, fn]: any) => (
                  <tr key={l} className="border-t"><td className="px-2 py-1">{l}</td>{sel4.map(r => <td key={r.q.id} className="px-2 text-right">{fn(r)}</td>)}</tr>
                ))}
                {BUCKETS.map(b => (
                  <tr key={b} className="border-t"><td className="px-2 py-1">{BUCKET_LABEL[b]}</td>{sel4.map(r => <td key={r.q.id} className="px-2 text-right font-mono">{usd(r.t.buckets[b])}</td>)}</tr>
                ))}
                {(['fob', 'cif', 'ddp'] as const).map(k => (
                  <tr key={k} className="border-t font-semibold"><td className="px-2 py-1 uppercase">{k} total · $/CBM</td>
                    {sel4.map(r => <td key={r.q.id} className="px-2 text-right font-mono">{usd(k === 'fob' ? r.t.fob_usd : k === 'cif' ? r.t.cif_usd : r.t.ddp_usd)} · {usd(r.t.per_cbm[k], 2)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
