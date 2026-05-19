// Centralized number formatting with units.
// Every formatter coerces non-finite values (NaN, Infinity, null, undefined,
// non-numeric strings) to 0 so calculated cells never render "NaN".
import {
  type CurrencyMap,
  formatCurrencySync,
  getCachedCurrencyMap,
  loadCurrencyMap,
  subscribeCurrencyMap,
} from './currency';

const toFinite = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Module-local currency map; primed on first use and kept fresh via subscription.
let cachedMap: CurrencyMap | null = getCachedCurrencyMap();
loadCurrencyMap().then(m => { cachedMap = m; }).catch(() => {});
subscribeCurrencyMap(m => { cachedMap = m; });

export const fmt = {
  inr: (v: number | null | undefined) => {
    const n = toFinite(v);
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
  },
  usd: (v: number | null | undefined) => {
    const n = toFinite(v);
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
  },
  // Multi-currency formatter. Pass the ISO code from the snapshot or inquiry.
  // Falls back to a bare "CODE " prefix while the currency map is loading.
  money: (v: number | null | undefined, code: string, decimals = 2) =>
    formatCurrencySync(toFinite(v), code, cachedMap) ||
    `${code} ${toFinite(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`,
  pct: (v: number | null | undefined) => {
    return `${(toFinite(v) * 100).toFixed(3)}%`;
  },
  qty: (v: number | null | undefined) => {
    return Math.round(toFinite(v)).toLocaleString();
  },
  cbm: (v: number | null | undefined) => {
    return `${toFinite(v).toFixed(3)} CBM`;
  },
  dim: (w: number, d: number, h: number) =>
    `${toFinite(w).toFixed(3)}" × ${toFinite(d).toFixed(3)}" × ${toFinite(h).toFixed(3)}"`,
  num: (v: number | null | undefined, decimals = 3) => {
    return toFinite(v).toFixed(decimals);
  },
  hrs: (v: number | null | undefined) => {
    return `${toFinite(v).toFixed(3)} hrs`;
  },
  kg: (v: number | null | undefined) => {
    return `${toFinite(v).toFixed(3)} kg`;
  },
  inch: (v: number | null | undefined) => {
    return `${toFinite(v).toFixed(3)}"`;
  },
};
