// Rough quotes: one-click quote generation from an inquiry's products or assemblies.
// Prices come from the live costing engine (or a supplied reference price); the quote is
// created as a draft and edited afterwards, so there is no review step here.
import { supabase } from '@/integrations/supabase/client';
import { convertFromInr, getCachedCurrencyMap, loadCurrencyMap } from '@/lib/currency';
import { computeProductUnitPrices, type ProductUnitPriceMap } from '@/lib/product-pricing';
import type { QuoteProductInput } from '@/lib/quote-creation';
import { fxOrFallback } from '@/lib/live-rates';

export type PriceableProduct = {
  id: string;
  name: string;
  quantity?: number | null;
  reference_price_usd?: number | null; // a known USD reference (e.g. the live price the list shows)
  reference_price_inr?: number | null; // the same in rupees, used as-is for INR quotes
  target_price_usd?: number | null;
  markup_percent?: number | null;
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Unit price in the quote currency: a supplied USD reference wins, else the engine's price. */
export function referencePriceFor(p: PriceableProduct, prices: ProductUnitPriceMap, currency: string): number {
  const entry = prices[p.id];
  const fx = fxOrFallback(entry?.exchange_rate ?? Object.values(prices)[0]?.exchange_rate);
  const map = getCachedCurrencyMap();
  if (currency === 'INR' && Number(p.reference_price_inr) > 0) return Number(p.reference_price_inr);
  const supplied = Number(p.reference_price_usd ?? p.target_price_usd ?? 0);
  if (supplied > 0) {
    if (currency === 'USD') return supplied;
    const inr = supplied * fx;
    return currency === 'INR' ? inr : convertFromInr(map, inr, currency, 'import');
  }
  if (entry && (entry.unit_price_usd > 0 || entry.unit_price_inr > 0)) {
    if (currency === 'INR') return entry.unit_price_inr;
    if (currency === 'USD') return entry.unit_price_usd;
    return convertFromInr(map, entry.unit_price_inr, currency, 'import');
  }
  return 0;
}

/** Entity, currency and Incoterm for a new quote: the inquiry's settings, else sensible fallbacks.
 *  Incoterm = last one used on this inquiry, else on any of this customer's quotes. */
export async function resolveQuoteDefaults(inquiryId: string): Promise<{
  entity: { id: string; name: string } | null; currency: string; incoterm: string | null;
}> {
  const [{ data: entities }, { data: inq }, { data: ships }] = await Promise.all([
    supabase.from('company_entities').select('id, name').order('name'),
    (supabase as any).from('customer_rfqs').select('quoting_entity_id, quoting_currency, customer_id').eq('id', inquiryId).maybeSingle(),
    supabase.from('shipping_types').select('name'),
  ]);
  const ents = (entities ?? []) as Array<{ id: string; name: string }>;
  const entity = ents.find(e => e.id === inq?.quoting_entity_id) ?? ents[0] ?? null;
  const known = new Set(((ships ?? []) as any[]).map(s => s.name));
  const lastIncoterm = async (ids: string[]) => {
    if (ids.length === 0) return null;
    const { data } = await (supabase as any).from('quote_snapshots').select('incoterm')
      .in('customer_rfq_id', ids).not('incoterm', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data?.incoterm && known.has(data.incoterm) ? (data.incoterm as string) : null;
  };
  let incoterm = await lastIncoterm([inquiryId]);
  if (!incoterm && inq?.customer_id) {
    const { data: custInqs } = await (supabase as any).from('customer_rfqs').select('id').eq('customer_id', inq.customer_id);
    incoterm = await lastIncoterm(((custInqs ?? []) as any[]).map(r => r.id));
  }
  return { entity, currency: (inq?.quoting_currency as string) || 'USD', incoterm };
}

/** Quote lines for products, priced and sorted by name. */
export async function priceProductLines(products: PriceableProduct[], currency: string): Promise<QuoteProductInput[]> {
  await loadCurrencyMap();
  const prices = products.length ? await computeProductUnitPrices(products.map(p => p.id)) : {};
  return products.slice().sort(byName).map(p => {
    const ref = referencePriceFor(p, prices, currency);
    return {
      id: p.id, name: p.name, quantity: Number(p.quantity ?? 0),
      unit_price_override: ref > 0 ? Number(ref.toFixed(2)) : 0,
      display_name: p.name,
    } as QuoteProductInput;
  });
}

export type PriceableAssembly = {
  id: string;
  name: string;
  quantity?: number | null;
  markup_percent?: number | null;
  components: Array<{ product_id: string; quantity_per_assembly: number }>;
};

/** Quote lines for kits: component costs (INR) summed, kit markup applied, sorted by name. */
export async function priceAssemblyLines(assemblies: PriceableAssembly[], currency: string): Promise<QuoteProductInput[]> {
  await loadCurrencyMap();
  const compIds = Array.from(new Set(assemblies.flatMap(a => a.components.map(c => c.product_id))));
  const prices = compIds.length ? await computeProductUnitPrices(compIds) : {};
  const fx = fxOrFallback((Object.values(prices)[0] as any)?.exchange_rate);
  const map = getCachedCurrencyMap();
  return assemblies.slice().sort(byName).map(a => {
    const costInr = a.components.reduce((sum, c) => {
      const e = prices[c.product_id];
      return sum + (e ? e.unit_cost_usd * (e.exchange_rate || fx) : 0) * (c.quantity_per_assembly || 1);
    }, 0);
    const priceInr = costInr * (1 + (a.markup_percent ?? 0.2));
    const price = currency === 'INR' ? priceInr
      : currency === 'USD' ? (fx > 0 ? priceInr / fx : 0)
      : convertFromInr(map, priceInr, currency, 'import');
    return {
      id: a.id, name: a.name, quantity: Number(a.quantity ?? 0),
      unit_price_override: price > 0 ? Number(price.toFixed(2)) : 0,
      display_name: a.name, assembly_id: a.id,
    } as QuoteProductInput;
  });
}
