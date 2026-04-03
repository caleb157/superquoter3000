// Centralized number formatting with units

export const fmt = {
  inr: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '₹0.00';
    return `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
  usd: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '$0.00';
    return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
  pct: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '0.0%';
    return `${(Number(v) * 100).toFixed(1)}%`;
  },
  qty: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '0';
    return Math.round(Number(v)).toLocaleString();
  },
  cbm: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '0.0000 CBM';
    return `${Number(v).toFixed(4)} CBM`;
  },
  dim: (w: number, d: number, h: number) =>
    `${w || 0}" × ${d || 0}" × ${h || 0}"`,
  num: (v: number | null | undefined, decimals = 2) => {
    if (v == null || isNaN(v)) return '0';
    return Number(v).toFixed(decimals);
  },
  hrs: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '0.00 hrs';
    return `${Number(v).toFixed(2)} hrs`;
  },
  kg: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '0.00 kg';
    return `${Number(v).toFixed(2)} kg`;
  },
  inch: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '0"';
    return `${Number(v).toFixed(1)}"`;
  },
};
