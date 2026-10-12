// Live Odoo order search for the task "Associate with" picker (odoo-order-search
// function). Nothing is stored: a task keeps only the picked order number and label.
import { supabase } from '@/integrations/supabase/client';

export type OdooOrderKind = 'so' | 'mo';

export interface OdooOrder {
  id: number; name: string; state: string; date: string | null; reference: string;
  customer?: string; amount_total?: number; currency?: string; // sales orders
  product?: string; sku?: string; quantity?: number;            // manufacturing orders
}

const SO_STATES: Record<string, string> = { draft: 'Quotation', sent: 'Quotation sent', sale: 'Sales order', done: 'Locked' };
const MO_STATES: Record<string, string> = { draft: 'Draft', confirmed: 'Confirmed', progress: 'In progress', to_close: 'To close', done: 'Done' };

export function orderStateLabel(kind: OdooOrderKind, state: string): string {
  return (kind === 'so' ? SO_STATES : MO_STATES)[state] ?? state;
}

/** What the task saves as association_label: "Customer · reference" for an SO, the SKU for an MO. */
export function orderLabel(kind: OdooOrderKind, o: OdooOrder): string | null {
  if (kind === 'mo') return o.sku || o.product || null;
  return [o.customer, o.reference].filter(Boolean).join(' · ') || null;
}

export async function searchOdooOrders(kind: OdooOrderKind, search: string): Promise<OdooOrder[]> {
  const { data, error } = await supabase.functions.invoke('odoo-order-search', { body: { kind, search: search.trim() || null, limit: 20 } });
  const body = data as { orders?: OdooOrder[]; error?: unknown } | null;
  if (error) {
    let msg = error?.message || 'Odoo request failed';
    try { msg = (await (error as { context?: Response }).context?.json())?.error || msg; } catch { /* keep generic */ }
    throw new Error(/Failed to send|FunctionsFetchError|not found/i.test(msg)
      ? 'The live Odoo order search is not available yet (the odoo-order-search function has not been deployed).'
      : msg);
  }
  if (body?.error) throw new Error(String(body.error));
  return body?.orders ?? [];
}
