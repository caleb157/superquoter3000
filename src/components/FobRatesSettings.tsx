import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { DEFAULT_FOB_RATES, type FclRates, type LclRates } from '@/lib/fob';
import { loadFobRates } from '@/lib/fob-rates';
import { invalidateShipmentPool } from '@/lib/shipment-pool';

const LCL_FIELDS: [keyof LclRates, string][] = [
  ['thc_per_cbm', 'THC ₹/CBM'], ['acd_usd', 'ACD (USD)'], ['seal_usd', 'Seal (USD)'], ['vgm_usd', 'VGM (USD)'],
  ['bl_fee', 'BL fee ₹'], ['customs_clearance', 'Customs clearance ₹'], ['passing_releasing', 'Passing & releasing ₹'],
  ['open_repacking', 'Open & repacking ₹'], ['measurement_per_carton', 'Measurement ₹/carton'], ['measurement_min', 'Measurement min ₹'],
  ['sorting_per_carton', 'Sorting ₹/carton'], ['sorting_min', 'Sorting min ₹'], ['trucking_per_cbm', 'Trucking ₹/CBM'],
];

const num = (v: string) => (v === '' ? 0 : Number(v));

export function FobRatesSettings() {
  const [lcl, setLcl] = useState<{ vendor: string; rates: LclRates }>({ vendor: '', rates: DEFAULT_FOB_RATES.lcl });
  const [fcl, setFcl] = useState<{ vendor: string; rates: FclRates }>({ vendor: '', rates: DEFAULT_FOB_RATES.fcl });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (supabase as any).from('fob_rates').select('mode, vendor, rates').then(({ data }: any) => {
      for (const r of data || []) {
        if (r.mode === 'LCL') setLcl({ vendor: r.vendor || '', rates: { ...DEFAULT_FOB_RATES.lcl, ...r.rates } });
        if (r.mode === 'FCL') setFcl({ vendor: r.vendor || '', rates: { ...DEFAULT_FOB_RATES.fcl, ...r.rates } });
      }
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase as any).from('fob_rates').upsert([
      { mode: 'LCL', vendor: lcl.vendor, rates: lcl.rates },
      { mode: 'FCL', vendor: fcl.vendor, rates: fcl.rates },
    ], { onConflict: 'mode' });
    setSaving(false);
    if (error) return toast.error(error.message);
    await loadFobRates(true);
    invalidateShipmentPool();
    toast.success('FOB rates saved');
  };

  const f = fcl.rates;
  const setF = (patch: Partial<FclRates>) => setFcl({ ...fcl, rates: { ...f, ...patch } });
  const cell = 'h-8 text-right font-mono';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">LCL rate card</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label className="text-xs">Vendor</Label><Input className="h-8 mt-1" value={lcl.vendor} onChange={e => setLcl({ ...lcl, vendor: e.target.value })} /></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {LCL_FIELDS.map(([k, label]) => (
              <div key={k}><Label className="text-xs">{label}</Label>
                <Input type="number" className={cell + ' mt-1'} value={lcl.rates[k]} onChange={e => setLcl({ ...lcl, rates: { ...lcl.rates, [k]: num(e.target.value) } })} /></div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">FCL rate card (per container, incl. factory → ICD transport)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label className="text-xs">Vendor</Label><Input className="h-8 mt-1" value={fcl.vendor} onChange={e => setFcl({ ...fcl, vendor: e.target.value })} /></div>
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Line item</th><th className="w-32 font-normal">20ft ₹</th><th className="w-32 font-normal">40ft ₹</th><th className="w-10" /></tr></thead>
            <tbody>
              {f.lines.map((l, i) => (
                <tr key={i}>
                  <td><Input className="h-8" value={l.label} onChange={e => setF({ lines: f.lines.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} /></td>
                  <td><Input type="number" className={cell} value={l.c20} onChange={e => setF({ lines: f.lines.map((x, j) => j === i ? { ...x, c20: num(e.target.value) } : x) })} /></td>
                  <td><Input type="number" className={cell} value={l.c40} onChange={e => setF({ lines: f.lines.map((x, j) => j === i ? { ...x, c40: num(e.target.value) } : x) })} /></td>
                  <td><Button variant="ghost" size="sm" onClick={() => setF({ lines: f.lines.filter((_, j) => j !== i) })}>×</Button></td>
                </tr>
              ))}
              <tr><td className="pt-1"><Button variant="outline" size="sm" onClick={() => setF({ lines: [...f.lines, { label: 'New line', c20: 0, c40: 0 }] })}>Add line</Button></td></tr>
              <tr><td className="pt-3">Fumigation (normal)</td>
                <td><Input type="number" className={cell} value={f.fumigation_normal.c20} onChange={e => setF({ fumigation_normal: { ...f.fumigation_normal, c20: num(e.target.value) } })} /></td>
                <td><Input type="number" className={cell} value={f.fumigation_normal.c40} onChange={e => setF({ fumigation_normal: { ...f.fumigation_normal, c40: num(e.target.value) } })} /></td></tr>
              <tr><td>Fumigation (ISPM)</td>
                <td><Input type="number" className={cell} value={f.fumigation_ispm.c20} onChange={e => setF({ fumigation_ispm: { ...f.fumigation_ispm, c20: num(e.target.value) } })} /></td>
                <td><Input type="number" className={cell} value={f.fumigation_ispm.c40} onChange={e => setF({ fumigation_ispm: { ...f.fumigation_ispm, c40: num(e.target.value) } })} /></td></tr>
              <tr><td>Capacity (CBM)</td>
                <td><Input type="number" className={cell} value={f.capacity_20} onChange={e => setF({ capacity_20: num(e.target.value) })} /></td>
                <td><Input type="number" className={cell} value={f.capacity_40} onChange={e => setF({ capacity_40: num(e.target.value) })} /></td></tr>
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs">USD items per container</Label><Input type="number" step="0.01" className={cell + ' mt-1'} value={f.usd_per_container} onChange={e => setF({ usd_per_container: num(e.target.value) })} /></div>
            <div><Label className="text-xs">Wildlife cert. leather ₹</Label><Input type="number" className={cell + ' mt-1'} value={f.wlc_leather} onChange={e => setF({ wlc_leather: num(e.target.value) })} /></div>
            <div><Label className="text-xs">Wildlife cert. bone / MOP ₹</Label><Input type="number" className={cell + ' mt-1'} value={f.wlc_bone_mop} onChange={e => setF({ wlc_bone_mop: num(e.target.value) })} /></div>
          </div>
        </CardContent>
      </Card>
      <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save FOB rates'}</Button>
    </div>
  );
}
