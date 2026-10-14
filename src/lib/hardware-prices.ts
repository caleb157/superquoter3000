// The hardware price library: Settings → Materials & hardware rows whose category is a hardware
// COGS category. Until the move SQL has copied the old hardware_prices table across, its rows
// are added for names the materials list doesn't have yet (and ignored once that table is gone).
import { supabase } from '@/integrations/supabase/client';
import { HARDWARE_COGS_TYPES_WITH_LEGACY } from '@/lib/cogs-categories';

export type HardwarePrice = {
  id: string;
  name: string;
  unit_cost_inr: number;
  units: string;
  /** 'materials' = a raw_material_costs row; 'legacy' = an old hardware_prices row not moved yet. */
  source: 'materials' | 'legacy';
};

export function mergeHardwarePrices(materials: any[], legacy: any[]): HardwarePrice[] {
  const out: HardwarePrice[] = materials
    .filter(r => r.active !== false && HARDWARE_COGS_TYPES_WITH_LEGACY.includes(r.category) && (r.currency || 'INR') === 'INR')
    .map(r => ({ id: r.id, name: r.name, unit_cost_inr: Number(r.cost) || 0, units: r.unit_type || 'pc', source: 'materials' as const }));
  const seen = new Set(out.map(h => h.name.trim().toLowerCase()));
  for (const h of legacy) {
    const key = (h.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: h.id, name: h.name, unit_cost_inr: Number(h.unit_cost_inr) || 0, units: h.units || 'pc', source: 'legacy' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadHardwarePrices(): Promise<HardwarePrice[]> {
  const [mat, legacy] = await Promise.all([
    (supabase as any).from('raw_material_costs').select('id, name, cost, unit_type, currency, category, active').in('category', HARDWARE_COGS_TYPES_WITH_LEGACY),
    (supabase as any).from('hardware_prices').select('id, name, unit_cost_inr, units'),
  ]);
  return mergeHardwarePrices(mat.data || [], legacy.error ? [] : legacy.data || []);
}
