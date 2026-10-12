// Vendor RFQ sheets: one send-out to several vendors for the same products.
// Each vendor gets its own vendor_rfqs row (with its own copy of the line items), and the rows
// of one send-out share a batch_id. Replies are typed into vendor_rfq_responses (one per line,
// the same table the vendor share link writes), and Pick winner writes the winning vendor and
// price into the product's costing sheet: a raw piece quote slot (the winner is the included
// one, as in the costing workspace), or the "Outsourced Product" line for outsourced products.
import { supabase } from '@/integrations/supabase/client';
import { generateRawPieceRfq, generateRfqNumber, type RawTargetMode } from '@/lib/rfq-generation';
import { recostProduct } from '@/lib/costing-seed';

const db = supabase as any;
const RAW_TYPE = 'Raw Piece';
const OUTSOURCED_NAME = 'outsourced product';

export type SheetVendor = { id: string; name: string; email?: string | null; phone?: string | null; address?: string | null };
export type SheetRfq = {
  id: string; rfq_number: string | null; vendor_id: string | null; vendor_name: string | null;
  vendor_phone?: string | null; vendor_email?: string | null; status: string | null;
  response_due: string | null; share_token?: string | null; created_at?: string | null;
};
export type SheetLine = {
  id: string; vendor_rfq_id: string; product_id: string | null; item_name: string;
  product_photo_url?: string | null; description?: string | null; dimensions?: string | null;
  quantity: number; units?: string | null; target_price: number | null; notes?: string | null;
  sort_order?: number | null; picked_at?: string | null;
};
export type SheetResponse = { id?: string; vendor_rfq_line_item_id: string | null; quoted_unit_price: number | null; quoted_lead_time_days: number | null };

export type GridCell = { lineId: string; price: number | null; lead: number | null; picked: boolean };
export type GridRow = {
  key: string; productId: string | null; name: string; photo: string | null;
  quantity: number; units: string; target: number | null;
  cells: Record<string, GridCell>;
  /** RFQ (vendor) with the lowest price on this row, if any vendor has replied. */
  cheapestRfqId: string | null;
  /** RFQ (vendor) whose line was picked as the winner. */
  pickedRfqId: string | null;
};

/** One row per product (or item name for non-product lines), one cell per vendor RFQ. */
export function buildReplyGrid(rfqs: SheetRfq[], lines: SheetLine[], responses: SheetResponse[]): GridRow[] {
  const respByLine = new Map(responses.filter(r => r.vendor_rfq_line_item_id).map(r => [r.vendor_rfq_line_item_id!, r]));
  const rfqIds = new Set(rfqs.map(r => r.id));
  const rows = new Map<string, GridRow & { order: number }>();
  for (const l of lines) {
    if (!rfqIds.has(l.vendor_rfq_id)) continue;
    const key = l.product_id || `item:${l.item_name}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key, productId: l.product_id, name: l.item_name, photo: l.product_photo_url || null,
        quantity: Number(l.quantity) || 0, units: l.units || 'pc', target: l.target_price != null ? Number(l.target_price) : null,
        cells: {}, cheapestRfqId: null, pickedRfqId: null, order: l.sort_order ?? rows.size,
      };
      rows.set(key, row);
    }
    const r = respByLine.get(l.id);
    const price = r?.quoted_unit_price != null ? Number(r.quoted_unit_price) : null;
    row.cells[l.vendor_rfq_id] = {
      lineId: l.id, price, lead: r?.quoted_lead_time_days ?? null, picked: !!l.picked_at,
    };
    if (l.picked_at) row.pickedRfqId = l.vendor_rfq_id;
  }
  for (const row of rows.values()) {
    let best: { id: string; price: number } | null = null;
    for (const rfq of rfqs) {
      const c = row.cells[rfq.id];
      if (c?.price != null && c.price > 0 && (!best || c.price < best.price)) best = { id: rfq.id, price: c.price };
    }
    row.cheapestRfqId = best?.id ?? null;
  }
  return [...rows.values()].sort((a, b) => a.order - b.order).map(({ order: _o, ...r }) => r);
}

/** 'good' at or under target, 'over' above it, 'none' when there is nothing to compare. */
export function priceTone(price: number | null, target: number | null): 'good' | 'over' | 'none' {
  if (price == null || price <= 0 || target == null || target <= 0) return 'none';
  return price <= target ? 'good' : 'over';
}

/** Short message to paste into WhatsApp (or an email) with the vendor's PDF. */
export function whatsappMessage(o: {
  vendorName: string | null; rfqNumber: string | null; itemCount: number;
  replyBy: string | null; senderName?: string | null; companyName?: string | null;
}): string {
  const hello = o.vendorName ? `Hello ${o.vendorName},` : 'Hello,';
  const items = `${o.itemCount} item${o.itemCount === 1 ? '' : 's'}`;
  const by = o.replyBy ? ` by ${formatDay(o.replyBy)}` : '';
  const sign = [o.senderName, o.companyName].filter(Boolean).join(', ');
  return [
    hello,
    `Please find attached our request for quotation${o.rfqNumber ? ` ${o.rfqNumber}` : ''} for ${items}.`,
    `Kindly share your price per piece and lead time for each item${by}.`,
    sign ? `Thank you,\n${sign}` : 'Thank you.',
  ].join('\n\n');
}

export function formatDay(dateOnly: string): string {
  const [y, m, d] = dateOnly.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return dateOnly;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

type CogsRow = { id: string; product_id: string; cogs_type: string; component_name?: string | null; vendor_name?: string | null; unit_cost_inr?: number | null; include?: string | null; sort_order?: number | null; components_per_product?: number | null; created_at?: string | null };
export type WinnerPlan = { updates: { id: string; patch: Record<string, any> }[]; insert: Record<string, any> | null };

/**
 * What Pick winner writes into the costing sheet.
 * - Outsourced product: the "Outsourced Product" line takes the vendor and price (added if missing).
 * - Otherwise: the raw piece quote slot for that vendor (matched by name) takes the price, or the
 *   first empty slot, or a new slot; it becomes the included one and every other slot is excluded.
 */
export function planWinner(productId: string, cogs: CogsRow[], isOutsourced: boolean, vendor: string, price: number): WinnerPlan {
  const mine = cogs.filter(c => c.product_id === productId);
  const v = vendor.trim();
  const qty = (row: CogsRow) => (Number(row.components_per_product) > 0 ? {} : { components_per_product: 1 });
  if (isOutsourced) {
    const row = mine.find(c => (c.component_name || '').trim().toLowerCase() === OUTSOURCED_NAME);
    if (row) return { updates: [{ id: row.id, patch: { vendor_name: v, unit_cost_inr: price, include: 'Yes', ...qty(row) } }], insert: null };
    return {
      updates: [],
      insert: { product_id: productId, cogs_type: 'Other', component_name: 'Outsourced Product', vendor_name: v, unit_cost_inr: price,
        include: 'Yes', components_per_product: 1, waste_factor: 0, is_auto_calculated: false, sort_order: mine.length },
    };
  }
  const slots = mine
    .filter(c => c.cogs_type === RAW_TYPE)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const target = slots.find(s => (s.vendor_name || '').trim().toLowerCase() === v.toLowerCase())
    ?? slots.find(s => !(s.vendor_name || '').trim() && !(Number(s.unit_cost_inr) > 0));
  const updates: WinnerPlan['updates'] = [];
  for (const s of slots) {
    if (s === target) updates.push({ id: s.id, patch: { vendor_name: v, unit_cost_inr: price, include: 'Yes', ...qty(s) } });
    else if (s.include !== 'No') updates.push({ id: s.id, patch: { include: 'No' } });
  }
  const insert = target ? null : {
    product_id: productId, cogs_type: RAW_TYPE, component_name: `Raw Piece ${slots.length + 1}`, vendor_name: v, unit_cost_inr: price,
    include: 'Yes', components_per_product: 1, waste_factor: 0, is_auto_calculated: false, sort_order: slots.length,
  };
  return { updates, insert };
}

export function defaultReplyBy(now: Date = new Date(), days = 3): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Database ----------

export async function createRfqSheets(o: {
  inquiryId: string; productIds: string[]; vendors: SheetVendor[]; mode: RawTargetMode;
  discount: number; replyBy: string | null; notes: string | null; userId?: string | null;
}): Promise<{ batchId: string; count: number }> {
  if (o.vendors.length === 0) throw new Error('Pick at least one vendor.');
  const gen = await generateRawPieceRfq(o.inquiryId, o.productIds.length ? o.productIds : undefined, o.mode, { includeAll: true, discount: o.discount });
  if (gen.items.length === 0) throw new Error('No products to put on the sheet.');
  const batchId = crypto.randomUUID();
  for (const v of o.vendors) {
    const rfqNumber = await generateRfqNumber();
    const { data: rfq, error } = await db.from('vendor_rfqs').insert({
      customer_rfq_id: o.inquiryId, rfq_number: rfqNumber, rfq_type: 'raw_pieces', title: gen.title,
      discount_percent: o.discount, status: 'draft', created_by: o.userId || null, batch_id: batchId,
      vendor_id: v.id, vendor_name: v.name, vendor_email: v.email || null, vendor_phone: v.phone || null,
      vendor_address: v.address || null, response_due: o.replyBy, notes: o.notes,
    }).select('id').single();
    if (error || !rfq) throw new Error(error?.message || 'Could not create the RFQ.');
    const { error: lineErr } = await db.from('vendor_rfq_line_items').insert(gen.items.map(it => ({ ...it, vendor_rfq_id: rfq.id })));
    if (lineErr) throw new Error(lineErr.message);
  }
  return { batchId, count: o.vendors.length };
}

export type SheetBundle = {
  rfqs: SheetRfq[]; lines: SheetLine[]; responses: SheetResponse[];
  inquiry: { id: string; rfq_number: string | null; title: string | null } | null;
  products: any[];
};

export async function loadSheet(batchId: string): Promise<SheetBundle> {
  const { data: rfqs, error } = await db.from('vendor_rfqs').select('*').eq('batch_id', batchId).order('rfq_number');
  if (error) throw new Error(error.message);
  const ids = (rfqs || []).map((r: any) => r.id);
  if (ids.length === 0) return { rfqs: [], lines: [], responses: [], inquiry: null, products: [] };
  const inquiryId = rfqs[0].customer_rfq_id;
  const [linesRes, respRes, inqRes] = await Promise.all([
    db.from('vendor_rfq_line_items').select('*').in('vendor_rfq_id', ids).order('sort_order'),
    db.from('vendor_rfq_responses').select('*').in('vendor_rfq_id', ids),
    inquiryId ? db.from('customer_rfqs').select('id, rfq_number, title').eq('id', inquiryId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const productIds = [...new Set((linesRes.data || []).map((l: any) => l.product_id).filter(Boolean))];
  const prodRes = productIds.length
    ? await db.from('products').select('id, name, sku, photo_url, is_outsourced, product_type_id, finishing_difficulty, notes_finishes, width_inch, depth_inch, height_inch, product_type:product_types(name)').in('id', productIds)
    : { data: [] };
  return { rfqs: rfqs || [], lines: linesRes.data || [], responses: respRes.data || [], inquiry: inqRes.data || null, products: prodRes.data || [] };
}

/** Saves one typed reply (price and lead time) for a vendor's line; blank both to clear it. */
export async function saveReply(rfqId: string, lineId: string, price: number | null, lead: number | null): Promise<void> {
  const { error: delErr } = await db.from('vendor_rfq_responses').delete().eq('vendor_rfq_line_item_id', lineId);
  if (delErr) throw new Error(delErr.message);
  if (price == null && lead == null) return;
  const { error } = await db.from('vendor_rfq_responses').insert({
    vendor_rfq_id: rfqId, vendor_rfq_line_item_id: lineId, quoted_unit_price: price, quoted_lead_time_days: lead,
  });
  if (error) throw new Error(error.message);
  await db.from('vendor_rfqs').update({ status: 'responded', vendor_response_submitted_at: new Date().toISOString() })
    .eq('id', rfqId).in('status', ['draft', 'sent']);
}

export async function markSent(rfqIds: string[]): Promise<void> {
  if (!rfqIds.length) return;
  const { error } = await db.from('vendor_rfqs').update({ status: 'sent', sent_at: new Date().toISOString() }).in('id', rfqIds).eq('status', 'draft');
  if (error) throw new Error(error.message);
}

export function isOutsourcedProduct(p: any): boolean {
  return !!p?.is_outsourced || (p?.product_type?.name || '') === 'Outsourced';
}

/** Records the winner on the sheet and writes vendor + price into the product's costing sheet. */
export async function pickWinner(o: {
  lineIdsForProduct: string[]; winnerLineId: string; productId: string | null;
  vendorName: string; price: number; isOutsourced: boolean;
}): Promise<void> {
  const others = o.lineIdsForProduct.filter(id => id !== o.winnerLineId);
  if (others.length) {
    const { error } = await db.from('vendor_rfq_line_items').update({ picked_at: null }).in('id', others);
    if (error) throw new Error(error.message);
  }
  const { error: pickErr } = await db.from('vendor_rfq_line_items')
    .update({ picked_at: new Date().toISOString(), vendor_price: o.price }).eq('id', o.winnerLineId);
  if (pickErr) throw new Error(pickErr.message);
  if (!o.productId) return;

  const { data: cogs, error: cogsErr } = await db.from('cogs_items').select('*').eq('product_id', o.productId);
  if (cogsErr) throw new Error(cogsErr.message);
  const plan = planWinner(o.productId, cogs || [], o.isOutsourced, o.vendorName, o.price);
  for (const u of plan.updates) {
    const { error } = await db.from('cogs_items').update(u.patch).eq('id', u.id);
    if (error) throw new Error(error.message);
  }
  if (plan.insert) {
    const { error } = await db.from('cogs_items').insert(plan.insert);
    if (error) throw new Error(error.message);
  }
  await recostProduct(o.productId);
}

export type SheetSummary = { batchId: string; createdAt: string | null; firstNumber: string | null; vendors: string[]; replied: number; items: number; picked: number; replyBy: string | null };

/** The inquiry's RFQ sheets, newest first. */
export async function listSheetsForInquiry(inquiryId: string): Promise<SheetSummary[]> {
  const { data: rfqs } = await db.from('vendor_rfqs').select('id, batch_id, rfq_number, vendor_name, status, response_due, created_at')
    .eq('customer_rfq_id', inquiryId).not('batch_id', 'is', null).order('created_at', { ascending: false });
  if (!rfqs?.length) return [];
  const ids = rfqs.map((r: any) => r.id);
  const { data: lines } = await db.from('vendor_rfq_line_items').select('vendor_rfq_id, product_id, item_name, picked_at').in('vendor_rfq_id', ids);
  const byBatch = new Map<string, SheetSummary>();
  for (const r of rfqs) {
    let s = byBatch.get(r.batch_id);
    if (!s) {
      s = { batchId: r.batch_id, createdAt: r.created_at, firstNumber: r.rfq_number, vendors: [], replied: 0, items: 0, picked: 0, replyBy: r.response_due };
      byBatch.set(r.batch_id, s);
    }
    s.vendors.push(r.vendor_name || 'Vendor');
    if (r.status === 'responded' || r.status === 'accepted') s.replied++;
    if (r.rfq_number && (!s.firstNumber || r.rfq_number < s.firstNumber)) s.firstNumber = r.rfq_number;
  }
  const rfqBatch = new Map(rfqs.map((r: any) => [r.id, r.batch_id]));
  const keys = new Map<string, { items: Set<string>; picked: Set<string> }>();
  for (const l of lines || []) {
    const b = rfqBatch.get(l.vendor_rfq_id) as string;
    if (!keys.has(b)) keys.set(b, { items: new Set(), picked: new Set() });
    const k = l.product_id || l.item_name;
    keys.get(b)!.items.add(k);
    if (l.picked_at) keys.get(b)!.picked.add(k);
  }
  for (const s of byBatch.values()) {
    s.items = keys.get(s.batchId)?.items.size ?? 0;
    s.picked = keys.get(s.batchId)?.picked.size ?? 0;
  }
  return [...byBatch.values()];
}
