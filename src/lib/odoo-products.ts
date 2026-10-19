// Live Odoo product lookups (odoo-product-lookup) and the direct send (odoo-bom-push) for the
// product "Odoo" tab. Nothing from Odoo is copied into HQ; only a picked link is saved
// (odoo_component_links), so the next product that uses the same HQ item is pre-matched.
import { supabase } from '@/integrations/supabase/client';
import type { OdooProduct, PushPayload } from '@/lib/odoo-bom';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the links table isn't in the generated types until the SQL is run
const db = supabase as any;

type CallError = Error & { details?: { error?: string; problems?: string[] } | null };

async function call<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error?.message || 'Odoo request failed';
    let details: CallError['details'] = null;
    try { details = await (error as { context?: Response }).context?.json(); msg = details?.error || msg; } catch { /* keep generic */ }
    if (/Failed to send|FunctionsFetchError|not found/i.test(msg)) throw new Error(`The ${fn} function has not been deployed yet.`);
    const err: CallError = new Error(msg);
    err.details = details;
    throw err;
  }
  const res = data as (T & { error?: unknown }) | null;
  if (res?.error) throw new Error(String(res.error));
  return res as T;
}

export type OdooTax = { id: number; name: string; amount: number };
export type OdooMeta = { categories: string[]; uoms: { name: string; category: string }[]; routes: string[]; companies: string[]; taxes?: OdooTax[] };

export type OdooDetails = { id: number; sku: string; name: string; category: string; templateId: number; image: string | null; weightKg: number | null; volumeM3: number | null; hsn: string; taxIds: number[] };
/** Live data of products already in Odoo, by product.product id. */
export async function odooDetails(ids: number[]): Promise<OdooDetails[]> {
  const list = [...new Set(ids.filter(i => i > 0))];
  if (!list.length) return [];
  return (await call<{ products: OdooDetails[] }>('odoo-product-lookup', { action: 'details', ids: list })).products ?? [];
}
export type OdooVariant = { id: number; sku: string; label: string; ptavIds: number[] };
/** All variants on the template of an Odoo product (for BOM "Apply on Variants"). */
export async function odooVariants(productId: number): Promise<OdooVariant[]> {
  return (await call<{ variants: OdooVariant[] }>('odoo-product-lookup', { action: 'variants', productId })).variants ?? [];
}

export const odooMeta = () => call<OdooMeta>('odoo-product-lookup', { action: 'meta' });

export async function searchOdooProducts(search: string): Promise<OdooProduct[]> {
  const r = await call<{ products: OdooProduct[] }>('odoo-product-lookup', { action: 'search', search: search.trim() || null, limit: 20 });
  return r.products ?? [];
}

export async function suggestOdooProducts(names: string[]): Promise<Record<string, OdooProduct[]>> {
  if (!names.length) return {};
  const r = await call<{ suggestions: Record<string, OdooProduct[]> }>('odoo-product-lookup', { action: 'suggest', names: names.slice(0, 60) });
  return r.suggestions ?? {};
}

export async function odooProductsBySku(skus: string[]): Promise<OdooProduct[]> {
  const list = [...new Set(skus.map(s => s.trim()).filter(Boolean))];
  if (!list.length) return [];
  const r = await call<{ products: OdooProduct[] }>('odoo-product-lookup', { action: 'skus', skus: list.slice(0, 200) });
  return r.products ?? [];
}

export type PushResult = {
  ok: boolean;
  created: { kind: string; sku: string; id: number }[];
  reused: { kind: string; sku: string; id: number }[];
  bomId: number | null;
  bomReused: boolean;
  productUrl: string | null;
  bomUrl: string | null;
};

export const pushToOdoo = (payload: PushPayload) => call<PushResult>('odoo-bom-push', payload);

// ---------- Saved links ----------

/** Saved links by key; `available` is false until the odoo_component_links SQL has been run. */
export async function loadLinks(keys: string[]): Promise<{ links: Map<string, OdooProduct>; available: boolean }> {
  const links = new Map<string, OdooProduct>();
  if (!keys.length) return { links, available: true };
  const { data, error } = await db.from('odoo_component_links').select('*').in('match_key', keys);
  if (error) return { links, available: false };
  for (const r of data || []) {
    links.set(r.match_key, {
      id: r.odoo_product_id, sku: r.odoo_sku || '', name: r.odoo_name || '', display_name: r.odoo_display_name || '', uom: r.odoo_uom || '',
    });
  }
  return { links, available: true };
}

export async function saveLink(key: string, cogsType: string, hqName: string, p: OdooProduct): Promise<boolean> {
  const { error } = await db.from('odoo_component_links').upsert({
    match_key: key, cogs_type: cogsType, component_name: hqName,
    odoo_product_id: p.id, odoo_sku: p.sku || null, odoo_name: p.name || null, odoo_display_name: p.display_name || null, odoo_uom: p.uom || null,
  }, { onConflict: 'match_key' });
  return !error;
}

export async function removeLink(key: string): Promise<void> {
  await db.from('odoo_component_links').delete().eq('match_key', key);
}

export type SkuPrefix = { prefix: string; saleable: number; other: number; sample: string };

/** SKU prefixes already used in Odoo, most used first. */
export async function odooSkuPrefixes(): Promise<SkuPrefix[]> {
  const r = await call<{ prefixes: SkuPrefix[] }>('odoo-product-lookup', { action: 'prefixes' });
  return r.prefixes ?? [];
}

// ---------- Standard BOM components (Settings) ----------

export type StandardComponent = { id: string; odoo_product_id: number | null; sku: string; name: string; uom: string; default_qty: number; sort_order: number };

export async function loadStandardComponents(): Promise<StandardComponent[]> {
  const { data, error } = await db.from('odoo_standard_bom_components').select('*').order('sort_order').order('name');
  if (error) throw error;
  return (data || []).map((r: StandardComponent) => ({ ...r, default_qty: Number(r.default_qty) || 1 }));
}
