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

  // Infer a chemical category from a legacy row's name (rows created before
  // chemical_price_id linkage was added won't have the FK, so match by name).
  const inferCategory = (name: string | null | undefined): string | null => {
    const n = (name || '').toLowerCase();
    if (n.includes('color') || n.includes('stain')) return 'Color';
    if (n.includes('sealer')) return 'Sealer';
    if (n.includes('lacquer')) return 'Lacquer';
    if (n.includes('wax')) return 'Wax';
    return null;
  };

  // For each chemical (by id) find the finishing-materials row that represents it.
  // Match by chemical_price_id first, then fall back to same-category legacy rows.
  const rowForChem = (chem: Chemical, wantInclude: 'Yes' | 'No' | 'any' = 'any'): CogsItem | undefined => {
    const finishing = cogsItems.filter(i => i.cogs_type === 'Finishing Materials');
    const matchInclude = (i: CogsItem) => {
      const inc = (i.include ?? 'Yes') === 'No' ? 'No' : 'Yes';
      return wantInclude === 'any' ? true : inc === wantInclude;
    };
    const linked = finishing.find(i => i.chemical_price_id === chem.id && matchInclude(i));
    if (linked) return linked;
    // Skip legacy fallback if another row already claims this category via id.
    const claimedCategoryIds = new Set(
      finishing
        .filter(i => i.chemical_price_id)
        .map(i => chemicals.find(c => c.id === i.chemical_price_id)?.category)
        .filter(Boolean) as string[]
    );
    if (claimedCategoryIds.has(chem.category)) return undefined;
    return finishing.find(i => !i.chemical_price_id && inferCategory(i.component_name) === chem.category && matchInclude(i));
  };

  const activeByChemId = useMemo(() => {
    const m = new Map<string, CogsItem>();
    chemicals.forEach(c => {
      const row = rowForChem(c, 'Yes');
      if (row) m.set(c.id, row);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cogsItems, chemicals]);

  const inactiveByChemId = useMemo(() => {
    const m = new Map<string, CogsItem>();
    chemicals.forEach(c => {
      if (activeByChemId.has(c.id)) return;
      const row = rowForChem(c, 'No');
      if (row) m.set(c.id, row);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cogsItems, chemicals, activeByChemId]);

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
          const patch: any = { include: 'Yes' };
          if (!inactive.chemical_price_id) patch.chemical_price_id = chem.id;
          const { error } = await (supabase as any)
            .from('cogs_items')
            .update(patch)
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
            unit_cost_inr: 0,
            sort_order: baseSort,
          });
          if (error) throw error;
        }
      } else {
        if (!active) return;
        // Soft remove; also link chemical_price_id so future toggles find this row.
        const patch: any = { include: 'No' };
        if (!active.chemical_price_id) patch.chemical_price_id = chem.id;
        const { error } = await (supabase as any)
          .from('cogs_items')
          .update(patch)
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
