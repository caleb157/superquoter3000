import { ensureRef, saveQuote, type FqQuote, type FqRef } from './data';
import type { EditableQuote } from '@/components/freight-quotes/QuoteEditor';

export function toEditable(q: FqQuote, refs: { vendors: FqRef[]; customers: FqRef[]; products: FqRef[] }): EditableQuote {
  const nameOf = (list: FqRef[], id: string | null) => list.find(x => x.id === id)?.name || null;
  return { ...q, vendor_name: nameOf(refs.vendors, q.vendor_id), customer_name: nameOf(refs.customers, q.customer_id), product_name: nameOf(refs.products, q.product_id) };
}

export async function resolveRefs(q: EditableQuote): Promise<FqQuote> {
  const vendor_id = q.vendor_name?.trim() ? await ensureRef('fq_vendors', q.vendor_name.trim()) : null;
  const customer_id = q.customer_name?.trim() ? await ensureRef('fq_customers', q.customer_name.trim()) : null;
  const product_id = q.product_name?.trim() ? await ensureRef('fq_products', q.product_name.trim()) : null;
  return { ...q, vendor_id, customer_id, product_id };
}

export async function saveEditable(q: EditableQuote) {
  const resolved = await resolveRefs(q);
  const { vendor_name, customer_name, product_name, field_confidence, ...rest } = resolved as any;
  return saveQuote(rest);
}
