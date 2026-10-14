import { HARDWARE_COGS_TYPES_WITH_LEGACY } from '@/lib/cogs-categories';
import { supabase } from '@/integrations/supabase/client';
import { loadHardwarePrices, type HardwarePrice } from '@/lib/hardware-prices';

export type NewHardwareItem = {
  name: string;
  unit_cost_inr: number;
  units: string;
  /** The hardware COGS category it was used under; becomes its Materials & hardware category. */
  category: string;
};

export type HardwareConflict = {
  id: string; // existing library row id
  source: HardwarePrice['source'];
  category: string;
  name: string;
  units: string;
  existing_price_inr: number;
  new_price_inr: number;
};

export type HardwareSyncPlan = {
  newItems: NewHardwareItem[];
  conflicts: HardwareConflict[];
};

/**
 * Inspect COGS items for the given products and figure out what needs to be
 * added / reconciled in the hardware price library (Settings → Materials & hardware).
 *
 * Rules:
 * - Only Hardware / Accessories rows that are included, have a name, and a price > 0 are considered.
 * - If the name isn't in the library → it's a new item to add.
 * - If the name exists with a different price → it's a conflict the user must resolve.
 * - Same name + same price → ignored (already in sync).
 */
export async function getHardwareSyncPlan(productIds: string[]): Promise<HardwareSyncPlan> {
  if (productIds.length === 0) return { newItems: [], conflicts: [] };

  const [cogsRes, hwList] = await Promise.all([
    (supabase as any)
      .from('cogs_items')
      .select('component_name, unit_cost_inr, units, cogs_type, include')
      .in('product_id', productIds)
      .in('cogs_type', HARDWARE_COGS_TYPES_WITH_LEGACY),
    loadHardwarePrices(),
  ]);
  const hwByName = new Map(hwList.map(h => [h.name.trim().toLowerCase(), h]));

  // Collapse multiple product rows referring to the same hardware name.
  // If the same name shows multiple prices across products, take the highest.
  const fromCogs = new Map<string, NewHardwareItem>();
  for (const row of (cogsRes.data ?? []) as any[]) {
    if (row.include === 'No') continue;
    const name = (row.component_name ?? '').trim();
    const price = Number(row.unit_cost_inr ?? 0);
    if (!name || !(price > 0)) continue;
    const key = name.toLowerCase();
    const existing = fromCogs.get(key);
    if (!existing || price > existing.unit_cost_inr) {
      fromCogs.set(key, { name, unit_cost_inr: price, units: row.units || 'pc', category: row.cogs_type === 'Hardware' ? 'Other Hardware' : row.cogs_type });
    }
  }

  const newItems: NewHardwareItem[] = [];
  const conflicts: HardwareConflict[] = [];

  for (const [key, item] of fromCogs) {
    const existing = hwByName.get(key);
    if (!existing) {
      newItems.push(item);
    } else if (Number(existing.unit_cost_inr) !== item.unit_cost_inr) {
      conflicts.push({
        id: existing.id,
        source: existing.source,
        category: item.category,
        name: existing.name,
        units: existing.units || item.units,
        existing_price_inr: Number(existing.unit_cost_inr),
        new_price_inr: item.unit_cost_inr,
      });
    }
  }

  newItems.sort((a, b) => a.name.localeCompare(b.name));
  conflicts.sort((a, b) => a.name.localeCompare(b.name));
  return { newItems, conflicts };
}

export type ConflictResolution = 'keep' | 'update';

/**
 * Apply a hardware sync plan after the user has resolved any conflicts.
 * - newItems are inserted unconditionally.
 * - conflicts marked 'update' overwrite the existing global price.
 * - conflicts marked 'keep' are skipped.
 */
export async function applyHardwareSync(
  newItems: NewHardwareItem[],
  conflicts: Array<HardwareConflict & { resolution: ConflictResolution }>
): Promise<{ added: number; updated: number; error?: string }> {
  let added = 0;
  let updated = 0;

  const asMaterial = (h: { name: string; unit_cost_inr: number; units: string; category: string }) =>
    ({ category: h.category, name: h.name, cost: h.unit_cost_inr, unit_type: h.units || 'pc', currency: 'INR', active: true });

  if (newItems.length > 0) {
    const { error } = await (supabase as any).from('raw_material_costs').insert(newItems.map(asMaterial));
    if (error) return { added, updated, error: error.message };
    added = newItems.length;
  }

  for (const c of conflicts) {
    if (c.resolution !== 'update') continue;
    // A row still in the old hardware_prices table moves into the materials list with its new price.
    const { error } = c.source === 'legacy'
      ? await (supabase as any).from('raw_material_costs').insert(asMaterial({ name: c.name, unit_cost_inr: c.new_price_inr, units: c.units, category: c.category }))
      : await (supabase as any).from('raw_material_costs').update({ cost: c.new_price_inr }).eq('id', c.id);
    if (error) return { added, updated, error: error.message };
    updated += 1;
  }

  return { added, updated };
}
