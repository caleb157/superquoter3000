// Fuzzy vendor-name match: HQ vendor names aren't linked to Odoo, so HQ only *suggests* an
// Odoo vendor whose name looks like the costing line's vendor. The user still confirms it.
const NOISE = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company', 'inc', 'the', 'and', 'enterprises', 'enterprise', 'industries', 'traders', 'm/s', 'ms']);

export function vendorTokens(name: string): string[] {
  return name.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(t => t.length > 1 && !NOISE.has(t));
}

/** 0..1 similarity between two vendor names (shared meaningful words). */
export function vendorSimilarity(a: string, b: string): number {
  const ta = vendorTokens(a), tb = vendorTokens(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(' ') === tb.join(' ')) return 1;
  const sb = new Set(tb);
  const shared = ta.filter(t => sb.has(t)).length;
  return shared / Math.min(ta.length, tb.length);
}

/** Best Odoo vendor for an HQ vendor name, or null when nothing is close enough. */
export function bestVendorMatch<T extends { name: string }>(hqName: string, candidates: T[], min = 0.6): T | null {
  let best: T | null = null, score = 0;
  for (const c of candidates) {
    const s = vendorSimilarity(hqName, c.name);
    if (s > score) { best = c; score = s; }
  }
  return score >= min ? best : null;
}

/** The word to search Odoo with: the longest meaningful word of the HQ vendor name. */
export const vendorSearchWord = (name: string) => vendorTokens(name).sort((x, y) => y.length - x.length)[0] ?? '';
