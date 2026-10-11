// Saved Iron Weight Calculator builds (table iron_builds), keyed by a free-text SKU + label.
// Not linked to the products table on purpose — any SKU string can hold a build.
import { supabase } from '@/integrations/supabase/client';
import { grandTotal } from '@/lib/iron-weight-core';
import { isBuild, type Build } from '@/lib/iron-weight';

export type IronBuildRow = {
  id: string; sku: string; label: string; price_per_kg: number | null; data: Build;
  total_kg: number | null; total_cost: number | null; notes: string | null; updated_at: string;
};
export type IronBuildMeta = Omit<IronBuildRow, 'data'>;

// iron_builds isn't in the generated Supabase types until they are regenerated.
const table = () => (supabase as any).from('iron_builds');

/** True when the database hasn't had the iron_builds migration applied yet. */
export const isMissingTable = (e: any) =>
  e?.code === '42P01' || e?.code === 'PGRST205' || /iron_builds/.test(String(e?.message)) && /(not find|does not exist|schema cache)/i.test(String(e?.message));

export async function listBuilds(): Promise<IronBuildMeta[]> {
  const { data, error } = await table()
    .select('id, sku, label, price_per_kg, total_kg, total_cost, notes, updated_at')
    .order('sku').order('label');
  if (error) throw error;
  return data ?? [];
}

export async function getBuild(id: string): Promise<IronBuildRow> {
  const { data, error } = await table().select('*').eq('id', id).single();
  if (error) throw error;
  if (!isBuild(data?.data)) throw new Error('This saved build is in an unexpected format.');
  return data;
}

export async function findBuild(sku: string, label: string): Promise<IronBuildMeta | null> {
  const { data, error } = await table().select('id, sku, label, price_per_kg, total_kg, total_cost, notes, updated_at')
    .eq('sku', sku).eq('label', label).maybeSingle();
  if (error) throw error;
  return data;
}

/** Insert, or overwrite the build with the same SKU + label. */
export async function saveBuild(sku: string, label: string, build: Build): Promise<IronBuildMeta> {
  const price = build.pricePerKg && build.pricePerKg > 0 ? build.pricePerKg : null;
  const t = grandTotal(build.legs, { pricePerKg: price ?? undefined });
  const row = {
    sku, label, price_per_kg: price,
    data: { pricePerKg: build.pricePerKg, legs: build.legs },
    total_kg: t.ok ? t.totalKg : null,
    total_cost: t.ok && t.totalCost != null ? t.totalCost : null,
  };
  const { data, error } = await table().upsert(row, { onConflict: 'sku,label' })
    .select('id, sku, label, price_per_kg, total_kg, total_cost, notes, updated_at').single();
  if (error) throw error;
  return data;
}

export async function deleteBuild(id: string) {
  const { error } = await table().delete().eq('id', id);
  if (error) throw error;
}
