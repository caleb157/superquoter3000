// Centralized number formatting with units.
// Every formatter coerces non-finite values (NaN, Infinity, null, undefined,
// non-numeric strings) to 0 so calculated cells never render "NaN".

const toFinite = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const fmt = {
  inr: (v: number | null | undefined) => {
    const n = toFinite(v);
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
  },
  usd: (v: number | null | undefined) => {
    const n = toFinite(v);
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
  },
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
