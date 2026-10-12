// Man-hours per unit saved on each product (products.calculated_man_hours_per_unit), next
// to the saved price and cost, so lists can show an inquiry's man-hours straight away
// instead of waiting for the costing engine. Written by the same save paths as the price
// (persistResolvedCosting, the cache heals) and healed by the Inquiries list's live run.
//
// Until the column exists (Caleb runs the SQL), every read falls back to the old columns
// and writes are skipped, so nothing breaks before or after the migration.
import { supabase } from '@/integrations/supabase/client';

export const MH_COLUMN = 'calculated_man_hours_per_unit';

let columnMissing = false;

/** True for PostgREST's "column does not exist" errors about the man-hours column. */
export function isMissingMhColumn(err: any): boolean {
  const msg = String(err?.message ?? err ?? '');
  return msg.includes(MH_COLUMN);
}

/**
 * Runs a read that selects `columns` plus the man-hours column; if the column is not
 * there yet, runs it again without it (and stops asking for it this session).
 */
export async function withStoredMh<T>(columns: string, run: (cols: string) => Promise<T>): Promise<T> {
  if (columnMissing) return run(columns);
  try {
    return await run(`${columns}, ${MH_COLUMN}`);
  } catch (e) {
    if (!isMissingMhColumn(e)) throw e;
    columnMissing = true;
    return run(columns);
  }
}

const round = (n: number) => +n.toFixed(4);

/** Saved value differs from the live one by more than rounding. */
export function mhChanged(stored: unknown, live: number): boolean {
  if (!Number.isFinite(live)) return false;
  if (stored == null) return true;
  return Math.abs((Number(stored) || 0) - round(live)) > 0.0001;
}

/** Saves man-hours per unit for these products; a no-op until the column exists. */
export async function saveStoredMh(rows: { id: string; manHours: number }[]): Promise<void> {
  for (const r of rows) {
    if (columnMissing) return;
    if (!Number.isFinite(r.manHours)) continue;
    const { error } = await (supabase as any).from('products')
      .update({ [MH_COLUMN]: round(r.manHours) }).eq('id', r.id);
    if (error && isMissingMhColumn(error)) columnMissing = true;
  }
}

/** For tests. */
export function resetStoredMhState(): void {
  columnMissing = false;
}
