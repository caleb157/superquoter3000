// Settings → Standard BOM components: Odoo items (sandpaper, local transport…) suggested as
// one-click chips at the bottom of every product's BOM lines on the Odoo tab.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OdooProductPicker } from '@/components/odoo-export/OdooProductPicker';
import { loadStandardComponents, type StandardComponent } from '@/lib/odoo-products';

const db = supabase as any;

export default function StandardBomSettings() {
  const [rows, setRows] = useState<StandardComponent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setRows(await loadStandardComponents()); } catch (e) { toast.error((e as Error).message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const add = async (p: { id: number | null; sku: string; name: string; uom: string }) => {
    if (rows.some(r => r.sku.toUpperCase() === p.sku.toUpperCase())) { toast.info(`${p.sku} is already on the list.`); return; }
    const { error } = await db.from('odoo_standard_bom_components').insert({
      odoo_product_id: p.id, sku: p.sku, name: p.name, uom: p.uom || 'Units', default_qty: 1, sort_order: rows.length,
    });
    if (error) toast.error(error.message); else load();
  };
  const setQty = async (r: StandardComponent, v: string) => {
    const q = Number(v);
    if (!(q > 0)) return;
    setRows(prev => prev.map(x => (x.id === r.id ? { ...x, default_qty: q } : x)));
    const { error } = await db.from('odoo_standard_bom_components').update({ default_qty: q }).eq('id', r.id);
    if (error) toast.error(error.message);
  };
  const remove = async (r: StandardComponent) => {
    const { error } = await db.from('odoo_standard_bom_components').delete().eq('id', r.id);
    if (error) toast.error(error.message); else setRows(prev => prev.filter(x => x.id !== r.id));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Standard BOM components</h2>
        <p className="text-sm text-muted-foreground">
          Odoo items suggested on every BOM (e.g. sandpaper, local transport). They show as chips under the BOM lines on a product's Odoo tab; click one to add it.
        </p>
      </div>
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="max-w-md">
            <span className="text-xs text-muted-foreground block mb-1">Add an Odoo product</span>
            <OdooProductPicker value={null} onPick={add} />
          </div>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No standard components yet.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {rows.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-mono text-xs w-40 truncate">{r.sku}</span>
                  <span className="flex-1 truncate">{r.name}</span>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Qty per unit
                    <Input className="h-8 w-20 text-xs" inputMode="decimal" defaultValue={r.default_qty} onBlur={e => setQty(r, e.target.value)} />
                    {r.uom}
                  </label>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(r)} aria-label={`Remove ${r.sku}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
