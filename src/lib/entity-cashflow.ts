// Per-entity cashflow projection.
//
// For each inquiry, an entity can be the selling entity, the producing entity, both, or neither.
// We compute, per month, the cash this entity receives or pays based on its role.
//
//  Customer receipts        — inflow to selling entity
//  Shipping billed          — inflow to selling entity (if paying_shipping; with cust_final)
//  Inter-entity received    — inflow to producing entity when selling != producing
//  Inter-entity paid        — outflow from selling entity when selling != producing
//  Vendor payments          — outflow from producing entity
//  Shipping cost            — outflow from producing entity (if paying_shipping; at shipping_month)
//
// All amounts can be weighted by effectiveCertainty when basis = "expected".

import { effectiveCertainty, shippingEstimateUsd } from '@/lib/projections';
import { effectiveFobUsd, effectiveGpm } from '@/lib/inquiry-financials';

export type CashflowKind = 'inflow' | 'outflow' | 'net' | 'cumulative';

export type CashflowRow = {
  label: string;
  kind: CashflowKind;
  byMonth: Record<string, number>;
};

export type EntityCashflow = {
  entityId: string;
  months: string[]; // YYYY-MM-01
  rows: CashflowRow[];
  inquiryContributions: Array<{
    inquiryId: string;
    title: string;
    rfqNumber: string;
    net: Record<string, number>;
  }>;
};

export type CashflowInquiry = {
  id: string;
  title: string;
  rfqNumber: string;
  status: string;
  projection: any | null;
  products: Array<{ design_stage: string | null; quote_stage: string | null; sample_stage: string | null }>;
  liveFobUsd: number;
  liveGpm: number;
  liveTotalCostUsd: number;
};

const CATEGORY_LABELS = {
  custReceipts: 'Customer receipts',
  shipBilled: 'Shipping billed',
  ieReceived: 'Inter-entity received',
  iePaid: 'Inter-entity paid',
  vendor: 'Vendor payments',
  shipCost: 'Shipping cost',
} as const;

/** YYYY-MM key from a date-ish string (returns '' if invalid). */
function ymKey(d: string | null | undefined): string {
  if (!d) return '';
  const s = String(d).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : '';
}

/** Match a payment date to a month bucket (returns the months[] entry key, or null if outside window). */
function bucketFor(months: string[], dateStr: string | null | undefined): string | null {
  const k = ymKey(dateStr);
  if (!k) return null;
  for (const m of months) {
    if (m.slice(0, 7) === k) return m;
  }
  return null;
}

function addTo(map: Record<string, number>, month: string | null, amt: number) {
  if (!month || !amt) return;
  map[month] = (map[month] || 0) + amt;
}

export function computeEntityCashflow(
  entityId: string,
  inquiries: CashflowInquiry[],
  months: string[],
  weighted: boolean,
): EntityCashflow {
  const buckets: Record<keyof typeof CATEGORY_LABELS, Record<string, number>> = {
    custReceipts: {},
    shipBilled: {},
    ieReceived: {},
    iePaid: {},
    vendor: {},
    shipCost: {},
  };

  const contributions: EntityCashflow['inquiryContributions'] = [];

  for (const inq of inquiries) {
    const proj = inq.projection;
    if (!proj) continue;

    const sellingId = proj.selling_entity_id ?? null;
    // Default producing = selling when not set.
    const producingId = proj.producing_entity_id ?? sellingId;

    const isSelling = sellingId === entityId;
    const isProducing = producingId === entityId;
    if (!isSelling && !isProducing) continue;

    const cert = weighted ? effectiveCertainty(proj, inq.products, inq.status) : 1;
    if (cert <= 0) continue;

    const fob = effectiveFobUsd(proj, inq.status, inq.liveFobUsd);
    const gpm = effectiveGpm(proj, inq.status, inq.liveGpm, inq.liveFobUsd);
    // Producing entity's cash basis for vendor outflow = full COGS USD.
    // Use live total cost when available; fall back to fob*(1-gpm) for locked rows.
    const totalCost = inq.liveTotalCostUsd > 0 ? inq.liveTotalCostUsd : fob * (1 - gpm);

    // Retention fraction: what the selling entity keeps; producing receives (1 - retention) × FOB.
    // If null and selling === producing, no transfer regardless. If different and null, default 0
    // (= producing gets full FOB) — user can set the field to override.
    const retention = proj.selling_retention_pct == null ? 0 : Number(proj.selling_retention_pct);
    const ieTotal = fob * (1 - retention);

    const ship = shippingEstimateUsd(!!proj.paying_shipping, proj.shipping_method ?? null, fob);

    // Per-inquiry contribution tracker (net cash to this entity per month)
    const inqNet: Record<string, number> = {};
    const addInq = (m: string | null, amt: number) => {
      if (!m || !amt) return;
      inqNet[m] = (inqNet[m] || 0) + amt;
    };

    if (isSelling) {
      // Customer receipts
      const cd = bucketFor(months, proj.cust_deposit_month);
      const cf = bucketFor(months, proj.cust_final_month);
      const co = bucketFor(months, proj.cust_other_month);
      const dep = fob * Number(proj.cust_deposit_pct || 0) * cert;
      const fin = fob * Number(proj.cust_final_pct || 0) * cert;
      const oth = fob * Number(proj.cust_other_pct || 0) * cert;
      addTo(buckets.custReceipts, cd, dep);
      addTo(buckets.custReceipts, cf, fin);
      addTo(buckets.custReceipts, co, oth);
      addInq(cd, dep);
      addInq(cf, fin);
      addInq(co, oth);

      // Shipping billed (with customer final payment)
      if (ship.revenue > 0) {
        const amt = ship.revenue * cert;
        addTo(buckets.shipBilled, cf, amt);
        addInq(cf, amt);
      }

      // Inter-entity paid (only when producing is a different entity)
      if (producingId && producingId !== entityId) {
        const iedM = bucketFor(months, proj.ie_deposit_month);
        const iebM = bucketFor(months, proj.ie_balance_month);
        const ied = ieTotal * Number(proj.ie_deposit_pct || 0) * cert;
        const ieb = ieTotal * Number(proj.ie_balance_pct || 0) * cert;
        addTo(buckets.iePaid, iedM, ied);
        addTo(buckets.iePaid, iebM, ieb);
        addInq(iedM, -ied);
        addInq(iebM, -ieb);
      }
    }

    if (isProducing) {
      // Inter-entity received (only when selling is a different entity)
      if (sellingId && sellingId !== entityId) {
        const iedM = bucketFor(months, proj.ie_deposit_month);
        const iebM = bucketFor(months, proj.ie_balance_month);
        const ied = ieTotal * Number(proj.ie_deposit_pct || 0) * cert;
        const ieb = ieTotal * Number(proj.ie_balance_pct || 0) * cert;
        addTo(buckets.ieReceived, iedM, ied);
        addTo(buckets.ieReceived, iebM, ieb);
        addInq(iedM, ied);
        addInq(iebM, ieb);
      }

      // Vendor payments
      const vd = bucketFor(months, proj.vendor_deposit_month);
      const vb = bucketFor(months, proj.vendor_balance_month);
      const vdep = totalCost * Number(proj.vendor_deposit_pct || 0) * cert;
      const vbal = totalCost * Number(proj.vendor_balance_pct || 0) * cert;
      addTo(buckets.vendor, vd, vdep);
      addTo(buckets.vendor, vb, vbal);
      addInq(vd, -vdep);
      addInq(vb, -vbal);

      // Shipping cost (at shipping month)
      if (ship.cost > 0) {
        const shipM = bucketFor(months, proj.shipping_month);
        const amt = ship.cost * cert;
        addTo(buckets.shipCost, shipM, amt);
        addInq(shipM, -amt);
      }
    }

    if (Object.keys(inqNet).length > 0) {
      contributions.push({
        inquiryId: inq.id,
        title: inq.title || inq.rfqNumber,
        rfqNumber: inq.rfqNumber,
        net: inqNet,
      });
    }
  }

  // Drop categories that are all zero, then build rows.
  const rows: CashflowRow[] = [];
  const isAllZero = (m: Record<string, number>) =>
    !months.some((mo) => Math.abs(m[mo] || 0) > 0.005);

  const pushRow = (label: string, kind: CashflowKind, m: Record<string, number>) => {
    if (kind !== 'net' && kind !== 'cumulative' && isAllZero(m)) return;
    rows.push({ label, kind, byMonth: m });
  };

  // Inflows
  pushRow(CATEGORY_LABELS.custReceipts, 'inflow', buckets.custReceipts);
  pushRow(CATEGORY_LABELS.ieReceived, 'inflow', buckets.ieReceived);
  pushRow(CATEGORY_LABELS.shipBilled, 'inflow', buckets.shipBilled);
  // Outflows
  pushRow(CATEGORY_LABELS.iePaid, 'outflow', buckets.iePaid);
  pushRow(CATEGORY_LABELS.vendor, 'outflow', buckets.vendor);
  pushRow(CATEGORY_LABELS.shipCost, 'outflow', buckets.shipCost);

  // Totals
  const totalIn: Record<string, number> = {};
  const totalOut: Record<string, number> = {};
  for (const m of months) {
    totalIn[m] =
      (buckets.custReceipts[m] || 0) +
      (buckets.ieReceived[m] || 0) +
      (buckets.shipBilled[m] || 0);
    totalOut[m] =
      (buckets.iePaid[m] || 0) +
      (buckets.vendor[m] || 0) +
      (buckets.shipCost[m] || 0);
  }
  pushRow('Total inflow', 'inflow', totalIn);
  pushRow('Total outflow', 'outflow', totalOut);

  const net: Record<string, number> = {};
  const cum: Record<string, number> = {};
  let running = 0;
  for (const m of months) {
    net[m] = (totalIn[m] || 0) - (totalOut[m] || 0);
    running += net[m];
    cum[m] = running;
  }
  rows.push({ label: 'Net cash', kind: 'net', byMonth: net });
  rows.push({ label: 'Cumulative cash', kind: 'cumulative', byMonth: cum });

  return {
    entityId,
    months,
    rows,
    inquiryContributions: contributions.sort((a, b) => a.title.localeCompare(b.title)),
  };
}
