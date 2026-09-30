import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { FqHeader } from '@/components/freight-quotes/FqHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BUCKETS, BUCKET_LABEL } from '@/lib/freight-quotes/calculations';
import { loadRefs } from '@/lib/freight-quotes/data';
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;
type Refs = Awaited<ReturnType<typeof loadRefs>>;

export default function FreightQuoteSettings() {
  const [refs, setRefs] = useState<Refs | null>(null);
  const [fx, setFx] = useState({ currency: '', rate_to_usd: '', effective_date: new Date().toISOString().slice(0, 10) });
  const [wm, setWm] = useState('1000');
  const [kw, setKw] = useState<{ keyword: string; origin: string; destination: string }[]>([]);
  const reload = () => loadRefs().then(r => { setRefs(r); setWm(String(r.settings?.default_wm_kg_per_cbm ?? 1000)); setKw(r.settings?.keyword_map || []); });
  useEffect(() => { reload(); }, []);

  const addFx = async () => {
    if (!fx.currency || !fx.rate_to_usd) return;
    const { error } = await db.from('fq_fx_rates').insert({ currency: fx.currency.toUpperCase(), rate_to_usd: Number(fx.rate_to_usd), effective_date: fx.effective_date });
    if (error) return toast.error(error.message);
    setFx({ ...fx, currency: '', rate_to_usd: '' }); reload();
  };
  const saveSettings = async () => {
    const row = { default_wm_kg_per_cbm: Number(wm) || 1000, keyword_map: kw.filter(k => k.keyword.trim()) };
    const { error } = refs?.settings ? await db.from('fq_settings').update(row).eq('id', refs.settings.id) : await db.from('fq_settings').insert(row);
    if (error) return toast.error(error.message);
    toast.success('Settings saved'); reload();
  };
  const del = async (table: string, id: string) => { const { error } = await db.from(table).delete().eq('id', id); if (error) toast.error(error.message); reload(); };

  const RefList = ({ title, table, list }: { title: string; table: string; list: any[] }) => {
    const [n, setN] = useState('');
    return (
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {list.map(x => (
            <div key={x.id} className="flex items-center gap-2 text-xs">
              <Input className="h-7 text-xs" defaultValue={x.name} onBlur={e => e.target.value !== x.name && db.from(table).update({ name: e.target.value }).eq('id', x.id).then(reload)} />
              {table === 'fq_vendors' && (
                <Select value={x.type} onValueChange={v => db.from(table).update({ type: v }).eq('id', x.id).then(reload)}>
                  <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{['forwarder', 'carrier', 'trucker', 'other'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {table === 'fq_products' && <Input className="h-7 w-28 text-xs" placeholder="category" defaultValue={x.category || ''} onBlur={e => db.from(table).update({ category: e.target.value || null }).eq('id', x.id)} />}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => del(table, x.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
          <div className="flex gap-2 pt-1"><Input className="h-7 text-xs" placeholder="Add…" value={n} onChange={e => setN(e.target.value)} />
            <Button size="sm" className="h-7" onClick={async () => { if (!n.trim()) return; await db.from(table).insert({ name: n.trim() }); setN(''); reload(); }}>Add</Button></div>
        </CardContent></Card>
    );
  };

  return (
    <AppLayout>
      <div className="p-3 md:p-4 max-w-[1400px] mx-auto">
        <FqHeader title="Freight quote settings" />
        {refs && (
          <div className="grid lg:grid-cols-2 gap-3">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">FX rates (USD per 1 unit)</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <table className="w-full text-xs"><thead className="text-[10px] uppercase text-muted-foreground"><tr><th className="text-left">Currency</th><th className="text-right">USD per unit</th><th className="text-right">Units per USD</th><th className="text-right">Effective</th><th /></tr></thead>
                  <tbody>{refs.fx.map(r => (
                    <tr key={r.id} className="border-t"><td className="py-1">{r.currency}</td><td className="text-right font-mono">{Number(r.rate_to_usd).toPrecision(6)}</td>
                      <td className="text-right font-mono">{(1 / Number(r.rate_to_usd)).toFixed(3)}</td><td className="text-right">{r.effective_date}</td>
                      <td className="text-right"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => del('fq_fx_rates', r.id)}><Trash2 className="h-3 w-3" /></Button></td></tr>
                  ))}</tbody></table>
                <div className="flex gap-2 items-end">
                  <div><Label className="text-[10px]">Currency</Label><Input className="h-7 w-20 text-xs uppercase" value={fx.currency} onChange={e => setFx({ ...fx, currency: e.target.value })} /></div>
                  <div><Label className="text-[10px]">USD per unit</Label><Input type="number" step="any" className="h-7 w-28 text-xs" value={fx.rate_to_usd} onChange={e => setFx({ ...fx, rate_to_usd: e.target.value })} /></div>
                  <div><Label className="text-[10px]">Effective</Label><Input type="date" className="h-7 text-xs" value={fx.effective_date} onChange={e => setFx({ ...fx, effective_date: e.target.value })} /></div>
                  <Button size="sm" className="h-7" onClick={addFx}>Add rate</Button>
                </div>
                <p className="text-[10px] text-muted-foreground">New quotes snapshot the latest rate on or before their quote date. Tip: INR at 95/USD = 0.0105263.</p>
              </CardContent></Card>

            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Defaults & bucket keywords</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2"><Label className="text-xs">Default W/M kg per CBM</Label><Input type="number" className="h-7 w-24 text-xs" value={wm} onChange={e => setWm(e.target.value)} /></div>
                <table className="w-full text-xs"><thead className="text-[10px] uppercase text-muted-foreground"><tr><th className="text-left">Keyword</th><th className="text-left">Origin-side</th><th className="text-left">Destination-side</th><th /></tr></thead>
                  <tbody>{kw.map((k, i) => (
                    <tr key={i}>
                      <td><Input className="h-7 text-xs" value={k.keyword} onChange={e => setKw(kw.map((x, j) => j === i ? { ...x, keyword: e.target.value } : x))} /></td>
                      {(['origin', 'destination'] as const).map(side => (
                        <td key={side}><Select value={k[side]} onValueChange={v => setKw(kw.map((x, j) => j === i ? { ...x, [side]: v } : x))}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{BUCKETS.map(b => <SelectItem key={b} value={b}>{BUCKET_LABEL[b]}</SelectItem>)}</SelectContent>
                        </Select></td>
                      ))}
                      <td><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setKw(kw.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button></td>
                    </tr>
                  ))}</tbody></table>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setKw([...kw, { keyword: '', origin: 'FOB_ORIGIN', destination: 'DEST_PORT' }])}>Add keyword</Button>
                  <Button size="sm" onClick={saveSettings}>Save</Button>
                </div>
                <p className="text-[10px] text-muted-foreground">Keywords are passed to the AI as hints when it assigns buckets.</p>
              </CardContent></Card>

            <RefList title="Vendors" table="fq_vendors" list={refs.vendors} />
            <RefList title="Customers" table="fq_customers" list={refs.customers} />
            <RefList title="Products" table="fq_products" list={refs.products} />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
