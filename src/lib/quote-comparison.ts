// Compares the lines of a sent quote with the products' current (live-costed) prices.

export type ComparedQuoteLine = {
  product_id?: string | null;
  name: string;
  sku?: string | null;
  quantity: number;
  unit_price_usd: number; // in the quote's display currency
  is_assembly?: boolean;
};

export type CurrentProductPrice = {
  id: string;
  name: string;
  sku?: string | null;
  quantity?: number | null;
  current_price: number; // same currency as the quote; 0 when it cannot be priced
};

export type CompareStatus = 'matched' | 'kit' | 'removed' | 'new';

export type CompareRow = {
  key: string;
  name: string;
  sku: string | null;
  status: CompareStatus;
  quantity: number;
  quoted: number | null;
  current: number | null;
  delta: number | null;
  deltaPct: number | null;
};

export type CompareResult = {
  rows: CompareRow[];
  totals: { quoted: number; current: number; delta: number; deltaPct: number | null; lines: number };
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export function compareQuoteToCurrent(lines: ComparedQuoteLine[], current: CurrentProductPrice[]): CompareResult {
  const currentById = new Map(current.map(c => [c.id, c]));
  const quotedIds = new Set<string>();
  const rows: CompareRow[] = [];

  lines.forEach((l, i) => {
    const qty = Number(l.quantity || 0);
    const quoted = Number(l.unit_price_usd || 0);
    if (l.product_id) quotedIds.add(l.product_id);
    const base = { key: `q${i}`, name: l.name, sku: l.sku ?? null, quantity: qty, quoted };
    if (l.is_assembly) {
      rows.push({ ...base, status: 'kit', current: null, delta: null, deltaPct: null });
      return;
    }
    const cur = l.product_id ? currentById.get(l.product_id) : undefined;
    if (!cur) {
      rows.push({ ...base, status: 'removed', current: null, delta: null, deltaPct: null });
      return;
    }
    const price = Number(cur.current_price || 0);
    const delta = price - quoted;
    rows.push({ ...base, status: 'matched', current: price, delta, deltaPct: quoted > 0 ? delta / quoted : null });
  });

  current.filter(c => !quotedIds.has(c.id)).forEach(c => {
    rows.push({
      key: `n${c.id}`, name: c.name, sku: c.sku ?? null, status: 'new',
      quantity: Number(c.quantity || 0), quoted: null, current: Number(c.current_price || 0), delta: null, deltaPct: null,
    });
  });

  rows.sort(byName);

  // Totals cover matched lines only, at the quoted quantities, so they show the pure price effect.
  const matched = rows.filter(r => r.status === 'matched');
  const quotedTotal = matched.reduce((s, r) => s + r.quantity * (r.quoted ?? 0), 0);
  const currentTotal = matched.reduce((s, r) => s + r.quantity * (r.current ?? 0), 0);
  return {
    rows,
    totals: {
      quoted: quotedTotal,
      current: currentTotal,
      delta: currentTotal - quotedTotal,
      deltaPct: quotedTotal > 0 ? (currentTotal - quotedTotal) / quotedTotal : null,
      lines: matched.length,
    },
  };
}
