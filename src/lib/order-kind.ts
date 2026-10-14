// Trading vs manufacturing for an Odoo sales order, from its Odoo tags: a tag named "Trading" or
// "Manufacturing" (any case) decides it. MOs are also used on trading projects, so the MO count is
// only a guess for orders with neither tag (or both): any finished MO = manufacturing.
import type { SoOrder } from '@/lib/so-profitability';

export type OrderKind = 'trading' | 'manufacturing';

export const guessOrderKind = (o: Pick<SoOrder, 'mos'>): OrderKind => (o.mos.length > 0 ? 'manufacturing' : 'trading');

/** The kind its Odoo tags give, or null when it has neither tag or both. */
export function kindFromTags(tags: string[] | null | undefined): OrderKind | null {
  const t = new Set((tags ?? []).map(x => x.trim().toLowerCase()));
  const trading = t.has('trading');
  const mfg = t.has('manufacturing');
  return trading === mfg ? null : trading ? 'trading' : 'manufacturing';
}

/** Tagged kind when there is one, else the MO guess. */
export function orderKind(o: Pick<SoOrder, 'mos' | 'tags'>): { kind: OrderKind; tagged: boolean } {
  const k = kindFromTags(o.tags);
  return k ? { kind: k, tagged: true } : { kind: guessOrderKind(o), tagged: false };
}
