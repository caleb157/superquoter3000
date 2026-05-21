import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

type Chemical = { id: string; name: string; category: string; unit_type: string | null };
type ProductType = { id: string; name: string };

export function ProductTypeDefaultChemicalsEditor({ productTypes }: { productTypes: ProductType[] }) {
  const [chemicals, setChemicals] = useState<Chemical[]>([]);
  const [links, setLinks] = useState<{ product_type_id: string; chemical_price_id: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [chemRes, linkRes] = await Promise.all([
      supabase.from('chemical_prices').select('id, name, category, unit_type').order('category').order('name'),
      (supabase as any).from('product_type_default_chemicals').select('product_type_id, chemical_price_id'),
    ]);
    setChemicals((chemRes.data as any) || []);
    setLinks((linkRes.data as any) || []);
  };

  useEffect(() => { refresh(); }, []);

  const linkSet = useMemo(() => new Set(links.map(l => `${l.product_type_id}:${l.chemical_price_id}`)), [links]);

  const toggle = async (productTypeId: string, chemicalId: string, checked: boolean) => {
    setBusy(true);
    try {
      if (checked) {
        const { error } = await (supabase as any)
          .from('product_type_default_chemicals')
          .insert({ product_type_id: productTypeId, chemical_price_id: chemicalId });
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from('product_type_default_chemicals')
          .delete()
          .eq('product_type_id', productTypeId)
          .eq('chemical_price_id', chemicalId);
        if (error) throw error;
      }
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update');
    } finally { setBusy(false); }
  };

  if (productTypes.length === 0 || chemicals.length === 0) {
    return <p className="text-[11px] text-muted-foreground">Add product types and chemicals first to wire defaults.</p>;
  }

  return (
    <div className="overflow-auto border rounded">
      <table className="text-xs w-full">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-2 sticky left-0 bg-muted/50 z-10">Product Type</th>
            {chemicals.map(c => (
              <th key={c.id} className="p-2 text-center whitespace-nowrap" title={c.category}>
                <div className="font-medium">{c.name}</div>
                <div className="text-[10px] text-muted-foreground">{c.category}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {productTypes.map(pt => (
            <tr key={pt.id} className="border-t">
              <td className="p-2 sticky left-0 bg-background font-medium">{pt.name}</td>
              {chemicals.map(c => {
                const checked = linkSet.has(`${pt.id}:${c.id}`);
                return (
                  <td key={c.id} className="p-2 text-center">
                    <Checkbox
                      checked={checked}
                      disabled={busy}
                      onCheckedChange={(v) => toggle(pt.id, c.id, !!v)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
