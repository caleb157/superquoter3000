// Pure comparison of an in-house build vs a fully outsourced purchase for one product.
// In-house: the normal costing engine, with any "Outsourced Product" row switched off.
// Outsourced: purchased unit price replaces raw materials, finishing, packaging, labour
// and non-unit COGS. Shipping and cost-of-capital rate/months stay the same; markup too.
import * as calc from '@/lib/calculations';
import { computeProductCosting, OUTSOURCED_COGS_NAME, type CostingEngineInput } from '@/lib/costing-engine';

export type OutsourceComparison = {
  qty: number;
  exchangeRate: number;
  existingOutsourcedInr: number | null;
  inhouse: ReturnType<typeof calc.calcProductCostSummary>;
  outsourced: ReturnType<typeof calc.calcProductCostSummary> | null;
  shippingPerUnit: number;
};

const isOutsourcedRow = (c: any) =>
  (c.component_name || '').toLowerCase() === OUTSOURCED_COGS_NAME.toLowerCase();

export function findExistingOutsourcedInr(product: any, cogsItems: any[]): number | null {
  const row = cogsItems.find(isOutsourcedRow);
  if (row && Number(row.unit_cost_inr) > 0) {
    return (Number(row.components_per_product) || 1) * Number(row.unit_cost_inr);
  }
  const legacy = Number(product.outsourced_unit_cost_inr) || 0;
  return legacy > 0 ? legacy : null;
}

export function compareInhouseVsOutsourced(
  input: CostingEngineInput,
  outsourcedUnitInr: number | null,
): OutsourceComparison {
  const p = input.product;
  const typeIsOutsourced = (input.productType?.name || '') === 'Outsourced' || !!p.is_outsourced;

  // In-house scenario. Products currently set to Outsourced had every row bulk-switched
  // to "No" — switch them back on so the in-house build is costed.
  const reinclude = (rows: any[]) => rows.map(r => (typeIsOutsourced ? { ...r, include: 'Yes' } : r));
  const inhouseRes = computeProductCosting({
    ...input,
    product: { ...p, is_outsourced: false, outsourced_unit_cost_inr: null, outsourced_unit_cost_usd: null },
    productType: typeIsOutsourced && input.productType ? { ...input.productType, name: '__inhouse' } : input.productType,
    cogsItems: reinclude(input.cogsItems.filter(c => !isOutsourcedRow(c))),
    nonUnitCogs: reinclude(input.nonUnitCogs),
    overheadItems: reinclude(input.overheadItems),
  });

  const qty = p.quantity || 100;
  const outsourced = outsourcedUnitInr != null && outsourcedUnitInr > 0
    ? calc.calcProductCostSummary(
        outsourcedUnitInr, 0, 0, 0, inhouseRes.shippingPerUnit,
        inhouseRes.markupPercent, inhouseRes.exchangeRate, qty, inhouseRes.capitalFactor,
      )
    : null;

  return {
    qty,
    exchangeRate: inhouseRes.exchangeRate,
    existingOutsourcedInr: findExistingOutsourcedInr(p, input.cogsItems),
    inhouse: inhouseRes.summary,
    outsourced,
    shippingPerUnit: inhouseRes.shippingPerUnit,
  };
}
