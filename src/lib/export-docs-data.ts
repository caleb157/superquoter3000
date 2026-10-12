// Data for the Commercial Invoice & Packing List tool: the Odoo invoice (via the
// odoo-invoice-docs function), the customs exchange rate, remembered packing details
// per SKU, HQ carton data as a fallback, and the saved copy of each generated set.
import { supabase } from '@/integrations/supabase/client';
import {
  ExportDocData, ExportLine, ExportParty, PackingDefaults, packingFromHq, panFromGstin, partnerLines,
} from './export-docs';

// The new tables aren't in the generated Supabase types until they are regenerated.
const db = (t: string) => (supabase as any).from(t);

export const MISSING_TABLES_MSG =
  'The export documents tables are not in the database yet. Run the export documents SQL, then reload.';
export const isMissingTable = (e: any) =>
  e?.code === '42P01' || e?.code === 'PGRST205'
  || (/(customs_exchange_rates|export_packing_profiles|export_documents)/.test(String(e?.message))
    && /(not find|does not exist|schema cache)/i.test(String(e?.message)));

async function invokeError(error: any): Promise<string> {
  let msg = error?.message || 'Odoo request failed';
  try { msg = (await error?.context?.json?.())?.error || msg; } catch { /* keep generic */ }
  return /Failed to send|FunctionsFetchError/i.test(msg)
    ? 'The Odoo invoice reader is not available yet (the odoo-invoice-docs function has not been deployed).'
    : msg;
}

// ---------- Odoo ----------

export interface OdooInvoiceSummary {
  id: number; name: string; date: string | null; customer: string; amount_total: number; currency: string; origin: string; ref: string;
}
export interface OdooPartner {
  name: string; contact: string; street: string; street2: string; city: string; state: string; zip: string;
  country: string; vat: string; phone: string; email: string;
}
export interface OdooInvoice {
  invoice: {
    id: number; name: string; date: string | null; currency: string; origin: string; ref: string;
    buyer_order_no: string; buyer_order_date: string | null; sale_order: string | null; incoterm: string; payment_terms: string;
    amount_untaxed: number; amount_tax: number; amount_total: number;
    buyer: OdooPartner | null; consignee: OdooPartner | null; company: OdooPartner | null;
  };
  lines: {
    product_id: number | null; sku: string; product_name: string; description: string; quantity: number; uom: string;
    price_unit: number; subtotal: number; hsn_code: string | null; igst_rate: number | null;
    odoo_weight_kg: number | null; odoo_volume_m3: number | null;
  }[];
}

export async function listOdooInvoices(search: string): Promise<OdooInvoiceSummary[]> {
  const { data, error } = await supabase.functions.invoke('odoo-invoice-docs', { body: { action: 'list', search: search || null, limit: 50 } });
  if (error) throw new Error(await invokeError(error));
  if (data?.error) throw new Error(String(data.error));
  return data?.invoices ?? [];
}

export async function getOdooInvoice(id: number): Promise<OdooInvoice> {
  const { data, error } = await supabase.functions.invoke('odoo-invoice-docs', { body: { action: 'get', invoice_id: id } });
  if (error) throw new Error(await invokeError(error));
  if (data?.error) throw new Error(String(data.error));
  return data as OdooInvoice;
}

// ---------- customs exchange rate ----------

export interface CustomsRate {
  id: string; currency: string; rate: number; notification_no: string | null; effective_from: string; created_at: string;
}

export async function latestCustomsRate(currency = 'USD'): Promise<CustomsRate | null> {
  const { data, error } = await db('customs_exchange_rates').select('*').eq('currency', currency)
    .order('effective_from', { ascending: false }).order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function saveCustomsRate(r: { currency: string; rate: number; notification_no: string; effective_from: string; source_url: string }) {
  const { error } = await db('customs_exchange_rates').insert(r);
  if (error) throw error;
}

// ---------- packing details ----------

export interface PackingProfile {
  sku: string; units_per_package: number | null; package_dims_in: string | null; package_kind: string | null;
  net_weight_kg: number | null; gross_weight_kg: number | null;
}

/** Packing pre-fill per SKU: what was used last time, else HQ's carton data for that SKU. */
export async function packingDefaults(skus: string[]): Promise<Record<string, PackingDefaults>> {
  const out: Record<string, PackingDefaults> = {};
  const list = [...new Set(skus.filter(Boolean))];
  if (!list.length) return out;

  const { data: profiles, error } = await db('export_packing_profiles').select('*').in('sku', list);
  if (error && !isMissingTable(error)) throw error;
  for (const p of (profiles ?? []) as PackingProfile[]) {
    out[p.sku] = {
      unitsPerPackage: Number(p.units_per_package || 0), packageDims: p.package_dims_in || '', packageKind: p.package_kind || 'Carton',
      netWeightKg: Number(p.net_weight_kg || 0), grossWeightKg: Number(p.gross_weight_kg || 0),
    };
  }

  const missing = list.filter(s => !out[s]);
  if (missing.length) {
    const { data: prods } = await supabase.from('products').select('id, sku, weight_kg, updated_at')
      .in('sku', missing).is('archived_at', null).order('updated_at', { ascending: false });
    const bySku = new Map<string, any>();
    for (const p of prods ?? []) if (p.sku && !bySku.has(p.sku)) bySku.set(p.sku, p);
    const ids = [...bySku.values()].map(p => p.id);
    if (ids.length) {
      const { data: cbms } = await supabase.from('cbm_estimates')
        .select('product_id, mc_width, mc_depth, mc_height, products_per_mc, ic_width, ic_depth, ic_height, products_per_ic, mc_empty_weight_kg')
        .in('product_id', ids);
      const cbmBy = new Map((cbms ?? []).map(c => [c.product_id, c]));
      for (const [sku, p] of bySku) {
        const d = packingFromHq(p, cbmBy.get(p.id));
        if (d) out[sku] = d;
      }
    }
  }
  return out;
}

export async function savePackingProfiles(lines: ExportLine[]) {
  const rows = lines.filter(l => l.sku && (l.unitsPerPackage || l.packageDims)).map(l => ({
    sku: l.sku, units_per_package: l.unitsPerPackage || null, package_dims_in: l.packageDims || null,
    package_kind: l.packageKind || null, net_weight_kg: l.netWeightKg || null, gross_weight_kg: l.grossWeightKg || null,
    updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return;
  const { error } = await db('export_packing_profiles').upsert(rows, { onConflict: 'sku' });
  if (error) throw error;
}

// ---------- saved sets ----------

export interface SavedExportDoc {
  id: string; invoice_no: string; odoo_invoice_id: number | null; entity_id: string | null;
  exchange_rate: number | null; total_usd: number | null; created_at: string;
}

export async function listSavedDocs(limit = 20): Promise<SavedExportDoc[]> {
  const { data, error } = await db('export_documents')
    .select('id, invoice_no, odoo_invoice_id, entity_id, exchange_rate, total_usd, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getSavedDoc(id: string): Promise<{ payload: ExportDocData; entity_id: string | null; odoo_invoice_id: number | null }> {
  const { data, error } = await db('export_documents').select('payload, entity_id, odoo_invoice_id').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function saveDoc(doc: ExportDocData, meta: { odooInvoiceId: number | null; entityId: string | null; totalUsd: number }) {
  const { error } = await db('export_documents').insert({
    invoice_no: doc.invoiceNo, odoo_invoice_id: meta.odooInvoiceId, entity_id: meta.entityId,
    exchange_rate: doc.exchangeRate, notification_no: doc.notificationNo || null, total_usd: meta.totalUsd, payload: doc,
  });
  if (error) throw error;
}

// ---------- building the document from Odoo ----------

export interface ShipperEntity {
  id: string; name: string; legal_name: string | null; address_line1: string | null; address_line2: string | null;
  city: string | null; state: string | null; postal_code: string | null; country: string | null;
  email: string | null; phone: string | null; gst_number: string | null;
}

export function shipperFromEntity(e: ShipperEntity | null, contact: string) {
  const cityLine = e ? [e.city, e.state, e.postal_code].filter(Boolean).join(', ') : '';
  return {
    name: e?.legal_name || e?.name || '',
    lines: e ? [e.address_line1, e.address_line2, cityLine, e.country].map(s => (s || '').trim()).filter(Boolean) : [],
    contact, email: e?.email || '', phone: e?.phone || '', gstNumber: e?.gst_number || '',
  };
}

function toParty(p: OdooPartner | null): ExportParty {
  return {
    name: p?.name || '', lines: partnerLines(p), contact: p?.contact && p.contact !== p.name ? p.contact : (p?.contact || ''),
    email: p?.email || '', phone: p?.phone || '',
  };
}

/** Shipping fields carried from the last document (they rarely change). */
export type ShippingDefaults = Pick<ExportDocData,
  'preCarriageBy' | 'portOfDischarge' | 'countryOfOrigin' | 'placeOfReceipt' | 'portOfLoading' | 'termsOfDelivery'>;

export const DEFAULT_SHIPPING: ShippingDefaults = {
  preCarriageBy: 'Truck', portOfDischarge: '', countryOfOrigin: 'India', placeOfReceipt: 'Jodhpur',
  portOfLoading: 'Jodhpur, India', termsOfDelivery: '',
};

export function docFromOdoo(
  inv: OdooInvoice,
  opts: {
    shipper: ReturnType<typeof shipperFromEntity>; packing: Record<string, PackingDefaults>; shipping: ShippingDefaults;
    rate: number; notificationNo: string; signatoryName: string;
  },
): ExportDocData {
  const i = inv.invoice;
  const consignee = toParty(i.consignee ?? i.buyer);
  const buyer = toParty(i.buyer);
  const sameParty = !i.buyer || !i.consignee || (buyer.name === consignee.name && buyer.lines.join('|') === consignee.lines.join('|'));
  const destCountry = i.consignee?.country || i.buyer?.country || '';
  const finalDest = i.consignee ? [i.consignee.city, i.consignee.state, i.consignee.country].filter(Boolean).join(', ') : '';
  // Odoo's incoterm reads "[FOB] FREE ON BOARD"; the documents use the code + place of loading.
  const incoterm = (/^\[(\w+)\]/.exec(i.incoterm || '')?.[1] ?? i.incoterm ?? '').trim();
  const fromOdoo = [incoterm && opts.shipping.placeOfReceipt ? `${incoterm} ${opts.shipping.placeOfReceipt}` : incoterm, i.payment_terms]
    .filter(Boolean).join(', ');
  const terms = fromOdoo || opts.shipping.termsOfDelivery;
  return {
    invoiceNo: i.name, invoiceDate: i.date || '', exporterRef: panFromGstin(opts.shipper.gstNumber),
    buyerOrderNo: i.buyer_order_no || '', buyerOrderDate: '', billOfLading: '', otherReferences: '',
    shipper: opts.shipper, consignee, buyer: sameParty ? null : buyer,
    preCarriageBy: opts.shipping.preCarriageBy, vesselFlightNo: '', portOfDischarge: opts.shipping.portOfDischarge,
    countryOfOrigin: opts.shipping.countryOfOrigin, countryOfFinalDestination: destCountry === 'United States' ? 'United States of America' : destCountry,
    placeOfReceipt: opts.shipping.placeOfReceipt, portOfLoading: opts.shipping.portOfLoading, finalDestination: finalDest,
    termsOfDelivery: terms, handlingInformation: '',
    exchangeRate: opts.rate, notificationNo: opts.notificationNo, shippingInr: 0, shippingIgstInr: 0,
    signatoryCompany: opts.shipper.name, signatoryName: opts.signatoryName,
    lines: inv.lines.map(l => {
      const p = opts.packing[l.sku];
      return {
        sku: l.sku, description: (l.description || l.product_name).replace(/^\[[^\]]*\]\s*/, ''), hsnCode: l.hsn_code || '', quantity: l.quantity,
        uom: !l.uom || /^units?$/i.test(l.uom) ? 'Units' : l.uom, fobPriceUsd: l.price_unit, igstRatePct: l.igst_rate ?? 0,
        unitsPerPackage: p?.unitsPerPackage ?? 0, packageDims: p?.packageDims ?? '', packageKind: p?.packageKind ?? 'Carton',
        netWeightKg: p?.netWeightKg ?? 0, grossWeightKg: p?.grossWeightKg ?? 0,
      };
    }),
  };
}
