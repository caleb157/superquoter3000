import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OptionCombobox } from '@/components/odoo-export/OptionCombobox';
import { createSo, pricelistFor, soCustomers, soLines, soMeta, type OdooPricelist, type SoRowInput } from '@/lib/odoo-sale-order';

type Props = { open: boolean; onOpenChange: (o: boolean) => void; rows: SoRowInput[]; retention: number; currency: string };
const NONE = '__none';

export function CreateSoDialog({ open, onOpenChange, rows, retention, currency }: Props) {
  const [pricelists, setPricelists] = useState<OdooPricelist[]>([]);
  const [terms, setTerms] = useState<{ id: number; name: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [customer, setCustomer] = useState('');
  const [pricelist, setPricelist] = useState<string>(NONE);
  const [term, setTerm] = useState<string>(NONE);
  const [date, setDate] = useState('');
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ name: string; url: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDone(null); setLoading(true);
    Promise.all([soMeta(), soCustomers('')])
      .then(([m, c]) => {
        setPricelists(m.pricelists); setTerms(m.paymentTerms); setCustomers(c.customers);
        const pl = pricelistFor(m.pricelists, currency);
        setPricelist(pl ? String(pl) : NONE);
      })
      .catch(e => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, currency]);

  const lines = useMemo(() => soLines(rows, retention), [rows, retention]);
  const included = lines.filter(l => !skip.has(l.productId));
  const blocked = included.filter(l => !l.ready);
  const total = included.reduce((a, l) => a + l.lineTotal, 0);
  const customerId = customers.find(c => c.name === customer)?.id ?? null;
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const submit = async () => {
    if (!customerId || !included.length || blocked.length) return;
    setSaving(true);
    try {
      const r = await createSo({
        partnerId: customerId, pricelistId: pricelist === NONE ? null : Number(pricelist), paymentTermId: term === NONE ? null : Number(term),
        commitmentDate: date || null,
        lines: included.map(l => ({ productId: l.odooId as number, qty: l.qty, priceUnit: l.price as number, discount: l.discountPct })),
      });
      setDone({ name: r.name, url: r.url });
      toast.success(`Quotation ${r.name} created in Odoo`);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Create SO in Odoo (draft quotation)</DialogTitle></DialogHeader>
        {done ? (
          <div className="space-y-3 text-sm">
            <p>Quotation <b>{done.name}</b> was created as a draft. Review and confirm it in Odoo.</p>
            <Button asChild variant="outline"><a href={done.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1.5" /> Open in Odoo</a></Button>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading from Odoo…</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Customer</span>
                <OptionCombobox value={customer} options={customers.map(c => c.name)} onChange={setCustomer} placeholder="Pick an Odoo customer" />
              </label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Pricelist (inquiry currency: {currency})</span>
                <Select value={pricelist} onValueChange={setPricelist}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Customer default</SelectItem>
                    {pricelists.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.currency})</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Payment terms</span>
                <Select value={term} onValueChange={setTerm}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Blank</SelectItem>
                    {terms.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Delivery date (optional)</span>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Discount {lines[0]?.discountPct ?? 0}% = Selling entity retention % from the Projections tab. Change it there.</p>
            <div className="max-h-[320px] overflow-auto border rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted"><tr className="text-left">
                  <th className="p-1.5 w-6" /><th className="p-1.5">Product</th><th className="p-1.5">Odoo SKU</th>
                  <th className="p-1.5 text-right">Qty</th><th className="p-1.5 text-right">Price</th><th className="p-1.5 text-right">Disc.</th><th className="p-1.5 text-right">Total</th>
                </tr></thead>
                <tbody>
                  {lines.map(l => {
                    const on = !skip.has(l.productId);
                    return (
                      <tr key={l.productId} className="border-t">
                        <td className="p-1.5"><Checkbox checked={on} onCheckedChange={v => setSkip(s => { const n = new Set(s); if (v) n.delete(l.productId); else n.add(l.productId); return n; })} /></td>
                        <td className="p-1.5">{l.name}{l.problem && <div className="text-destructive">{l.problem}</div>}</td>
                        <td className="p-1.5 font-mono">{l.sku || '—'}</td>
                        <td className="p-1.5 text-right">{l.qty}</td>
                        <td className="p-1.5 text-right">{l.price == null ? '—' : fmt(l.price)}</td>
                        <td className="p-1.5 text-right">{l.discountPct}%</td>
                        <td className="p-1.5 text-right">{l.ready ? fmt(l.lineTotal) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between text-sm">
              <span>{included.length} order lines</span>
              <span className="font-semibold">Total {currency} {fmt(total)}</span>
            </div>
            {blocked.length > 0 && <p className="text-xs text-destructive">{blocked.length} selected line(s) need fixing or unticking before the SO can be created.</p>}
          </div>
        )}
        {!done && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || loading || !customerId || !included.length || blocked.length > 0}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Create quotation in Odoo
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
