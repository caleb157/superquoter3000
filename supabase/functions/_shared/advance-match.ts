// Pure matching of unreconciled customer/vendor payments to open SOs/POs by reference.
// Shared by odoo-analytics-sync and its tests; no Deno or Odoo calls here.

/** Order/PO numbers normalised so P00038 = P38 = PO38. P0100–P0109 are RBI purpose codes on bank memos. */
export const poRefTokens = (s: string) => [...String(s || '').toUpperCase().matchAll(/\bP(?:O)?[-\s]?0*(\d{2,})\b/g)]
  .filter(m => !/^P010[0-9]$/.test(m[0].replace(/\s|-/g, '')))
  .map(m => 'P' + m[1]);
/** Sales order numbers ("S00135") normalised to S135. */
export const soRefTokens = (s: string) => [...String(s || '').toUpperCase().matchAll(/\bS0*(\d{3,})\b/g)].map(m => 'S' + m[1]);

export type RefPayment = { partner_id: number | null; inr: number; name: string; text: string };
export type MatchItem = {
  ref: string; partner_id: number | null; date: string; amount_inr: number; amount_usd: number;
  /** Tokens this order answers to, strongest first (own number, then customer reference). */
  tokens: string[];
  advance_applied_inr?: number; paid_by_ref_inr?: number; paid_by_ref?: string[];
};

/** Applies each payment to the partner's open orders its memo/description names (oldest first when a
 *  token names several). SO numbers beat customer PO references. Returns what is left unapplied per partner. */
export function applyRefPayments(items: MatchItem[], pays: RefPayment[], tokensOf: (text: string) => string[]) {
  const unapplied = new Map<number | null, number>();
  for (const pay of pays) {
    let left = pay.inr;
    const mine = items.filter(it => it.partner_id === pay.partner_id);
    for (const tok of tokensOf(pay.text)) {
      const hits = mine.filter(it => it.tokens.includes(tok) && it.amount_inr > 0.5).sort((a, b) => a.date.localeCompare(b.date));
      if (!hits.length) continue;
      for (const it of hits) {
        if (left <= 0.5) break;
        const take = Math.min(left, it.amount_inr);
        it.amount_usd -= it.amount_inr > 0 ? it.amount_usd * (take / it.amount_inr) : 0;
        it.amount_inr -= take;
        it.advance_applied_inr = (it.advance_applied_inr || 0) + take;
        it.paid_by_ref_inr = (it.paid_by_ref_inr || 0) + take;
        it.paid_by_ref = [...(it.paid_by_ref || []), pay.name];
        left -= take;
      }
      break; // a payment counts toward the first reference that names an open order
    }
    if (left > 0.5) unapplied.set(pay.partner_id, (unapplied.get(pay.partner_id) || 0) + left);
  }
  return unapplied;
}

/** FIFO: a partner's remaining advance pool soaks up its earliest open orders. */
export function waterfallRemainder(items: MatchItem[], poolByPartner: (pid: number | null) => number) {
  const byPartner = new Map<number | null, MatchItem[]>();
  for (const it of items) { if (!byPartner.has(it.partner_id)) byPartner.set(it.partner_id, []); byPartner.get(it.partner_id)!.push(it); }
  for (const [pid, list] of byPartner) {
    let left = Math.max(0, poolByPartner(pid));
    for (const it of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      if (left <= 0) break;
      const take = Math.min(left, it.amount_inr);
      if (take <= 0) continue;
      it.amount_usd -= it.amount_inr > 0 ? it.amount_usd * (take / it.amount_inr) : 0;
      it.amount_inr -= take;
      it.advance_applied_inr = (it.advance_applied_inr || 0) + take;
      left -= take;
    }
  }
}
