import { supabase } from '@/integrations/supabase/client';

export type NewHardwareItem = {
  name: string;
  unit_cost_inr: number;
  units: string;
};

export type HardwareConflict = {
  id: string; // existing hardware_prices.id
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
 * added / reconciled in the global hardware_prices library.
 *
 * Rules:
 * - Only Hardware / Accessories rows that are included, have a name, and a price > 0 are considered.
 * - If the name doesn't exist in hardware_prices → it's a new item to add.
 * - If the name exists with a different price → it's a conflict the user must resolve.
 * - Same name + same price → ignored (already in sync).
 */
export async function getHardwareSyncPlan(productIds: string[]): Promise<HardwareSyncPlan> {
  if (productIds.length === 0) return { newItems: [], conflicts: [] };

  const [cogsRes, hwRes] = await Promise.all([
    (supabase as any)
      .from('cogs_items')
      .select('component_name, unit_cost_inr, units, cogs_type, include')
      .in('product_id', productIds)
      .in('cogs_type', ['Hardware', 'Accessories']),
    (supabase as any).from('hardware_prices').select('id, name, unit_cost_inr, units'),
  ]);

  const hwList: Array<{ id: string; name: string; unit_cost_inr: number; units: string | null }> =
    hwRes.data ?? [];
  const hwByName = new Map(hwList.map(h => [h.name.trim().toLowerCase(), h]));

  // Collapse multiple product rows referring to the same hardware name.
  // If the same name shows multiple prices across products, take the highest.
  const fromCogs = new Map<string, { name: string; unit_cost_inr: number; units: string }>();
  for (const row of (cogsRes.data ?? []) as any[]) {
    if (row.include === 'No') continue;
    const name = (row.component_name ?? '').trim();
    const price = Number(row.unit_cost_inr ?? 0);
    if (!name || !(price > 0)) continue;
    const key = name.toLowerCase();
    const existing = fromCogs.get(key);
    if (!existing || price > existing.unit_cost_inr) {
      fromCogs.set(key, { name, unit_cost_inr: price, units: row.units || 'pc' });
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

  if (newItems.length > 0) {
    const { error } = await (supabase as any).from('hardware_prices').insert(newItems);
    if (error) return { added, updated, error: error.message };
    added = newItems.length;
  }

  for (const c of conflicts) {
    if (c.resolution !== 'update') continue;
    const { error } = await (supabase as any)
      .from('hardware_prices')
      .update({ unit_cost_inr: c.new_price_inr })
      .eq('id', c.id);
    if (error) return { added, updated, error: error.message };
    updated += 1;
  }

  return { added, updated };
}
