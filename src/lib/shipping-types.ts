// Shipping types retired on 2026-11-13 and the type that took their place.
// sql/retire-shipping-types-2026-11.sql moves every row onto the replacement and deletes the
// old type; this map lets the app read an old name (a quote's term, the default shipping type)
// the same way, whether or not that SQL has run yet.
const norm = (s: string) => s.trim().toLowerCase().replace(/[–—-]+/g, '-').replace(/\s+/g, ' ');

export const RETIRED_SHIPPING_TYPES: Record<string, string> = {
  'FOB Navasheva': 'FOB MUMBAI LCL',
  'FOB MUNDRA': 'FOB Mundra via Jodhpur ICD',
  'FOB Jodhpur': 'FOB Mundra via Jodhpur ICD',
  'FOB – 40HC standard': 'FOB Mundra via Jodhpur ICD',
  'EX Works shipped to Mumbai': 'FOB MUMBAI LCL',
};

const BY_NORM = new Map(Object.entries(RETIRED_SHIPPING_TYPES).map(([k, v]) => [norm(k), v]));

/** The current name for a shipping type name: the replacement when it was retired, else as given. */
export function currentShippingTypeName(name: string | null | undefined): string | null {
  if (!name || !name.trim()) return null;
  return BY_NORM.get(norm(name)) ?? name.trim();
}

/** Finds a shipping type by name, ignoring case, dash style and retired names. */
export function findShippingType<T extends { name: string }>(types: T[], name: string | null | undefined): T | undefined {
  const want = currentShippingTypeName(name);
  if (!want) return undefined;
  return types.find(t => norm(t.name) === norm(want));
}
