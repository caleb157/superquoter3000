// Manual cash-flow entries typed under the cash flow chart (PV analytics and DKT Cash Flow).
// With only a date the whole amount lands in that month; with an end date it is split evenly
// across every month from the date's month to the end date's month. Months before the
// forecast's first month are already past and are left out. No React here.

export type ManualScope = 'pv' | 'dkt';
export type ManualEntry = {
  id: string;
  scope: ManualScope;
  name: string;
  kind: 'income' | 'expense';
  amount: number;
  currency: 'USD' | 'INR';
  start_date: string; // YYYY-MM-DD
  end_date: string | null;
};

const ym = (d: string) => d.slice(0, 7);
const monthsBetween = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const plus = (m: string, n: number) => {
  const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/** Every month the entry touches (YYYY-MM), first to last. */
export function entryMonths(e: Pick<ManualEntry, 'start_date' | 'end_date'>): string[] {
  const start = ym(e.start_date);
  const end = e.end_date && ym(e.end_date) > start ? ym(e.end_date) : start;
  return Array.from({ length: monthsBetween(start, end) + 1 }, (_, i) => plus(start, i));
}

/** The entry's signed amount (+ income, − expense) per month, in its own currency, limited to `months`. */
export function spreadEntry(e: ManualEntry, months: string[]): { month: string; amount: number }[] {
  const all = entryMonths(e);
  const amt = Number(e.amount) || 0;
  if (!amt || !months.length) return [];
  const per = ((e.kind === 'income' ? 1 : -1) * amt) / all.length;
  const keep = new Set(months);
  return all.filter(m => keep.has(m)).map(month => ({ month, amount: per }));
}
