/**
 * Target Price Solver
 *
 * Inverts the SAME pricing formula used everywhere else in the app
 * (see calcProductCostSummary in calculations.ts):
 *
 *   unit_price_inr = product_cost_per_unit_inr * (1 + markupPercent)
 *
 * i.e. this app uses the COST-MARKUP convention (not price = cost / (1 - margin)).
 * NPM is derived from markup via markupToNpm().
 */

export type CostBucket = { label: string; valueInr: number };

export type SolveMarkupResult = {
  feasible: boolean;
  /** Required markup (decimal, e.g. 0.31 for 31%) to reach the target price at current cost. */
  requiredMarkup: number;
  /** Same expressed as net profit margin. */
  requiredNpm: number;
  currentMarkup: number;
  currentNpm: number;
  markupDelta: number;
};

export type SolveCostResult = {
  feasible: boolean;
  /** Max allowable total unit cost (INR) at the current markup. */
  maxCostInr: number;
  maxCostUsd: number;
  currentCostInr: number;
  currentCostUsd: number;
  /** Positive = must cut cost, negative = headroom available. */
  cutRequiredInr: number;
  cutRequiredUsd: number;
  /** Proportional allocation of the required cut across cost buckets (rough estimate). */
  allocation: Array<{ label: string; currentInr: number; share: number; cutInr: number; targetInr: number }>;
};

export function solveForMarkup(params: {
  targetPriceUsd: number;
  currentCostInr: number;
  exchangeRate: number;
  currentMarkup: number;
}): SolveMarkupResult {
  const { targetPriceUsd, currentCostInr, exchangeRate, currentMarkup } = params;
  const base = {
    currentMarkup,
    currentNpm: currentMarkup > 0 ? currentMarkup / (1 + currentMarkup) : 0,
  };
  if (!(targetPriceUsd > 0) || !(currentCostInr > 0) || !(exchangeRate > 0)) {
    return { feasible: false, requiredMarkup: 0, requiredNpm: 0, markupDelta: 0, ...base };
  }
  const targetPriceInr = targetPriceUsd * exchangeRate;
  const requiredMarkup = targetPriceInr / currentCostInr - 1;
  return {
    feasible: requiredMarkup > -1,
    requiredMarkup,
    requiredNpm: requiredMarkup > 0 ? requiredMarkup / (1 + requiredMarkup) : 0,
    markupDelta: requiredMarkup - currentMarkup,
    ...base,
  };
}

export function solveForMaxCost(params: {
  targetPriceUsd: number;
  currentCostInr: number;
  exchangeRate: number;
  markupPercent: number;
  buckets: CostBucket[];
}): SolveCostResult {
  const { targetPriceUsd, currentCostInr, exchangeRate, markupPercent, buckets } = params;
  const empty: SolveCostResult = {
    feasible: false,
    maxCostInr: 0, maxCostUsd: 0,
    currentCostInr, currentCostUsd: exchangeRate > 0 ? currentCostInr / exchangeRate : 0,
    cutRequiredInr: 0, cutRequiredUsd: 0,
    allocation: [],
  };
  if (!(targetPriceUsd > 0) || !(exchangeRate > 0) || markupPercent <= -1) return empty;

  const maxCostInr = (targetPriceUsd / (1 + markupPercent)) * exchangeRate;
  const cutRequiredInr = currentCostInr - maxCostInr;
  const positiveBuckets = buckets.filter(b => (b.valueInr || 0) > 0);
  const totalBuckets = positiveBuckets.reduce((s, b) => s + b.valueInr, 0);

  const allocation = positiveBuckets.map(b => {
    const share = totalBuckets > 0 ? b.valueInr / totalBuckets : 0;
    const cutInr = cutRequiredInr * share;
    return {
      label: b.label,
      currentInr: b.valueInr,
      share,
      cutInr,
      targetInr: b.valueInr - cutInr,
    };
  });

  return {
    feasible: maxCostInr > 0,
    maxCostInr,
    maxCostUsd: maxCostInr / exchangeRate,
    currentCostInr,
    currentCostUsd: currentCostInr / exchangeRate,
    cutRequiredInr,
    cutRequiredUsd: cutRequiredInr / exchangeRate,
    allocation,
  };
}
