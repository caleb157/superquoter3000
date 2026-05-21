import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FlaskConical } from 'lucide-react';
import { toast } from 'sonner';

type Chemical = {
  id: string;
  name: string;
  category: string;
  unit_type: string | null;
  price_per_unit_inr: number | null;
  price_per_litre_inr?: number | null;
};

type CogsItem = {
  id: string;
  cogs_type: string;
  component_name: string | null;
  chemical_price_id?: string | null;
  include?: string | null;
  sort_order?: number | null;
};

type Props = {
  productId: string;
  chemicals: Chemical[];
  cogsItems: CogsItem[];
  onChanged: () => void; // refetch cogs after change
};

export function ProductChemicalsPicker({ productId, chemicals, cogsItems, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Build a map of chemical_price_id -> existing finishing-materials row (active include)
  const activeByChemId = useMemo(() => {
    const m = new Map<string, CogsItem>();
    cogsItems.forEach(i => {
      if (i.cogs_type !== 'Finishing Materials') return;
      const cid = i.chemical_price_id || null;
      if (!cid) return;
      if ((i.include ?? 'Yes') !== 'No') m.set(cid, i);
    });
    return m;
  }, [cogsItems]);

  const inactiveByChemId = useMemo(() => {
    const m = new Map<string, CogsItem>();
    cogsItems.forEach(i => {
      if (i.cogs_type !== 'Finishing Materials') return;
      const cid = i.chemical_price_id || null;
      if (!cid) return;
      if ((i.include ?? 'Yes') === 'No') m.set(cid, i);
    });
    return m;
  }, [cogsItems]);

  const grouped = useMemo(() => {
    const g = new Map<string, Chemical[]>();
    chemicals.forEach(c => {
      const k = c.category || 'Other';
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(c);
    });
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [chemicals]);

  const toggle = async (chem: Chemical, checked: boolean) => {
    setBusy(true);
    try {
      const active = activeByChemId.get(chem.id);
      const inactive = inactiveByChemId.get(chem.id);
      if (checked) {
        if (active) return;
        if (inactive) {
          const { error } = await (supabase as any)
            .from('cogs_items')
            .update({ include: 'Yes' })
            .eq('id', inactive.id);
          if (error) throw error;
        } else {
          const baseSort = (cogsItems.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0)) + 1;
          const { error } = await (supabase as any).from('cogs_items').insert({
            product_id: productId,
            cogs_type: 'Finishing Materials',
            component_name: chem.name,
            chemical_price_id: chem.id,
            is_auto_calculated: true,
            include: 'Yes',
            units: chem.unit_type || 'L',
            components_per_product: 0,
            unit_cost_inr: Number(chem.price_per_unit_inr ?? chem.price_per_litre_inr ?? 0),
            sort_order: baseSort,
          });
          if (error) throw error;
        }
      } else {
        if (!active) return;
        // Soft remove: include = 'No' preserves any user edits.
        const { error } = await (supabase as any)
          .from('cogs_items')
          .update({ include: 'No' })
          .eq('id', active.id);
        if (error) throw error;
      }
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update chemicals');
    } finally {
      setBusy(false);
    }
  };

  const activeCount = activeByChemId.size;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <FlaskConical className="h-3.5 w-3.5" />
          Chemicals
          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center rounded bg-muted px-1.5 text-[10px] font-medium">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b">
          <div className="text-xs font-medium">Finishing chemicals</div>
          <div className="text-[10px] text-muted-foreground">Pick chemicals applied to this product.</div>
        </div>
        <div className="max-h-80 overflow-auto py-1">
          {grouped.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground">No chemicals configured.</div>
          )}
          {grouped.map(([cat, items]) => (
            <div key={cat} className="px-2 py-1.5">
              <div className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{cat}</div>
              {items.map(chem => {
                const checked = activeByChemId.has(chem.id);
                return (
                  <label
                    key={chem.id}
                    className="flex items-center gap-2 px-1 py-1 hover:bg-muted/50 rounded cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={busy}
                      onCheckedChange={(v) => toggle(chem, !!v)}
                    />
                    <span className="text-xs flex-1 truncate">{chem.name}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      ₹{Number(chem.price_per_unit_inr ?? chem.price_per_litre_inr ?? 0).toLocaleString()}/{chem.unit_type || 'L'}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
