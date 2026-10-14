// Trading vs manufacturing for an Odoo sales order. Odoo has no such flag and MOs are also used
// on trading projects, so the kind is set by hand per SO (odoo_order_kinds, keyed by SO number).
// Orders nobody has classified yet fall back to a guess: any finished MO = manufacturing.
// Loaded and saved by src/hooks/use-order-kinds.ts.
import type { SoOrder } from '@/lib/so-profitability';

export type OrderKind = 'trading' | 'manufacturing';
export type OrderKinds = Record<string, OrderKind>;

export const guessOrderKind = (o: Pick<SoOrder, 'mos'>): OrderKind => (o.mos.length > 0 ? 'manufacturing' : 'trading');

/** The hand-set kind when there is one, else the MO guess. */
export function orderKind(o: Pick<SoOrder, 'name' | 'mos'>, kinds: OrderKinds | null | undefined): { kind: OrderKind; manual: boolean } {
  const k = kinds?.[o.name];
  return k ? { kind: k, manual: true } : { kind: guessOrderKind(o), manual: false };
}
