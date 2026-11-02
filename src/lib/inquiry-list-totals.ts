// DKT's share and the totals row on the Inquiries list.
//
// DKT share: when an inquiry is sold through DKT (its Projections tab's selling entity is
// DKT), DKT keeps "Selling entity retention %" of the order value. When that % is blank,
// the DKT Cash Flow default margin is used, the same rule as Tools → DKT Cash Flow.
import type { InquiryTotals } from '@/lib/inquiry-totals';

export type Entity = { id: string; name: string | null; entity_type?: string | null };

/** The same PV / DKT pick as the DKT Cash Flow and Master Analytics. */
export function pickEntities(entities: Entity[]): { pvId: string | null; dktId: string | null } {
  const pv = entities.find(e => /parable/i.test(e.name || '') || e.entity_type === 'India');
  const dkt = entities.find(e => /\bdkt\b|desert/i.test(e.name || ''))
    ?? entities.find(e => e.id !== pv?.id && e.entity_type !== 'India');
  return { pvId: pv?.id ?? null, dktId: dkt?.id ?? null };
}

export type ProjectionShare = { selling_entity_id?: string | null; selling_retention_pct?: number | string | null };

const toFrac = (v: number) => (v > 1 ? v / 100 : v);

/** DKT's % of the order value (0..1), or null when DKT doesn't sell this inquiry. */
export function dktSharePct(
  proj: ProjectionShare | null | undefined,
  ent: { pvId: string | null; dktId: string | null },
  defaultPct: number,
): { pct: number; isDefault: boolean } | null {
  const sel = proj?.selling_entity_id;
  if (!sel) return null;
  const viaDkt = ent.dktId ? sel === ent.dktId : sel !== ent.pvId;
  if (!viaDkt) return null;
  const raw = proj?.selling_retention_pct;
  if (raw == null || raw === '' || !Number.isFinite(Number(raw))) return { pct: toFrac(defaultPct), isDefault: true };
  return { pct: toFrac(Number(raw)), isDefault: false };
}

export type ListTotals = {
  rows: number; products: number; manHours: number; cbm: number;
  revenueUsd: number; profitUsd: number; dktUsd: number;
  /** profit ÷ revenue, null without revenue. */
  margin: number | null;
};

/** Sum of the rows shown. Money is in USD (rupee orders use the USD figures the live run already holds). */
export function sumListTotals(rows: {
  products: number; manHours?: number | null; cbm?: number | null;
  totals?: InquiryTotals | null; dktPct?: number | null;
}[]): ListTotals {
  const out: ListTotals = { rows: rows.length, products: 0, manHours: 0, cbm: 0, revenueUsd: 0, profitUsd: 0, dktUsd: 0, margin: null };
  for (const r of rows) {
    out.products += r.products || 0;
    out.manHours += Number(r.manHours) || 0;
    out.cbm += Number(r.cbm) || 0;
    const t = r.totals;
    if (t && t.revenueUsd > 0) {
      out.revenueUsd += t.revenueUsd;
      out.profitUsd += t.profitUsd;
      if (r.dktPct) out.dktUsd += t.revenueUsd * r.dktPct;
    }
  }
  out.margin = out.revenueUsd > 0 ? out.profitUsd / out.revenueUsd : null;
  return out;
}
